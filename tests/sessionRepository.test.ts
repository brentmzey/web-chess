import { beforeEach, describe, expect, it } from 'bun:test';
import { SanctuaryDatabase } from '../src/server/db/database';
import { SessionRepository } from '../src/server/db/sessionRepository';

describe('SessionRepository Functional Data Access & Cross-References', () => {
  let db: SanctuaryDatabase;
  let repo: SessionRepository;

  beforeEach(() => {
    db = new SanctuaryDatabase(':memory:');
    repo = new SessionRepository(db);
  });

  it('creates and retrieves a game session with full relational properties', () => {
    const res = repo.createSession({
      sessionCode: 'SANCT-TEST1',
      theme: 'emerald-citadel',
      allowUndo: true,
      timeControlInitialSec: 300,
      timeControlIncrementSec: 5
    });

    expect(res.isSuccess()).toBe(true);
    const session = res.getOrThrow();
    expect(session.session_code).toBe('SANCT-TEST1');
    expect(session.theme).toBe('emerald-citadel');
    expect(session.allow_undo).toBe(1);
    expect(session.time_control_initial_sec).toBe(300);
    expect(session.time_control_increment_sec).toBe(5);
    expect(session.white_time_remaining_ms).toBe(300000);
    expect(session.status).toBe('pending');
    expect(session.turn).toBe('w');

    const byId = repo.getSessionById(session.id);
    expect(byId.isSome()).toBe(true);
    expect(byId.getOrThrow().session_code).toBe('SANCT-TEST1');

    const byCode = repo.getSessionByCode('SANCT-TEST1');
    expect(byCode.isSome()).toBe(true);

    const nonExistent = repo.getSessionById('missing-id');
    expect(nonExistent.isNone()).toBe(true);
  });

  it('updates session player assignments, status, board state, and theme', () => {
    const session = repo
      .createSession({ sessionCode: 'SANCT-UPD' })
      .getOrThrow();

    const part = repo
      .createParticipant({
        sessionId: session.id,
        userId: 'u-white',
        role: 'white',
        displayName: 'WhitePlayer'
      })
      .getOrThrow();

    // Assign player
    const assignRes = repo.updateSessionPlayer(session.id, 'white', part.id);
    expect(assignRes.isSuccess()).toBe(true);

    // Update status
    const statusRes = repo.updateSessionStatus(session.id, 'active');
    expect(statusRes.isSuccess()).toBe(true);

    // Update board
    const newFen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    const boardRes = repo.updateSessionBoard(session.id, newFen, 'b', 1, 298000, 300000);
    expect(boardRes.isSuccess()).toBe(true);

    // Update theme
    const themeRes = repo.updateSessionTheme(session.id, 'astral-observatory');
    expect(themeRes.isSuccess()).toBe(true);

    const updated = repo.getSessionById(session.id).getOrThrow();
    expect(updated.white_participant_id).toBe(part.id);
    expect(updated.status).toBe('active');
    expect(updated.current_fen).toBe(newFen);
    expect(updated.turn).toBe('b');
    expect(updated.move_count).toBe(1);
    expect(updated.white_time_remaining_ms).toBe(298000);
    expect(updated.theme).toBe('astral-observatory');
  });

  it('manages session participants, roles, heartbeats, and disconnection', () => {
    const session = repo
      .createSession({ sessionCode: 'SANCT-PART' })
      .getOrThrow();

    const p1 = repo
      .createParticipant({
        sessionId: session.id,
        userId: 'u-1',
        role: 'white',
        displayName: 'Player One'
      })
      .getOrThrow();

    const p2 = repo
      .createParticipant({
        sessionId: session.id,
        userId: 'u-2',
        role: 'spectator',
        displayName: 'Audience Member'
      })
      .getOrThrow();

    const participants = repo.getParticipantsBySession(session.id);
    expect(participants.length).toBe(2);

    const foundWhite = repo.getParticipantByRole(session.id, 'white');
    expect(foundWhite.isSome()).toBe(true);
    expect(foundWhite.getOrThrow().id).toBe(p1.id);

    const foundBlack = repo.getParticipantByRole(session.id, 'black');
    expect(foundBlack.isNone()).toBe(true);

    // Heartbeat update
    const hbRes = repo.updateParticipantHeartbeat(p1.id, true);
    expect(hbRes.isSuccess()).toBe(true);

    // Disconnect update
    const discRes = repo.disconnectParticipant(p2.id);
    expect(discRes.isSuccess()).toBe(true);

    const p2After = repo.getParticipantById(p2.id).getOrThrow();
    expect(p2After.is_connected).toBe(0);
    expect(p2After.disconnected_at).toBeGreaterThan(0);
  });

  it('creates and verifies SHA-256 hashed bearer tokens', () => {
    const session = repo
      .createSession({ sessionCode: 'SANCT-TOK' })
      .getOrThrow();

    const p = repo
      .createParticipant({
        sessionId: session.id,
        userId: 'u-tok',
        role: 'white',
        displayName: 'Bearer User'
      })
      .getOrThrow();

    const rawToken = 'super-secret-random-token-xyz';
    const tokRes = repo.createToken(session.id, p.id, 'white', rawToken, 3600000);
    expect(tokRes.isSuccess()).toBe(true);

    // Token must be verified successfully with raw token
    const verified = repo.verifyToken(rawToken);
    expect(verified.isSome()).toBe(true);
    const tokenRec = verified.getOrThrow();
    expect(tokenRec.participant_id).toBe(p.id);
    expect(tokenRec.role).toBe('white');
    expect(tokenRec.token_hash).toBe(repo.hashToken(rawToken));

    // Invalid raw token fails
    const invalid = repo.verifyToken('wrong-token');
    expect(invalid.isNone()).toBe(true);

    // Expired token fails
    const expiredRawToken = 'expired-token-123';
    repo.createToken(session.id, p.id, 'white', expiredRawToken, -1000);
    const expiredCheck = repo.verifyToken(expiredRawToken);
    expect(expiredCheck.isNone()).toBe(true);
  });

  it('records moves and retrieves sequential ply history', () => {
    const session = repo
      .createSession({ sessionCode: 'SANCT-MOV' })
      .getOrThrow();

    const moveRes = repo.recordMove({
      sessionId: session.id,
      participantId: null,
      moveNumber: 1,
      ply: 1,
      color: 'w',
      san: 'e4',
      uci: 'e2e4',
      fenBefore: 'start-fen',
      fenAfter: 'after-e4',
      timeTakenMs: 1200
    });

    expect(moveRes.isSuccess()).toBe(true);
    const moves = repo.getMovesBySession(session.id);
    expect(moves.length).toBe(1);
    expect(moves[0]!.san).toBe('e4');
    expect(moves[0]!.uci).toBe('e2e4');
    expect(moves[0]!.time_taken_ms).toBe(1200);
  });

  it('records sequential SSE events and replays events since lastEventSeq', () => {
    const session = repo
      .createSession({ sessionCode: 'SANCT-EVT' })
      .getOrThrow();

    const e1 = repo
      .recordEvent(session.id, 'session_created', { code: session.session_code })
      .getOrThrow();
    const e2 = repo
      .recordEvent(session.id, 'player_joined', { role: 'white' })
      .getOrThrow();
    const e3 = repo
      .recordEvent(session.id, 'move_made', { san: 'e4' })
      .getOrThrow();

    expect(e1.event_seq).toBe(1);
    expect(e2.event_seq).toBe(2);
    expect(e3.event_seq).toBe(3);

    // Query events since seq 1 (should return seq 2 and 3)
    const missed = repo.getEventsSince(session.id, 1);
    expect(missed.length).toBe(2);
    expect(missed[0]!.event_seq).toBe(2);
    expect(missed[1]!.event_seq).toBe(3);

    // Query audit summary
    const auditOpt = repo.getSessionAuditSummary(session.id);
    expect(auditOpt.isSome()).toBe(true);
    const audit = auditOpt.getOrThrow();
    expect(audit.eventCount).toBe(3);
    expect(audit.session.id).toBe(session.id);
  });

  it('prunes stale sessions and cascade-deletes related participants, tokens, moves, and events', () => {
    // Create an old session (simulated created_at in the past)
    const oldSession = repo.createSession({ sessionCode: 'SANCT-OLD' }).getOrThrow();
    db.getRawDb()
      .prepare('UPDATE game_sessions SET created_at = ?, updated_at = ? WHERE id = ?')
      .run(1000, 1000, oldSession.id);

    // Create participant, move, token, event attached to old session
    const part = repo.createParticipant({
      sessionId: oldSession.id,
      userId: 'u-old',
      role: 'white',
      displayName: 'OldPlayer'
    }).getOrThrow();

    repo.createToken(oldSession.id, part.id, 'white', 'token-old', 3600000);

    repo.recordMove({
      sessionId: oldSession.id,
      participantId: part.id,
      moveNumber: 1,
      ply: 1,
      color: 'w',
      san: 'e4',
      uci: 'e2e4',
      fenBefore: 'start',
      fenAfter: 'after'
    });

    repo.recordEvent(oldSession.id, 'session_created', { code: 'SANCT-OLD' });

    // Create a fresh session
    const freshSession = repo.createSession({ sessionCode: 'SANCT-FRESH' }).getOrThrow();

    // Cutoff between old (1000) and fresh (now)
    const pruneRes = repo.pruneStaleSessions(2000);
    expect(pruneRes.isSuccess()).toBe(true);
    expect(pruneRes.getOrThrow().deletedSessions).toBe(1);

    // Verify old session and children are gone
    expect(repo.getSessionById(oldSession.id).isNone()).toBe(true);
    expect(repo.getParticipantsBySession(oldSession.id).length).toBe(0);
    expect(repo.getMovesBySession(oldSession.id).length).toBe(0);
    expect(repo.getEventsSince(oldSession.id, 0).length).toBe(0);

    // Verify fresh session still exists
    expect(repo.getSessionById(freshSession.id).isSome()).toBe(true);
  });

  it('records and queries Hungarian-prefixed audit logs in tbl_audit_cleanup_logs', () => {
    const auditRes = repo.recordCleanupAudit({
      traceId: 'trc_test_123',
      triggerSource: 'cli_manual',
      deletedSessions: 3,
      cutoffTimestamp: '2026-10-23 00:00:00.000',
      prunedCodes: ['SANCT-1', 'SANCT-2', 'SANCT-3'],
      durationMs: 450,
      success: true
    });

    expect(auditRes.isSuccess()).toBe(true);
    const rec = auditRes.getOrThrow();
    expect(rec.txt_trace_id).toBe('trc_test_123');
    expect(rec.int_deleted_sessions).toBe(3);

    const logs = repo.getCleanupAudits(10);
    expect(logs.length).toBeGreaterThanOrEqual(1);
    const first = logs[0]!;
    expect(first.txt_trace_id).toBe('trc_test_123');
    expect(first.txt_trigger_source).toBe('cli_manual');
    expect(first.int_deleted_sessions).toBe(3);
    expect(first.bln_success).toBe(1);
    expect(JSON.parse(first.txt_pruned_codes_json)).toEqual(['SANCT-1', 'SANCT-2', 'SANCT-3']);
  });

  it('converts error types accurately with toErrorString', () => {
    const { toErrorString } = require('../src/server/db/sessionRepository');
    expect(toErrorString(new Error('Sample error'))).toBe('Sample error');
    expect(toErrorString('Plain string error')).toBe('Plain string error');
  });
});
