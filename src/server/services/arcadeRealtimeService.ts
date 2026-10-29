import { randomUUID } from 'crypto';
import {
  Option,
  Result,
  success,
  failure,
  tryCatch,
  fromNullable
} from '../../utils/fp';
import {
  ArcadeGameEnum,
  REAL_LIFE_GAME_CAPACITIES
} from '../../constants/gameEnums';
import { logger } from '../../utils/logger';
import { TableSeatManager } from '../../games/multiplayer/tableSeatManager';
import { currentEpochMs } from '../../utils/dateTime';

export interface ArcadeRealtimeEvent {
  id: number;
  sessionCode: string;
  eventType: string;
  participantId: string;
  data: Record<string, unknown>;
  timestamp: number;
}

export interface ArcadeSessionState {
  id: string;
  sessionCode: string;
  game: ArcadeGameEnum;
  maxSeats: number;
  hostParticipantId: string;
  seatManager: TableSeatManager<Record<string, unknown>>;
  events: ArcadeRealtimeEvent[];
  eventCounter: number;
  createdAt: number;
  updatedAt: number;
  subscribers: Map<string, ReadableStreamDefaultController<Uint8Array>>;
}

export class ArcadeRealtimeService {
  private sessions: Map<string, ArcadeSessionState> = new Map();

  public createSession(game: ArcadeGameEnum,
                       sessionCode: string,
                       requestedSeats?: number,
                       creatorName: string = 'Host Player'): Result<ArcadeSessionState, string> {
    return tryCatch(
      () => {
        const capacity = REAL_LIFE_GAME_CAPACITIES[game];
        const maxSeats = requestedSeats
          ? Math.max(capacity.minPlayers, Math.min(capacity.maxPlayers, requestedSeats))
          : capacity.standardTableSeats;

        const seatManager = new TableSeatManager(maxSeats, capacity.minPlayers);
        // Fill table with bots initially for multiplayer games
        if (game !== ArcadeGameEnum.Solitaire) {
          seatManager.fillEmptySeatsWithBots('micro-neural', `${game.toUpperCase()}_Bot`);
        }

        // Creator claims seat 1
        const creatorId = 'host_' + randomUUID().slice(0, 8);
        seatManager.claimSeat(1, creatorId, creatorName, undefined, true);

        const now = currentEpochMs();
        const session: ArcadeSessionState = {
          id: randomUUID(),
          sessionCode,
          game,
          maxSeats,
          hostParticipantId: creatorId,
          seatManager,
          events: [],
          eventCounter: 0,
          createdAt: now,
          updatedAt: now,
          subscribers: new Map()
        };

        this.sessions.set(sessionCode, session);
        logger.info(`[SERVER_SIDE] [ARCADE_REALTIME] Session created: ${sessionCode} (${game}, ${maxSeats} seats)`);
        return session;
      },
      err => `Failed to create arcade session: ${String(err)}`
    );
  }

  public getSession(sessionCode: string): Option<ArcadeSessionState> {
    return fromNullable(this.sessions.get(sessionCode));
  }

  public joinSession(sessionCode: string,
                     participantId: string,
                     displayName: string): Result<{ seatNumber: number; session: ArcadeSessionState }, string> {
    const sessionOpt = this.getSession(sessionCode);
    if (!sessionOpt.isSome()) {
      return failure(`Arcade session '${sessionCode}' not found.`);
    }

    const session = sessionOpt.getOrThrow();

    if (session.game === ArcadeGameEnum.Solitaire) {
      const seat1 = session.seatManager.getSeat(1);
      if (seat1.isSome() && !seat1.getOrThrow().isBot && seat1.getOrThrow().playerId !== participantId) {
        // Solitaire: single active player table, subsequent joiners join as spectators
        this.broadcast(sessionCode, 'spectator_joined', participantId, {
          participantId,
          displayName,
          isSpectator: true,
          totalHumans: session.seatManager.getHumanCount()
        });
        return success({ seatNumber: 0, session });
      }
    }

    const claimRes = session.seatManager.claimAnyAvailableSeat(participantId, displayName);
    if (!claimRes.isSuccess()) {
      return claimRes.match({
        Ok: () => failure('Unexpected seat claim state.'),
        Err: err => failure(err)
      });
    }

    const seat = claimRes.getOrThrow();

    // Broadcast seat claimed event to all connected players
    this.broadcast(sessionCode, 'seat_claimed', participantId, {
      seatNumber: seat.seatNumber,
      participantId,
      displayName,
      isBot: false,
      totalHumans: session.seatManager.getHumanCount(),
      totalBots: session.seatManager.getBotCount()
    });

    return success({ seatNumber: seat.seatNumber, session });
  }

  public leaveSession(sessionCode: string,
                      participantId: string): Result<string, string> {
    const sessionOpt = this.getSession(sessionCode);
    if (!sessionOpt.isSome()) return failure('Session not found.');

    const session = sessionOpt.getOrThrow();
    const occupied = session.seatManager.getOccupiedSeats();
    const userSeat = occupied.find((s: { playerId: string | null }) => s.playerId === participantId);

    if (!userSeat) {
      if (session.game === ArcadeGameEnum.Solitaire) {
        this.broadcast(sessionCode, 'spectator_left', participantId, {
          participantId
        });
        return success(`Spectator '${participantId}' left the table.`);
      }
      return failure(`Participant '${participantId}' not found at table.`);
    }

    // Vacate seat and restore bot so the table never halts
    session.seatManager.vacateSeat(userSeat.seatNumber, `${session.game.toUpperCase()}_Bot`);

    this.broadcast(sessionCode, 'bot_restored', participantId, {
      seatNumber: userSeat.seatNumber,
      vacatedPlayerId: participantId,
      restoredBotName: userSeat.playerName,
      totalHumans: session.seatManager.getHumanCount(),
      totalBots: session.seatManager.getBotCount()
    });

    return success(`Participant '${participantId}' vacated. Bot restored to seat ${userSeat.seatNumber}.`);
  }

  public kickPlayer(sessionCode: string,
                    hostParticipantId: string,
                    targetParticipantId: string,
                    reason: string = 'Removed by table host'): Result<{ kickedParticipantId: string; seatNumber: number }, string> {
    const sessionOpt = this.getSession(sessionCode);
    if (!sessionOpt.isSome()) return failure('Session not found.');

    const session = sessionOpt.getOrThrow();

    // Verify host permission
    if (session.hostParticipantId && session.hostParticipantId !== hostParticipantId) {
      return failure('Only the match host can kick players.');
    }

    if (hostParticipantId === targetParticipantId) {
      return failure('Host cannot kick themselves.');
    }

    const occupied = session.seatManager.getOccupiedSeats();
    const userSeat = occupied.find(s => s.playerId === targetParticipantId);
    if (!userSeat) {
      return failure(`Participant '${targetParticipantId}' not found at table.`);
    }

    const targetSeatNumber = userSeat.seatNumber;
    session.seatManager.vacateSeat(targetSeatNumber, `${session.game.toUpperCase()}_Bot`);

    this.broadcast(sessionCode, 'player_kicked', hostParticipantId, {
      targetParticipantId,
      seatNumber: targetSeatNumber,
      reason,
      totalHumans: session.seatManager.getHumanCount(),
      totalBots: session.seatManager.getBotCount()
    });

    logger.info(
      `[ARCADE_REALTIME] Host '${hostParticipantId}' kicked participant '${targetParticipantId}' ` +
        `from seat ${targetSeatNumber} in session ${sessionCode}`
    );

    return success({ kickedParticipantId: targetParticipantId, seatNumber: targetSeatNumber });
  }

  public dispatchAction(sessionCode: string,
                        participantId: string,
                        actionType: string,
                        payload: Record<string, unknown>): Result<ArcadeRealtimeEvent, string> {
    const sessionOpt = this.getSession(sessionCode);
    if (!sessionOpt.isSome()) return failure('Session not found.');

    const event = this.broadcast(sessionCode, 'game_action', participantId, {
      actionType,
      payload,
      timestamp: currentEpochMs()
    });

    return success(event);
  }

  public subscribe(sessionCode: string,
                   participantId: string,
                   controller: ReadableStreamDefaultController<Uint8Array>,
                   lastEventId?: number): void {
    const sessionOpt = this.getSession(sessionCode);
    if (!sessionOpt.isSome()) return;

    const session = sessionOpt.getOrThrow();
    session.subscribers.set(participantId, controller);

    try {
      // Initial greeting
      const encoder = new TextEncoder();
      controller.enqueue(
        encoder.encode(`event: connected\ndata: ${JSON.stringify({ sessionCode, maxSeats: session.maxSeats })}\n\n`)
      );

      // Replay missed events if client reconnected with Last-Event-ID
      if (typeof lastEventId === 'number' && lastEventId > 0) {
        const missed = session.events.filter((e: ArcadeRealtimeEvent) => e.id > lastEventId);
        missed.forEach((e: ArcadeRealtimeEvent) => {
          controller.enqueue(
            encoder.encode(`id: ${e.id}\nevent: ${e.eventType}\ndata: ${JSON.stringify(e.data)}\n\n`)
          );
        });
      }
    } catch (err) {
      logger.warn(`[ARCADE_REALTIME] Failed to deliver initial stream greeting to ${participantId}: ${String(err)}`);
      session.subscribers.delete(participantId);
    }
  }

  public unsubscribe(sessionCode: string,
                     participantId: string): void {
    const sessionOpt = this.getSession(sessionCode);
    if (sessionOpt.isSome()) {
      sessionOpt.getOrThrow().subscribers.delete(participantId);
    }
  }

  public broadcast(sessionCode: string,
                   eventType: string,
                   participantId: string,
                   data: Record<string, unknown>): ArcadeRealtimeEvent {
    const session = this.sessions.get(sessionCode)!;
    session.eventCounter += 1;
    const now = currentEpochMs();

    const event: ArcadeRealtimeEvent = {
      id: session.eventCounter,
      sessionCode,
      eventType,
      participantId,
      data,
      timestamp: now
    };

    session.events.push(event);
    session.updatedAt = now;

    // Send to all active SSE subscribers
    const encoder = new TextEncoder();
    const sseChunk = encoder.encode(
      `id: ${event.id}\nevent: ${event.eventType}\ndata: ${JSON.stringify(event.data)}\n\n`
    );

    session.subscribers.forEach((controller, subId) => {
      try {
        controller.enqueue(sseChunk);
      } catch (err) {
        session.subscribers.delete(subId);
      }
    });

    return event;
  }
}
