import { describe, expect, it } from 'bun:test';
import { ArcadeRealtimeService } from '../src/server/services/arcadeRealtimeService';
import { ArcadeGameEnum, REAL_LIFE_GAME_CAPACITIES } from '../src/constants/gameEnums';

describe('ArcadeRealtimeService - Multi-Game Real-Time Seating & Bot Hot-Swapping', () => {
  it('creates sessions for all 8 arcade games with respective maximum real-life player capacities', () => {
    const service = new ArcadeRealtimeService();

    const games: ArcadeGameEnum[] = [
      ArcadeGameEnum.Chess,
      ArcadeGameEnum.Blackjack,
      ArcadeGameEnum.Poker,
      ArcadeGameEnum.SkipBo,
      ArcadeGameEnum.Phase10,
      ArcadeGameEnum.Uno,
      ArcadeGameEnum.Avalon,
      ArcadeGameEnum.Set
    ];

    games.forEach((game, idx) => {
      const code = `CODE-${idx}`;
      const capacity = REAL_LIFE_GAME_CAPACITIES[game];
      const res = service.createSession(game, code, capacity.maxPlayers, `Host ${game}`);
      expect(res.isSuccess()).toBe(true);

      const session = res.getOrThrow();
      expect(session.game).toBe(game);
      expect(session.maxSeats).toBe(capacity.maxPlayers);
      expect(session.seatManager.getHumanCount()).toBe(1);
      expect(session.seatManager.getBotCount()).toBe(capacity.maxPlayers - 1);
      expect(session.seatManager.getTotalOccupants()).toBe(capacity.maxPlayers);
    });
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

  it('handles error paths: unknown sessions and leaving non-existent table seats', () => {
    const service = new ArcadeRealtimeService();

    // 1. Join non-existent session
    expect(service.joinSession('NON_EXISTENT', 'p1', 'Alice').isFailure()).toBe(true);

    // 2. Leave non-existent session
    expect(service.leaveSession('NON_EXISTENT', 'p1').isFailure()).toBe(true);

    // 3. Leave session where participant is not seated
    service.createSession(ArcadeGameEnum.Chess, 'SANCT-ERR', 2, 'Host');
    expect(service.leaveSession('SANCT-ERR', 'intruder').isFailure()).toBe(true);

    // 4. Dispatch action to non-existent session
    expect(service.dispatchAction('NON_EXISTENT', 'p1', 'move', {}).isFailure()).toBe(true);

    // 5. Subscribe to non-existent session safely
    const mockController = {
      enqueue: () => {}
    } as any;
    service.subscribe('NON_EXISTENT', 'p1', mockController);
    service.unsubscribe('NON_EXISTENT', 'p1');

    // 6. Join when table is full of humans
    service.createSession(ArcadeGameEnum.Chess, 'SANCT-FULL', 2, 'Player 1');
    expect(service.joinSession('SANCT-FULL', 'p2', 'Player 2').isSuccess()).toBe(true);
    // 3rd human joining a 2-seat chess table fails
    const fullRes = service.joinSession('SANCT-FULL', 'p3', 'Player 3');
    expect(fullRes.isFailure()).toBe(true);
  });

  it('subscribes SSE controllers, replays catch-up events, and handles stream drops', () => {
    const service = new ArcadeRealtimeService();
    service.createSession(ArcadeGameEnum.Poker, 'POK-SSE', 6, 'Host');

    // Dispatch 2 initial events
    service.dispatchAction('POK-SSE', 'host', 'bet', { amount: 20 });
    service.dispatchAction('POK-SSE', 'host', 'raise', { amount: 50 });

    const enqueuedMessages: string[] = [];
    const mockController = {
      enqueue: (chunk: Uint8Array) => {
        const text = new TextDecoder().decode(chunk);
        enqueuedMessages.push(text);
      }
    } as any;

    // Subscribe with lastEventId=1 (should receive greeting and event #2 replay)
    service.subscribe('POK-SSE', 'sub_1', mockController, 1);
    expect(enqueuedMessages.length).toBe(2);
    expect(enqueuedMessages[0]).toContain('event: connected');
    expect(enqueuedMessages[1]).toContain('id: 2');

    // Subscribe controller throwing on initial greeting is caught and subscriber evicted
    const explodingGreetingController = {
      enqueue: () => {
        throw new Error('Immediate stream abort');
      }
    } as any;
    service.subscribe('POK-SSE', 'sub_abort', explodingGreetingController);

    // Broadcast a new action -> sent in real-time
    service.dispatchAction('POK-SSE', 'host', 'call', { amount: 50 });
    expect(enqueuedMessages.length).toBe(3);
    expect(enqueuedMessages[2]).toContain('id: 3');

    // Faulty controller throws on enqueue -> service gracefully removes dead subscriber
    let faultyControllerCalls = 0;
    const faultyController = {
      enqueue: (chunk: Uint8Array) => {
        faultyControllerCalls++;
        const text = new TextDecoder().decode(chunk);
        if (text.includes('fold')) {
          throw new Error('Socket closed abruptly on fold');
        }
      }
    } as any;

    service.subscribe('POK-SSE', 'sub_faulty', faultyController);
    expect(faultyControllerCalls).toBe(1); // Initial greeting succeeds

    service.dispatchAction('POK-SSE', 'host', 'fold', {});
    expect(faultyControllerCalls).toBe(2); // Threw on fold and got evicted

    // Next event does not invoke faulty controller again because it was evicted
    service.dispatchAction('POK-SSE', 'host', 'end_round', {});
    expect(faultyControllerCalls).toBe(2);

    // Unsubscribe
    service.unsubscribe('POK-SSE', 'sub_1');
  });
});
