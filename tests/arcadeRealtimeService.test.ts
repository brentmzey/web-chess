import { describe, expect, it } from 'bun:test';
import { ArcadeRealtimeService } from '../src/server/services/arcadeRealtimeService';
import { ArcadeGameEnum } from '../src/constants/gameEnums';

describe('ArcadeRealtimeService - Multi-Game Real-Time Seating & Bot Hot-Swapping', () => {
  it('creates sessions for any arcade game with real-life capacities', () => {
    const service = new ArcadeRealtimeService();

    // Blackjack (up to 7 players)
    const bjkRes = service.createSession(ArcadeGameEnum.Blackjack, 'BJK-TEST1', 7, 'Dealer Hunter');
    expect(bjkRes.isSuccess()).toBe(true);
    const bjk = bjkRes.getOrThrow();
    expect(bjk.maxSeats).toBe(7);
    expect(bjk.seatManager.getHumanCount()).toBe(1);
    expect(bjk.seatManager.getBotCount()).toBe(6);

    // Poker (up to 10 players)
    const pokRes = service.createSession(ArcadeGameEnum.Poker, 'POKER-TEST1', 10, 'Card Shark');
    expect(pokRes.isSuccess()).toBe(true);
    const pok = pokRes.getOrThrow();
    expect(pok.maxSeats).toBe(10);
    expect(pok.seatManager.getHumanCount()).toBe(1);
    expect(pok.seatManager.getBotCount()).toBe(9);
  });

  it('allows human players to join and hot-swaps bots out in real-time', () => {
    const service = new ArcadeRealtimeService();
    service.createSession(ArcadeGameEnum.SkipBo, 'SKIP-TEST1', 6, 'Host');

    const joinRes = service.joinSession('SKIP-TEST1', 'usr_human_2', 'Speedy Human');
    expect(joinRes.isSuccess()).toBe(true);

    const session = service.getSession('SKIP-TEST1').getOrThrow();
    expect(session.seatManager.getHumanCount()).toBe(2);
    expect(session.seatManager.getBotCount()).toBe(4);

    const seat2 = session.seatManager.getSeat(2).getOrThrow();
    expect(seat2.isBot).toBe(false);
    expect(seat2.playerName).toBe('Speedy Human');
  });

  it('restores bots when a human leaves so the match never halts', () => {
    const service = new ArcadeRealtimeService();
    service.createSession(ArcadeGameEnum.Phase10, 'P10-TEST1', 4, 'Host');
    service.joinSession('P10-TEST1', 'usr_p2', 'Player 2');

    const session = service.getSession('P10-TEST1').getOrThrow();
    expect(session.seatManager.getHumanCount()).toBe(2);

    const leaveRes = service.leaveSession('P10-TEST1', 'usr_p2');
    expect(leaveRes.isSuccess()).toBe(true);

    expect(session.seatManager.getHumanCount()).toBe(1);
    expect(session.seatManager.getBotCount()).toBe(3);

    const seat2 = session.seatManager.getSeat(2).getOrThrow();
    expect(seat2.isBot).toBe(true);
    expect(seat2.isOccupied).toBe(true);
  });

  it('dispatches game actions and records event history with sequential IDs', () => {
    const service = new ArcadeRealtimeService();
    service.createSession(ArcadeGameEnum.Blackjack, 'BJK-LIVE1', 7, 'Host');

    const act1 = service.dispatchAction('BJK-LIVE1', 'usr_p1', 'hit', { handIndex: 0 });
    expect(act1.isSuccess()).toBe(true);
    expect(act1.getOrThrow().id).toBe(1);

    const act2 = service.dispatchAction('BJK-LIVE1', 'usr_p1', 'stand', {});
    expect(act2.isSuccess()).toBe(true);
    expect(act2.getOrThrow().id).toBe(2);

    const session = service.getSession('BJK-LIVE1').getOrThrow();
    expect(session.events.length).toBe(2);
  });
});
