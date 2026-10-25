import { createHash, randomUUID } from 'node:crypto';
import type { Database, Statement } from 'bun:sqlite';
import {
  fromNullable,
  tryCatch,
  type Option,
  type Result
} from '../../utils/fp';
import { currentEpochMs } from '../../utils/dateTime';
import type { SanctuaryDatabase } from './database';
import type {
  GameMoveRecord,
  GameSessionRecord,
  SSEEventType,
  SessionEventRecord,
  SessionParticipantRecord,
  SessionRole,
  SessionStatus,
  SessionTokenRecord
} from '../sse/sseTypes';

export const toErrorString = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/**
 * Functional Repository for Sanctuary Real-Time Sessions, Cross-References & Events.
 */
export class SessionRepository {
  private db: Database;
  private stmtGetSessionById: Statement;
  private stmtGetSessionByCode: Statement;
  private stmtGetParticipantById: Statement;
  private stmtGetParticipantsBySession: Statement;
  private stmtGetParticipantByRole: Statement;
  private stmtGetTokenByHash: Statement;
  private stmtGetMovesBySession: Statement;
  private stmtGetEventsSince: Statement;
  private stmtGetMaxEventSeq: Statement;

  constructor(private sanctuaryDb: SanctuaryDatabase) {
    this.db = sanctuaryDb.getRawDb();

    this.stmtGetSessionById = this.db.prepare(
      'SELECT * FROM game_sessions WHERE id = ? LIMIT 1'
    );
    this.stmtGetSessionByCode = this.db.prepare(
      'SELECT * FROM game_sessions WHERE session_code = ? LIMIT 1'
    );
    this.stmtGetParticipantById = this.db.prepare(
      'SELECT * FROM session_participants WHERE id = ? LIMIT 1'
    );
    this.stmtGetParticipantsBySession = this.db.prepare(
      'SELECT * FROM session_participants WHERE session_id = ? ORDER BY connected_at ASC'
    );
    this.stmtGetParticipantByRole = this.db.prepare(
      'SELECT * FROM session_participants WHERE session_id = ? AND role = ? LIMIT 1'
    );
    this.stmtGetTokenByHash = this.db.prepare(
      'SELECT * FROM session_tokens WHERE token_hash = ? AND expires_at > ? LIMIT 1'
    );
    this.stmtGetMovesBySession = this.db.prepare(
      'SELECT * FROM game_moves WHERE session_id = ? ORDER BY ply ASC'
    );
    this.stmtGetEventsSince = this.db.prepare(
      'SELECT * FROM session_events WHERE session_id = ? AND event_seq > ? ORDER BY event_seq ASC'
    );
    this.stmtGetMaxEventSeq = this.db.prepare(
      'SELECT COALESCE(MAX(event_seq), 0) AS max_seq FROM session_events WHERE session_id = ?'
    );
  }

  public hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  // ==========================================================================
  // Session Methods
  // ==========================================================================

  public createSession(session: {
    id?: string;
    sessionCode: string;
    theme?: string;
    allowUndo?: boolean;
    timeControlInitialSec?: number | null;
    timeControlIncrementSec?: number;
  }): Result<GameSessionRecord, string> {
    return tryCatch(() => {
      const id = session.id || randomUUID();
      const now = currentEpochMs();
      const insert = this.db.prepare(`
        INSERT INTO game_sessions (
          id, session_code, status, current_fen, turn, move_count,
          theme, allow_undo, time_control_initial_sec, time_control_increment_sec,
          white_time_remaining_ms, black_time_remaining_ms, created_at, updated_at
        ) VALUES (
          ?, ?, 'pending', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'w', 0,
          ?, ?, ?, ?,
          ?, ?, ?, ?
        )
      `);

      const initialMs = session.timeControlInitialSec
        ? session.timeControlInitialSec * 1000
        : null;

      insert.run(
        id,
        session.sessionCode,
        session.theme || 'gothic-basilica',
        session.allowUndo ? 1 : 0,
        session.timeControlInitialSec ?? null,
        session.timeControlIncrementSec ?? 0,
        initialMs,
        initialMs,
        now,
        now
      );

      return this.getSessionById(id).getOrThrow('Failed to read back newly created session');
    }, toErrorString);
  }

  public getSessionById(sessionId: string): Option<GameSessionRecord> {
    const row = this.stmtGetSessionById.get(sessionId) as GameSessionRecord | null | undefined;
    return fromNullable(row);
  }

  public getSessionByCode(sessionCode: string): Option<GameSessionRecord> {
    const row = this.stmtGetSessionByCode.get(sessionCode) as GameSessionRecord | null | undefined;
    return fromNullable(row);
  }

  public updateSessionPlayer(
    sessionId: string,
    role: 'white' | 'black',
    participantId: string
  ): Result<void, string> {
    return tryCatch(() => {
      const column = role === 'white' ? 'white_participant_id' : 'black_participant_id';
      const now = currentEpochMs();
      this.db
        .prepare(`UPDATE game_sessions SET ${column} = ?, updated_at = ? WHERE id = ?`)
        .run(participantId, now, sessionId);
    }, toErrorString);
  }

  public updateSessionStatus(
    sessionId: string,
    status: SessionStatus,
    winner: 'w' | 'b' | 'draw' | null = null,
    endedAt: number | null = null
  ): Result<void, string> {
    return tryCatch(() => {
      const now = currentEpochMs();
      this.db
        .prepare(
          'UPDATE game_sessions SET status = ?, winner = ?, ended_at = ?, updated_at = ? WHERE id = ?'
        )
        .run(status, winner, endedAt, now, sessionId);
    }, toErrorString);
  }

  public updateSessionBoard(
    sessionId: string,
    fen: string,
    turn: 'w' | 'b',
    moveCount: number,
    whiteTimeRemainingMs: number | null = null,
    blackTimeRemainingMs: number | null = null
  ): Result<void, string> {
    return tryCatch(() => {
      const now = currentEpochMs();
      this.db
        .prepare(`
          UPDATE game_sessions
          SET current_fen = ?, turn = ?, move_count = ?,
              white_time_remaining_ms = COALESCE(?, white_time_remaining_ms),
              black_time_remaining_ms = COALESCE(?, black_time_remaining_ms),
              updated_at = ?
          WHERE id = ?
        `)
        .run(fen, turn, moveCount, whiteTimeRemainingMs, blackTimeRemainingMs, now, sessionId);
    }, toErrorString);
  }

  public updateSessionTheme(sessionId: string, theme: string): Result<void, string> {
    return tryCatch(() => {
      const now = currentEpochMs();
      this.db
        .prepare('UPDATE game_sessions SET theme = ?, updated_at = ? WHERE id = ?')
        .run(theme, now, sessionId);
    }, toErrorString);
  }

  // ==========================================================================
  // Participant Methods
  // ==========================================================================

  public createParticipant(participant: {
    sessionId: string;
    userId: string;
    role: SessionRole;
    displayName: string;
  }): Result<SessionParticipantRecord, string> {
    return tryCatch(() => {
      const id = randomUUID();
      const now = currentEpochMs();
      this.db
        .prepare(`
          INSERT INTO session_participants (
            id, session_id, user_id, role, display_name,
            is_connected, last_heartbeat_at, connected_at
          ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
        `)
        .run(
          id,
          participant.sessionId,
          participant.userId,
          participant.role,
          participant.displayName,
          now,
          now
        );

      return this.getParticipantById(id).getOrThrow('Failed to retrieve newly created participant');
    }, toErrorString);
  }

  public getParticipantById(participantId: string): Option<SessionParticipantRecord> {
    const row = this.stmtGetParticipantById.get(participantId) as
      | SessionParticipantRecord
      | null
      | undefined;
    return fromNullable(row);
  }

  public getParticipantsBySession(sessionId: string): SessionParticipantRecord[] {
    return (this.stmtGetParticipantsBySession.all(sessionId) || []) as SessionParticipantRecord[];
  }

  public getParticipantByRole(
    sessionId: string,
    role: SessionRole
  ): Option<SessionParticipantRecord> {
    const row = this.stmtGetParticipantByRole.get(sessionId, role) as
      | SessionParticipantRecord
      | null
      | undefined;
    return fromNullable(row);
  }

  public updateParticipantHeartbeat(
    participantId: string,
    isConnected: boolean = true
  ): Result<void, string> {
    return tryCatch(() => {
      const now = currentEpochMs();
      this.db
        .prepare(
          'UPDATE session_participants SET is_connected = ?, last_heartbeat_at = ? WHERE id = ?'
        )
        .run(isConnected ? 1 : 0, now, participantId);
    }, toErrorString);
  }

  public disconnectParticipant(participantId: string): Result<void, string> {
    return tryCatch(() => {
      const now = currentEpochMs();
      this.db
        .prepare(
          'UPDATE session_participants SET is_connected = 0, disconnected_at = ? WHERE id = ?'
        )
        .run(now, participantId);
    }, toErrorString);
  }

  // ==========================================================================
  // Bearer Token Methods
  // ==========================================================================

  public createToken(
    sessionId: string,
    participantId: string,
    role: SessionRole,
    rawToken: string,
    ttlMs: number = 24 * 60 * 60 * 1000
  ): Result<SessionTokenRecord, string> {
    return tryCatch(() => {
      const id = randomUUID();
      const tokenHash = this.hashToken(rawToken);
      const now = currentEpochMs();
      const expiresAt = now + ttlMs;

      this.db
        .prepare(`
          INSERT INTO session_tokens (id, session_id, participant_id, token_hash, role, expires_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(id, sessionId, participantId, tokenHash, role, expiresAt, now);

      return {
        id,
        session_id: sessionId,
        participant_id: participantId,
        token_hash: tokenHash,
        role,
        expires_at: expiresAt,
        created_at: now
      };
    }, toErrorString);
  }

  public verifyToken(rawToken: string): Option<SessionTokenRecord> {
    const tokenHash = this.hashToken(rawToken);
    const now = currentEpochMs();
    const row = this.stmtGetTokenByHash.get(tokenHash, now) as
      | SessionTokenRecord
      | null
      | undefined;
    return fromNullable(row);
  }

  // ==========================================================================
  // Move Methods
  // ==========================================================================

  public recordMove(move: {
    sessionId: string;
    participantId: string | null;
    moveNumber: number;
    ply: number;
    color: 'w' | 'b';
    san: string;
    uci: string;
    fenBefore: string;
    fenAfter: string;
    timeTakenMs?: number;
  }): Result<GameMoveRecord, string> {
    return tryCatch(() => {
      const id = randomUUID();
      const now = currentEpochMs();

      this.db
        .prepare(`
          INSERT INTO game_moves (
            id, session_id, participant_id, move_number, ply,
            color, san, uci, fen_before, fen_after, time_taken_ms, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          id,
          move.sessionId,
          move.participantId,
          move.moveNumber,
          move.ply,
          move.color,
          move.san,
          move.uci,
          move.fenBefore,
          move.fenAfter,
          move.timeTakenMs ?? 0,
          now
        );

      return {
        id,
        session_id: move.sessionId,
        participant_id: move.participantId,
        move_number: move.moveNumber,
        ply: move.ply,
        color: move.color,
        san: move.san,
        uci: move.uci,
        fen_before: move.fenBefore,
        fen_after: move.fenAfter,
        time_taken_ms: move.timeTakenMs ?? 0,
        created_at: now
      };
    }, toErrorString);
  }

  public getMovesBySession(sessionId: string): GameMoveRecord[] {
    return (this.stmtGetMovesBySession.all(sessionId) || []) as GameMoveRecord[];
  }

  // ==========================================================================
  // Event & SSE Replay Methods
  // ==========================================================================

  public recordEvent(
    sessionId: string,
    eventType: SSEEventType,
    payload: unknown
  ): Result<SessionEventRecord, string> {
    return this.sanctuaryDb.transaction(() => {
      const row = this.stmtGetMaxEventSeq.get(sessionId) as { max_seq: number } | undefined;
      const nextSeq = (row?.max_seq ?? 0) + 1;
      const id = randomUUID();
      const now = currentEpochMs();
      const payloadJson = JSON.stringify(payload);

      this.db
        .prepare(`
          INSERT INTO session_events (id, session_id, event_seq, event_type, payload_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(id, sessionId, nextSeq, eventType, payloadJson, now);

      return {
        id,
        session_id: sessionId,
        event_seq: nextSeq,
        event_type: eventType,
        payload_json: payloadJson,
        created_at: now
      };
    });
  }

  public getEventsSince(sessionId: string, lastEventSeq: number): SessionEventRecord[] {
    return (this.stmtGetEventsSince.all(sessionId, lastEventSeq) || []) as SessionEventRecord[];
  }

  public getSessionAuditSummary(sessionId: string): Option<{
    session: GameSessionRecord;
    participants: SessionParticipantRecord[];
    moveCount: number;
    eventCount: number;
  }> {
    return this.getSessionById(sessionId).map(session => {
      const participants = this.getParticipantsBySession(sessionId);
      const moves = this.getMovesBySession(sessionId);
      const row = this.stmtGetMaxEventSeq.get(sessionId) as { max_seq: number } | undefined;
      return {
        session,
        participants,
        moveCount: moves.length,
        eventCount: row?.max_seq ?? 0
      };
    });
  }

  /**
   * Cascade-deletes all sessions created prior to the cutoff timestamp.
   * Foreign keys with ON DELETE CASCADE automatically purge associated participants,
   * tokens, moves, and events.
   */
  public pruneStaleSessions(olderThanTimestamp: number): Result<{ deletedSessions: number }, string> {
    return this.sanctuaryDb.transaction(() => {
      const info = this.db
        .prepare('DELETE FROM game_sessions WHERE updated_at < ?')
        .run(olderThanTimestamp);
      return { deletedSessions: info.changes };
    });
  }

  /**
   * Records a structured observability log into the Hungarian-prefixed `tbl_audit_cleanup_logs` table.
   */
  public recordCleanupAudit(entry: {
    traceId: string;
    triggerSource: 'cron_hook' | 'cli_manual' | 'api_maintenance';
    deletedSessions: number;
    cutoffTimestamp: string;
    prunedCodes: string[];
    durationMs: number;
    success: boolean;
    errorMessage?: string;
  }): Result<{ id: string; txt_trace_id: string; int_deleted_sessions: number }, string> {
    return tryCatch(() => {
      const id = randomUUID();
      const now = currentEpochMs();
      const prunedCodesJson = JSON.stringify(entry.prunedCodes);
      this.db
        .prepare(`
          INSERT INTO tbl_audit_cleanup_logs (
            id, txt_trace_id, txt_trigger_source, int_deleted_sessions,
            txt_cutoff_timestamp, txt_pruned_codes_json, int_duration_ms,
            bln_success, txt_error_message, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          id,
          entry.traceId,
          entry.triggerSource,
          entry.deletedSessions,
          entry.cutoffTimestamp,
          prunedCodesJson,
          entry.durationMs,
          entry.success ? 1 : 0,
          entry.errorMessage || null,
          now
        );

      return {
        id,
        txt_trace_id: entry.traceId,
        int_deleted_sessions: entry.deletedSessions
      };
    }, toErrorString);
  }

  public getCleanupAudits(limit: number = 20): Array<{
    id: string;
    txt_trace_id: string;
    txt_trigger_source: string;
    int_deleted_sessions: number;
    txt_cutoff_timestamp: string;
    txt_pruned_codes_json: string;
    int_duration_ms: number;
    bln_success: number;
    txt_error_message: string | null;
    created_at: number;
  }> {
    return (this.db
      .prepare('SELECT * FROM tbl_audit_cleanup_logs ORDER BY created_at DESC LIMIT ?')
      .all(limit) || []) as any;
  }
}
