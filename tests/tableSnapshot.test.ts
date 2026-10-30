import { describe, expect, it } from 'bun:test';
import { some, none, Some, None } from '../src/utils/fp';
import {
  TABLE_SNAPSHOT_VERSION,
  decodeSnapshotValue,
  encodeSnapshotValue,
  exportTableSnapshot,
  importTableSnapshot,
  type SnapshotableEngine
} from '../src/games/multiplayer/tableSnapshot';
import { TableSeatManager } from '../src/games/multiplayer/tableSeatManager';
import { CathedralPokerEngine } from '../src/games/poker/pokerEngine';
import { CardinalUnoEngine } from '../src/games/uno/unoEngine';
import { BlackjackMultiSeatEngine } from '../src/games/blackjack/blackjackMultiSeatEngine';

describe('Arcade table snapshots', () => {
  it('round-trips Option and Map values through JSON', () => {
    const value = {
      turn: some(3),
      winner: none<string>(),
      nested: [some({ deep: none<number>() })],
      scores: new Map([['a', 1], ['b', 2]]),
      plain: 'x',
      nothing: null
    };
    const decoded = decodeSnapshotValue(JSON.parse(JSON.stringify(encodeSnapshotValue(value)))) as typeof value;

    expect(decoded.turn).toBeInstanceOf(Some);
    expect(decoded.turn.getOrElse(0)).toBe(3);
    expect(decoded.winner).toBeInstanceOf(None);
    expect((decoded.nested[0] as Some<{ deep: unknown }>).value.deep).toBeInstanceOf(None);
    expect(decoded.scores).toBeInstanceOf(Map);
    expect(decoded.scores.get('b')).toBe(2);
    expect(decoded.plain).toBe('x');
    expect(decoded.nothing).toBeNull();
  });

  it('leaves a malformed map tag as a plain object', () => {
    expect(decodeSnapshotValue({ __map: 'nope' })).toEqual({ __map: 'nope' });
  });

  it('exports and imports engine state and seats so two clients converge', () => {
    const host = new BlackjackMultiSeatEngine(3, 10, 500);
    host.seatManager.claimSeat(1, 'usr_host', 'Host');
    host.populateBotOpponents();
    host.startRound();

    const guest = new BlackjackMultiSeatEngine(3, 10, 500);
    const snapshot = JSON.parse(JSON.stringify(exportTableSnapshot(host)));
    expect(snapshot.version).toBe(TABLE_SNAPSHOT_VERSION);
    expect(importTableSnapshot(guest, snapshot).isSuccess()).toBe(true);

    expect(guest.state).toEqual(host.state);
    expect(guest.seatManager.getSeat(1).getOrThrow().playerName).toBe('Host');
    expect(guest.seatManager.getOccupiedSeats().length).toBe(host.seatManager.getOccupiedSeats().length);
    expect(guest.state.activeSeatTurn.isSome()).toBe(host.state.activeSeatTurn.isSome());
  });

  it('syncs engines without a seat manager and carries engine extras', () => {
    const host = new CathedralPokerEngine('texas-holdem' as any, 4, 10, 20);
    host.startHand();
    const guest = new CathedralPokerEngine('texas-holdem' as any, 4, 10, 20);

    const snapshot = exportTableSnapshot(host, host.exportShoe());
    const extras = importTableSnapshot(guest, JSON.parse(JSON.stringify(snapshot))).getOrThrow();
    guest.importShoe(extras as any);
    expect(guest.exportShoe()).toEqual(host.exportShoe());

    const bare: SnapshotableEngine = { state: { a: 1 } };
    const bareSnap = exportTableSnapshot(bare);
    expect(bareSnap.seats).toEqual([]);
    expect(bareSnap.extras).toBeNull();
    const target: SnapshotableEngine = { state: {} };
    expect(importTableSnapshot(target, bareSnap).isSuccess()).toBe(true);
    expect(target.state).toEqual({ a: 1 });

    const uno = new CardinalUnoEngine('A', 3);
    expect(importTableSnapshot(uno, { ...exportTableSnapshot(uno), seats: 'not-an-array' }).isSuccess()).toBe(true);
  });

  it('rejects unsupported or incomplete snapshots and reports apply failures', () => {
    const engine: SnapshotableEngine = { state: { a: 1 } };
    expect(importTableSnapshot(engine, null).isFailure()).toBe(true);
    expect(importTableSnapshot(engine, 'x').isFailure()).toBe(true);
    expect(importTableSnapshot(engine, { version: 99, state: {} }).isFailure()).toBe(true);
    expect(importTableSnapshot(engine, { version: TABLE_SNAPSHOT_VERSION, state: null }).isFailure()).toBe(true);

    const exploding: SnapshotableEngine = {
      get state() {
        return {};
      },
      set state(_v: unknown) {
        throw new Error('read-only');
      }
    };
    const res = importTableSnapshot(exploding, { version: TABLE_SNAPSHOT_VERSION, state: {}, seats: [], extras: null });
    expect(res.match({ Ok: () => '', Err: e => e })).toContain('Failed to apply table snapshot');
  });

  it('exports detached seat copies and ignores out-of-range seats on import', () => {
    const seats = new TableSeatManager(3, 2);
    seats.claimSeat(2, 'usr_b', 'Bo');
    const exported = seats.exportSeats();
    expect(exported.length).toBe(3);

    const other = new TableSeatManager(3, 2);
    other.importSeats([...exported, { ...exported[0]!, seatNumber: 9 }, { ...exported[0]!, seatNumber: 0 }]);
    expect(other.getSeat(2).getOrThrow().playerName).toBe('Bo');
    expect(other.getAllSeats().length).toBe(3);

    (exported[1] as any).playerName = 'Mutated';
    expect(seats.getSeat(2).getOrThrow().playerName).toBe('Bo');
  });
});
