import { randomBytes, randomUUID } from 'node:crypto';
import { Chess } from 'chess.js';
import {
  failure,
  fromNullable,
  success,
  toResult,
  type Result
} from '../../utils/fp';
import { currentEpochMs } from '../../utils/dateTime';
import type { SessionRepository } from '../db/sessionRepository';
import type { SSEManager } from '../sse/sseManager';
import type {
  CreateSessionOptions,
  GameMoveRecord,
  GameSessionRecord,
  JoinSessionOptions,
  SessionAuthResult,
  SessionRole,
  SessionStatus,
  SubmitMoveOptions
} from '../sse/sseTypes';

export class RealtimeChessService {
  constructor(
    private repository: SessionRepository,
    private sseManager: SSEManager
  ) {}

  public generateSessionCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'SANCT-';
    const bytes = randomBytes(4);
    for (let i = 0; i < 4; i++) {
      code += chars[bytes[i]! % chars.length];
    }
    return code;
  }

  public generateSecureToken(): string {
    return randomBytes(32).toString('hex');
  }

  // ==========================================================================
  // Session Creation & Joining
  // ==========================================================================

  public createSession(options: CreateSessionOptions = {}): Result<SessionAuthResult, string> {
    const sessionCode = this.generateSessionCode();
    const createRes = this.repository.createSession({
      sessionCode,
      theme: options.theme,
      allowUndo: options.allowUndo,
      timeControlInitialSec: options.timeControlInitialSec,
      timeControlIncrementSec: options.timeControlIncrementSec
    });

    return createRes.flatMap(session => {
      const creatorRole: SessionRole = options.creatorRole || 'white';
      const displayName = options.creatorDisplayName || 'Architect (Host)';
      const userId = options.userId || randomUUID();

      const partRes = this.repository.createParticipant({
        sessionId: session.id,
        userId,
        role: creatorRole,
        displayName
      });

      return partRes.flatMap(participant => {
        if (creatorRole === 'white' || creatorRole === 'black') {
          this.repository.updateSessionPlayer(session.id, creatorRole, participant.id);
        }

        const rawToken = this.generateSecureToken();
        const tokenRes = this.repository.createToken(
          session.id,
          participant.id,
          creatorRole,
          rawToken
        );

        return tokenRes.flatMap(() => {
          const evtRes = this.repository.recordEvent(session.id, 'session_created', {
            sessionId: session.id,
            sessionCode: session.session_code,
            creatorRole,
            theme: session.theme,
            allowUndo: Boolean(session.allow_undo)
          });

          evtRes.map(evt => this.sseManager.broadcast(session.id, evt));

          const refreshedSession = this.repository
            .getSessionById(session.id)
            .getOrElse(session);

          return success({
            session: refreshedSession,
            participant,
            token: rawToken
          });
        });
      });
    });
  }

  public joinSession(options: JoinSessionOptions): Result<SessionAuthResult, string> {
    const sessionOpt = this.repository.getSessionByCode(options.sessionCode.toUpperCase());
    return sessionOpt.match({
      None: () => failure(`Session code '${options.sessionCode}' not found`),
      Some: session => {
        const whitePart = fromNullable(session.white_participant_id);
        const blackPart = fromNullable(session.black_participant_id);

        let targetRole: SessionRole;
        if (options.role) {
          targetRole = options.role;
          if (targetRole === 'white' && whitePart.isSome()) {
            return failure('White player slot is already occupied in this session');
          }
          if (targetRole === 'black' && blackPart.isSome()) {
            return failure('Black player slot is already occupied in this session');
          }
        } else {
          // Auto-assign open player role, or spectator if both filled
          targetRole = whitePart.match({
            None: () => 'white' as SessionRole,
            Some: () =>
              blackPart.match({
                None: () => 'black' as SessionRole,
                Some: () => 'spectator' as SessionRole
              })
          });
        }

        const userId = options.userId || randomUUID();
        const partRes = this.repository.createParticipant({
          sessionId: session.id,
          userId,
          role: targetRole,
          displayName: options.displayName
        });

        return partRes.flatMap(participant => {
          if (targetRole === 'white' || targetRole === 'black') {
            this.repository.updateSessionPlayer(session.id, targetRole, participant.id);
          }

          // If both players are now present and session was pending, transition to active
          const willHaveWhite = targetRole === 'white' || whitePart.isSome();
          const willHaveBlack = targetRole === 'black' || blackPart.isSome();

          if (session.status === 'pending' && willHaveWhite && willHaveBlack) {
            this.repository.updateSessionStatus(session.id, 'active');
          }

          const rawToken = this.generateSecureToken();
          const tokenRes = this.repository.createToken(
            session.id,
            participant.id,
            targetRole,
            rawToken
          );

          return tokenRes.flatMap(() => {
            const evtRes = this.repository.recordEvent(session.id, 'player_joined', {
              sessionId: session.id,
              participantId: participant.id,
              displayName: participant.display_name,
              role: targetRole
            });

            evtRes.map(evt => this.sseManager.broadcast(session.id, evt));

            const refreshedSession = this.repository
              .getSessionById(session.id)
              .getOrElse(session);

            return success({
              session: refreshedSession,
              participant,
              token: rawToken
            });
          });
        });
      }
    });
  }

  // ==========================================================================
  // In-Game Moves & Rules
  // ==========================================================================

  public submitMove(options: SubmitMoveOptions): Result<GameMoveRecord, string> {
    const tokenRes = toResult(
      this.repository.verifyToken(options.token),
      () => 'Invalid or expired authentication token'
    );

    return tokenRes.flatMap(tokenRecord => {
      if (tokenRecord.session_id !== options.sessionId) {
        return failure('Token does not match requested session ID');
      }

      const sessionRes = toResult(
        this.repository.getSessionById(options.sessionId),
        () => `Session '${options.sessionId}' not found`
      );

      return sessionRes.flatMap(session => {
        if (
          session.status !== 'active' &&
          session.status !== 'check' &&
          session.status !== 'pending'
        ) {
          return failure(`Cannot make moves in '${session.status}' session state`);
        }

        // Role verification: White can only move on White turn, Black on Black turn
        const isWhiteTurn = session.turn === 'w';
        if (isWhiteTurn && tokenRecord.role !== 'white') {
          return failure("It is White's turn to move; participant is not White");
        }
        if (!isWhiteTurn && tokenRecord.role !== 'black') {
          return failure("It is Black's turn to move; participant is not Black");
        }

        // Validate chess move with chess.js
        const chess = new Chess(session.current_fen);
        let moveResult: ReturnType<Chess['move']> | null = null;
        try {
          moveResult = chess.move(options.sanOrUci);
        } catch {
          return failure(`Illegal or invalid chess move: '${options.sanOrUci}'`);
        }

        if (!moveResult) {
          return failure(`Illegal or invalid chess move: '${options.sanOrUci}'`);
        }

        const fenBefore = session.current_fen;
        const fenAfter = chess.fen();
        const nextTurn = chess.turn();
        const nextMoveCount = session.move_count + 1;
        const ply = nextMoveCount;
        const moveNumber = Math.ceil(ply / 2);

        let nextStatus: SessionStatus = 'active';
        let winner: 'w' | 'b' | 'draw' | null = null;
        let endedAt: number | null = null;

        if (chess.in_checkmate()) {
          nextStatus = 'checkmate';
          winner = session.turn; // Current player delivered checkmate
          endedAt = currentEpochMs();
        } else if (chess.in_draw()) {
          nextStatus = chess.in_stalemate() ? 'stalemate' : 'draw_agreement';
          winner = 'draw';
          endedAt = currentEpochMs();
        } else if (chess.in_check()) {
          nextStatus = 'check';
        }

        // Update session in DB
        this.repository.updateSessionBoard(
          session.id,
          fenAfter,
          nextTurn,
          nextMoveCount
        );

        if (nextStatus !== 'active' && nextStatus !== 'check') {
          this.repository.updateSessionStatus(session.id, nextStatus, winner, endedAt);
        } else if (session.status === 'pending') {
          this.repository.updateSessionStatus(session.id, nextStatus);
        }

        // Record game move
        const recordRes = this.repository.recordMove({
          sessionId: session.id,
          participantId: tokenRecord.participant_id,
          moveNumber,
          ply,
          color: session.turn,
          san: moveResult.san,
          uci: `${moveResult.from}${moveResult.to}${moveResult.promotion || ''}`,
          fenBefore,
          fenAfter
        });

        return recordRes.flatMap(recordedMove => {
          // Broadcast SSE move event
          const moveEvt = this.repository.recordEvent(session.id, 'move_made', {
            sessionId: session.id,
            ply,
            moveNumber,
            color: session.turn,
            san: moveResult.san,
            uci: `${moveResult.from}${moveResult.to}${moveResult.promotion || ''}`,
            fen: fenAfter,
            turn: nextTurn,
            status: nextStatus
          });

          moveEvt.map(evt => this.sseManager.broadcast(session.id, evt));

          // Broadcast game_over event if game has concluded
          if (winner !== null) {
            const overEvt = this.repository.recordEvent(session.id, 'game_over', {
              sessionId: session.id,
              status: nextStatus,
              winner,
              reason: nextStatus
            });
            overEvt.map(evt => this.sseManager.broadcast(session.id, evt));
          }

          return success(recordedMove);
        });
      });
    });
  }

  // ==========================================================================
  // Resign & Theme
  // ==========================================================================

  public resign(sessionId: string, token: string): Result<GameSessionRecord, string> {
    const tokenRes = toResult(
      this.repository.verifyToken(token),
      () => 'Invalid token'
    );

    return tokenRes.flatMap(tokenRecord => {
      if (tokenRecord.session_id !== sessionId) {
        return failure('Token session mismatch');
      }

      if (tokenRecord.role !== 'white' && tokenRecord.role !== 'black') {
        return failure('Only playing participants can resign');
      }

      const sessionRes = toResult(
        this.repository.getSessionById(sessionId),
        () => `Session '${sessionId}' not found`
      );

      return sessionRes.flatMap(() => {
        const winner: 'w' | 'b' = tokenRecord.role === 'white' ? 'b' : 'w';
        const endedAt = currentEpochMs();

        this.repository.updateSessionStatus(sessionId, 'resigned', winner, endedAt);

        const resignEvt = this.repository.recordEvent(sessionId, 'resigned', {
          sessionId,
          resigningRole: tokenRecord.role,
          winner
        });
        resignEvt.map(evt => this.sseManager.broadcast(sessionId, evt));

        const overEvt = this.repository.recordEvent(sessionId, 'game_over', {
          sessionId,
          status: 'resigned',
          winner,
          reason: `${tokenRecord.role} resigned`
        });
        overEvt.map(evt => this.sseManager.broadcast(sessionId, evt));

        return toResult(
          this.repository.getSessionById(sessionId),
          () => 'Failed to retrieve session after resignation'
        );
      });
    });
  }

  public changeTheme(
    sessionId: string,
    token: string,
    theme: string
  ): Result<GameSessionRecord, string> {
    const tokenRes = toResult(
      this.repository.verifyToken(token),
      () => 'Invalid token'
    );

    return tokenRes.flatMap(tokenRecord => {
      if (tokenRecord.session_id !== sessionId) {
        return failure('Token session mismatch');
      }

      this.repository.updateSessionTheme(sessionId, theme);

      const evtRes = this.repository.recordEvent(sessionId, 'theme_changed', {
        sessionId,
        theme
      });
      evtRes.map(evt => this.sseManager.broadcast(sessionId, evt));

      return toResult(
        this.repository.getSessionById(sessionId),
        () => 'Failed to retrieve session after theme update'
      );
    });
  }
}
