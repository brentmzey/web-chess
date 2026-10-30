import { describe, expect, it } from 'bun:test';
import { none, some } from '../src/utils/fp';
import {
  claimLiveSeat,
  isLocalTurn,
  ownedSeatKey,
  parseSeatOwners,
  pickOpenSeat,
  releaseLiveSeat,
  resolveLocalSeatKey,
  shouldDriveBots,
  type LiveSeatView
} from '../src/games/multiplayer/liveSeats';

const seats: readonly LiveSeatView[] = [
  { key: 'p1', isBot: false },
  { key: 'p2', isBot: true },
  { key: 'p3', isBot: true }
];

describe('Live seat ownership', () => {
  it('finds owned seats and resolves the local seat for AI and live tables', () => {
    const owners = { p1: 'usr_host', p3: 'usr_guest' };
    expect(ownedSeatKey(owners, 'usr_guest').getOrElse('')).toBe('p3');
    expect(ownedSeatKey(owners, 'usr_nobody').isNone()).toBe(true);
    expect(resolveLocalSeatKey(false, {}, 'usr_x', 'p1').getOrElse('')).toBe('p1');
    expect(resolveLocalSeatKey(true, owners, 'usr_guest', 'p1').getOrElse('')).toBe('p3');
    expect(resolveLocalSeatKey(true, owners, 'usr_nobody', 'p1').isNone()).toBe(true);
  });

  it('seats the host first and guests in the first unowned bot seat', () => {
    expect(pickOpenSeat(seats, {}, true).getOrElse('')).toBe('p1');
    expect(pickOpenSeat(seats, {}, false).getOrElse('')).toBe('p2');
    expect(pickOpenSeat(seats, { p1: 'h', p2: 'g' }, true).getOrElse('')).toBe('p3');
    expect(pickOpenSeat(seats, { p1: 'h', p2: 'g', p3: 'g2' }, false).isNone()).toBe(true);
  });

  it('claims once, refuses a full table, and releases on leave', () => {
    const first = claimLiveSeat(seats, {}, 'usr_host', true).getOrThrow();
    expect(first).toEqual({ key: 'p1', owners: { p1: 'usr_host' } });
    expect(claimLiveSeat(seats, first.owners, 'usr_host', true).isNone()).toBe(true);

    const second = claimLiveSeat(seats, first.owners, 'usr_guest', false).getOrThrow();
    expect(second.owners).toEqual({ p1: 'usr_host', p2: 'usr_guest' });
    expect(claimLiveSeat(seats, { p1: 'a', p2: 'b', p3: 'c' }, 'usr_late', false).isNone()).toBe(true);

    expect(releaseLiveSeat(second.owners, 'usr_guest')).toEqual({ p1: 'usr_host' });
  });

  it('lets exactly one browser drive bots and checks whose turn it is', () => {
    expect(shouldDriveBots(false, false)).toBe(true);
    expect(shouldDriveBots(true, true)).toBe(true);
    expect(shouldDriveBots(true, false)).toBe(false);
    expect(isLocalTurn(some('p2'), 'p2')).toBe(true);
    expect(isLocalTurn(some('p2'), 'p1')).toBe(false);
    expect(isLocalTurn(none(), 'p1')).toBe(false);
  });

  it('parses only string owners from untrusted snapshot data', () => {
    expect(parseSeatOwners({ p1: 'usr_a', p2: 5, p3: null })).toEqual({ p1: 'usr_a' });
    expect(parseSeatOwners(null)).toEqual({});
    expect(parseSeatOwners(['x'])).toEqual({});
    expect(parseSeatOwners('x')).toEqual({});
  });
});
