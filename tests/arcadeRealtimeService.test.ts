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

  it('ends the table when the last human leaves', () => {
    const service = new ArcadeRealtimeService();
    service.createSession(ArcadeGameEnum.Uno, 'UNO-EMPTY1', 4, 'Host');
    service.joinSession('UNO-EMPTY1', 'usr_p2', 'Player 2');
    const hostId = service.getSession('UNO-EMPTY1').getOrThrow().seatManager.getHumanSeats()
      .find(seat => seat.playerId !== 'usr_p2')!.playerId!;

    expect(service.leaveSession('UNO-EMPTY1', 'usr_p2').isSuccess()).toBe(true);
    expect(service.getSession('UNO-EMPTY1').isSome()).toBe(true);
    expect(service.leaveSession('UNO-EMPTY1', hostId).getOrThrow()).toContain('ended');
    expect(service.getSession('UNO-EMPTY1').isSome()).toBe(false);
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

  it('broadcasts actions as action_dispatched with the sender id so clients can drop their own echoes', () => {
    const service = new ArcadeRealtimeService();
    service.createSession(ArcadeGameEnum.Uno, 'UNO-ECHO', 4, 'Host');
    const evt = service.dispatchAction('UNO-ECHO', 'usr_a', 'state_sync', { version: 1 }).getOrThrow();
    expect(evt.eventType).toBe('action_dispatched');
    expect(evt.data.participantId).toBe('usr_a');
    expect(evt.data.actionType).toBe('state_sync');
  });

  it('opens an unknown table on first join with the joiner as host, and rejoins idempotently', () => {
    const service = new ArcadeRealtimeService();
    expect(service.joinSession('POKER-NEW', 'usr_host', 'Ana').isFailure()).toBe(true);

    const first = service.joinSession('POKER-NEW', 'usr_host', 'Ana', ArcadeGameEnum.Poker).getOrThrow();
    expect(first.seatNumber).toBe(1);
    expect(first.session.hostParticipantId).toBe('usr_host');
    expect(first.session.seatManager.getHumanCount()).toBe(1);

    const again = service.joinSession('POKER-NEW', 'usr_host', 'Ana', ArcadeGameEnum.Poker).getOrThrow();
    expect(again.seatNumber).toBe(1);
    expect(again.session.seatManager.getHumanCount()).toBe(1);

    const guest = service.joinSession('POKER-NEW', 'usr_guest', 'Bo', ArcadeGameEnum.Poker).getOrThrow();
    expect(guest.seatNumber).not.toBe(1);
    expect(service.kickPlayer('POKER-NEW', 'usr_host', 'usr_guest').isSuccess()).toBe(true);
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

  it('manages Solitaire session as single player with live spectators', () => {
    const service = new ArcadeRealtimeService();
    const createRes = service.createSession(ArcadeGameEnum.Solitaire, 'SOL-TEST', 1, 'Solitary Pilgrim');
    expect(createRes.isSuccess()).toBe(true);

    const session = createRes.getOrThrow();
    expect(session.game).toBe(ArcadeGameEnum.Solitaire);
    expect(session.seatManager.getHumanCount()).toBe(1);
    expect(session.seatManager.getBotCount()).toBe(0);

    // Second participant joins -> becomes spectator!
    const specJoin = service.joinSession('SOL-TEST', 'usr_spectator_1', 'Friendly Observer');
    expect(specJoin.isSuccess()).toBe(true);
    expect(specJoin.getOrThrow().seatNumber).toBe(0);

    // Spectator leaves -> succeeds without disrupting player
    const specLeave = service.leaveSession('SOL-TEST', 'usr_spectator_1');
    expect(specLeave.isSuccess()).toBe(true);
    expect(session.seatManager.getHumanCount()).toBe(1);
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

  it('allows the session host to kick unwanted participants and restores bots', () => {
    const service = new ArcadeRealtimeService();
    const created = service.createSession(ArcadeGameEnum.Poker, 'POKER-KICK-TEST', 6, 'TableHost').getOrThrow();
    const hostId = created.hostParticipantId;

    // A rogue user joins
    service.joinSession('POKER-KICK-TEST', 'rogue_user_99', 'Troll');
    const session = service.getSession('POKER-KICK-TEST').getOrThrow();
    expect(session.seatManager.getHumanCount()).toBe(2);

    // Non-host attempts to kick -> failure
    const nonHostKick = service.kickPlayer('POKER-KICK-TEST', 'rogue_user_99', hostId);
    expect(nonHostKick.isFailure()).toBe(true);
    expect(nonHostKick.match({ Ok: () => '', Err: e => e.message })).toContain('Only the match host');
    expect(nonHostKick.match({ Ok: () => '', Err: e => e.code })).toBe('ERR_UNAUTHORIZED_HOST');
    expect(nonHostKick.match({ Ok: () => {}, Err: e => e.data.sessionCode })).toBe('POKER-KICK-TEST');

    // Host attempts to kick self -> failure
    const selfKick = service.kickPlayer('POKER-KICK-TEST', hostId, hostId);
    expect(selfKick.isFailure()).toBe(true);
    expect(selfKick.match({ Ok: () => '', Err: e => e.message })).toContain('Host cannot kick themselves');
    expect(selfKick.match({ Ok: () => '', Err: e => e.code })).toBe('ERR_CANNOT_KICK_SELF');

    // Host kicks non-existent player -> failure
    const missingKick = service.kickPlayer('POKER-KICK-TEST', hostId, 'ghost_user');
    expect(missingKick.isFailure()).toBe(true);

    // Host successfully kicks rogue user
    const kickRes = service.kickPlayer('POKER-KICK-TEST', hostId, 'rogue_user_99', 'Disruptive play');
    expect(kickRes.isSuccess()).toBe(true);
    expect(kickRes.getOrThrow().kickedParticipantId).toBe('rogue_user_99');

    // User is vacated, bot is restored
    expect(session.seatManager.getHumanCount()).toBe(1);
    expect(session.seatManager.getBotCount()).toBe(5);

    // Verified event was logged
    const lastEvent = session.events[session.events.length - 1]!;
    expect(lastEvent.eventType).toBe('player_kicked');
    expect((lastEvent.data as any).targetParticipantId).toBe('rogue_user_99');
  });

  it('keeps arcade streams alive with heartbeats and stops when no streams remain', async () => {
    const service = new ArcadeRealtimeService(20);
    service.createSession(ArcadeGameEnum.Uno, 'UNO-BEAT', 4, 'Host');
    const chunks: string[] = [];
    const healthy = { enqueue: (c: Uint8Array) => chunks.push(new TextDecoder().decode(c)) } as any;
    const broken = { enqueue: (c: Uint8Array) => {
      if (new TextDecoder().decode(c).startsWith(':')) throw new Error('closed');
    } } as any;

    expect(service.isHeartbeatRunning()).toBe(false);
    service.subscribe('UNO-BEAT', 'usr_a', healthy);
    service.subscribe('UNO-BEAT', 'usr_b', broken);
    expect(service.isHeartbeatRunning()).toBe(true);

    await new Promise(r => setTimeout(r, 50));
    expect(chunks.some(c => c === ':keepalive\n\n')).toBe(true);
    expect(service.getSession('UNO-BEAT').getOrThrow().subscribers.has('usr_b')).toBe(false);

    service.unsubscribe('UNO-BEAT', 'usr_a');
    expect(service.sendHeartbeat()).toBe(0);
    expect(service.isHeartbeatRunning()).toBe(false);
  });

  it('hands new joiners the latest table snapshot and resumers only what they missed', () => {
    const service = new ArcadeRealtimeService();
    service.createSession(ArcadeGameEnum.Uno, 'UNO-REPLAY', 4, 'Host');
    service.dispatchAction('UNO-REPLAY', 'usr_a', 'state_sync', { version: 1, n: 1 });
    service.dispatchAction('UNO-REPLAY', 'usr_a', 'state_sync', { version: 1, n: 2 });
    service.dispatchAction('UNO-REPLAY', 'usr_a', 'uno_draw', {});
    const read = (lastEventId?: number) => {
      const chunks: string[] = [];
      service.subscribe('UNO-REPLAY', `sub_${lastEventId}`, { enqueue: (c: Uint8Array) => chunks.push(new TextDecoder().decode(c)) } as any, lastEventId);
      service.stopHeartbeat();
      return chunks.join('');
    };
    const fresh = read();
    expect(fresh).toContain('"n":2');
    expect(fresh).toContain('"replayed":true');
    expect(fresh).not.toContain('"n":1');
    expect(fresh).not.toContain('uno_draw');
    const resumed = read(1);
    expect(resumed).toContain('"n":2');
    expect(resumed).toContain('uno_draw');
    expect(resumed).not.toContain('"replayed"');

    service.createSession(ArcadeGameEnum.Uno, 'UNO-EMPTY', 4, 'Host');
    const chunks: string[] = [];
    service.subscribe('UNO-EMPTY', 'sub_empty', { enqueue: (c: Uint8Array) => chunks.push(new TextDecoder().decode(c)) } as any);
    service.stopHeartbeat();
    expect(chunks.join('')).not.toContain('action_dispatched');
  });
});
