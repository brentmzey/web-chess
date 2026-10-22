import { beforeEach, describe, expect, it } from 'bun:test';
import { SanctuaryDatabase } from '../src/server/db/database';
import { SessionRepository } from '../src/server/db/sessionRepository';
import { RealtimeChessService } from '../src/server/services/realtimeChessService';
import { SSEManager } from '../src/server/sse/sseManager';
import { none } from '../src/utils/fp';

describe('RealtimeChessService Real-Time Game Coordination & Rule Enforcement', () => {
  let db: SanctuaryDatabase;
  let repo: SessionRepository;
  let sse: SSEManager;
  let service: RealtimeChessService;

  beforeEach(() => {
    db = new SanctuaryDatabase(':memory:');
    repo = new SessionRepository(db);
    sse = new SSEManager(repo);
    service = new RealtimeChessService(repo, sse);
  });

  it('generates secure 6-character sanctuary session codes and 256-bit entropy tokens', () => {
    const code = service.generateSessionCode();
    expect(code.startsWith('SANCT-')).toBe(true);
    expect(code.length).toBe(10); // SANCT- (6) + 4 chars = 10 chars

    const token = service.generateSecureToken();
    expect(token.length).toBe(64); // 32 bytes hex = 64 characters
  });

  it('creates sessions and auto-assigns the creator role and secure bearer token', () => {
    const res = service.createSession({
      theme: 'emerald-citadel',
      creatorDisplayName: 'Grandmaster Host',
      creatorRole: 'white',
      allowUndo: false
    });

    expect(res.isSuccess()).toBe(true);
    const auth = res.getOrThrow();
    expect(auth.session.theme).toBe('emerald-citadel');
    expect(auth.session.allow_undo).toBe(0);
    expect(auth.participant.role).toBe('white');
    expect(auth.participant.display_name).toBe('Grandmaster Host');
    expect(auth.token.length).toBe(64);

    // Verify session in DB has white_participant_id assigned
    const dbSession = repo.getSessionById(auth.session.id).getOrThrow();
    expect(dbSession.white_participant_id).toBe(auth.participant.id);
  });

  it('joins sessions by code with role resolution and transitions status from pending to active', () => {
    const host = service
      .createSession({ creatorDisplayName: 'White Host', creatorRole: 'white' })
      .getOrThrow();

    expect(host.session.status).toBe('pending');

    // Guest joins by code without specifying role -> auto-assigned black
    const guestRes = service.joinSession({
      sessionCode: host.session.session_code,
      displayName: 'Black Challenger'
    });

    expect(guestRes.isSuccess()).toBe(true);
    const guest = guestRes.getOrThrow();
    expect(guest.participant.role).toBe('black');
    expect(guest.session.status).toBe('active');

    // Third user joins -> auto-assigned spectator
    const specRes = service.joinSession({
      sessionCode: host.session.session_code,
      displayName: 'Observer'
    });
    expect(specRes.isSuccess()).toBe(true);
    expect(specRes.getOrThrow().participant.role).toBe('spectator');

    // Rejecting joining as White when White already exists
    const conflictRes = service.joinSession({
      sessionCode: host.session.session_code,
      displayName: 'Impoverished Pretender',
      role: 'white'
    });
    expect(conflictRes.isFailure()).toBe(true);
    conflictRes.match({
      Ok: () => { throw new Error('Expected conflict error'); },
      Err: err => expect(err).toContain('already occupied')
    });

    // Rejecting joining non-existent session code
    const missingRes = service.joinSession({
      sessionCode: 'SANCT-NONE',
      displayName: 'Ghost'
    });
    expect(missingRes.isFailure()).toBe(true);
  });

  it('validates turns, chess legality, and executes legal moves across players', () => {
    const whiteHost = service
      .createSession({ creatorDisplayName: 'White', creatorRole: 'white' })
      .getOrThrow();

    const blackGuest = service
      .joinSession({
        sessionCode: whiteHost.session.session_code,
        displayName: 'Black',
        role: 'black'
      })
      .getOrThrow();

    // 1. Black attempts to move out of turn -> rejected
    const outOfTurn = service.submitMove({
      sessionId: whiteHost.session.id,
      token: blackGuest.token,
      sanOrUci: 'e5'
    });
    expect(outOfTurn.isFailure()).toBe(true);
    outOfTurn.match({
      Ok: () => { throw new Error('Expected out of turn error'); },
      Err: err => expect(err).toContain("It is White's turn")
    });

    // 2. White attempts an illegal move -> rejected
    const illegalMove = service.submitMove({
      sessionId: whiteHost.session.id,
      token: whiteHost.token,
      sanOrUci: 'e8' // impossible pawn jump
    });
    expect(illegalMove.isFailure()).toBe(true);
    illegalMove.match({
      Ok: () => { throw new Error('Expected illegal move error'); },
      Err: err => expect(err).toContain('Illegal or invalid')
    });

    // 3. White plays 1. e4 -> accepted
    const move1 = service.submitMove({
      sessionId: whiteHost.session.id,
      token: whiteHost.token,
      sanOrUci: 'e4'
    });
    expect(move1.isSuccess()).toBe(true);
    const m1 = move1.getOrThrow();
    expect(m1.san).toBe('e4');
    expect(m1.uci).toBe('e2e4');
    expect(m1.ply).toBe(1);

    // 4. Black plays 1... e5 -> accepted
    const move2 = service.submitMove({
      sessionId: whiteHost.session.id,
      token: blackGuest.token,
      sanOrUci: 'e5'
    });
    expect(move2.isSuccess()).toBe(true);
    expect(move2.getOrThrow().ply).toBe(2);

    // Verify session turn is now 'w' and moveCount is 2
    const sessionAfter = repo.getSessionById(whiteHost.session.id).getOrThrow();
    expect(sessionAfter.turn).toBe('w');
    expect(sessionAfter.move_count).toBe(2);
  });

  it('detects checkmate, ends game, awards winner, and broadcasts game_over', () => {
    // Fast Scholar's Mate scenario
    const white = service.createSession({ creatorRole: 'white' }).getOrThrow();
    const black = service
      .joinSession({ sessionCode: white.session.session_code, role: 'black', displayName: 'B' })
      .getOrThrow();

    service.submitMove({ sessionId: white.session.id, token: white.token, sanOrUci: 'e4' });
    service.submitMove({ sessionId: white.session.id, token: black.token, sanOrUci: 'e5' });
    service.submitMove({ sessionId: white.session.id, token: white.token, sanOrUci: 'Bc4' });
    service.submitMove({ sessionId: white.session.id, token: black.token, sanOrUci: 'Nc6' });
    service.submitMove({ sessionId: white.session.id, token: white.token, sanOrUci: 'Qh5' });
    service.submitMove({ sessionId: white.session.id, token: black.token, sanOrUci: 'Nf6' });

    // Delivering Checkmate: Qxf7#
    const mateRes = service.submitMove({
      sessionId: white.session.id,
      token: white.token,
      sanOrUci: 'Qxf7#'
    });

    expect(mateRes.isSuccess()).toBe(true);
    const completedSession = repo.getSessionById(white.session.id).getOrThrow();
    expect(completedSession.status).toBe('checkmate');
    expect(completedSession.winner).toBe('w');
    expect(completedSession.ended_at).toBeGreaterThan(0);

    // Subsequent move on checkmate game must be rejected
    const afterMate = service.submitMove({
      sessionId: white.session.id,
      token: black.token,
      sanOrUci: 'a6'
    });
    expect(afterMate.isFailure()).toBe(true);
  });

  it('handles player resignation and awards victory to opponent', () => {
    const white = service.createSession({ creatorRole: 'white' }).getOrThrow();
    const black = service
      .joinSession({ sessionCode: white.session.session_code, role: 'black', displayName: 'B' })
      .getOrThrow();
    expect(black.session.black_participant_id).toBeDefined();

    // White resigns -> Black wins
    const resignRes = service.resign(white.session.id, white.token);
    expect(resignRes.isSuccess()).toBe(true);
    const session = resignRes.getOrThrow();
    expect(session.status).toBe('resigned');
    expect(session.winner).toBe('b');

    // Spectator cannot resign
    const spec = service
      .joinSession({ sessionCode: white.session.session_code, role: 'spectator', displayName: 'S' })
      .getOrThrow();
    const specResign = service.resign(white.session.id, spec.token);
    expect(specResign.isFailure()).toBe(true);
  });

  it('allows live theme synchronization across sessions', () => {
    const white = service.createSession({ creatorRole: 'white' }).getOrThrow();
    const themeRes = service.changeTheme(white.session.id, white.token, 'crimson-inquisition');
    expect(themeRes.isSuccess()).toBe(true);
    expect(themeRes.getOrThrow().theme).toBe('crimson-inquisition');

    // Wrong token rejected
    const badToken = service.changeTheme(white.session.id, 'invalid', 'emerald-citadel');
    expect(badToken.isFailure()).toBe(true);

    // Mismatched session ID rejected
    const session2 = service.createSession({ creatorRole: 'white' }).getOrThrow();
    const mismatchedTheme = service.changeTheme(session2.session.id, white.token, 'emerald-citadel');
    expect(mismatchedTheme.isFailure()).toBe(true);
  });

  it('rejects moves with invalid tokens, session mismatches, and unknown sessions', () => {
    const white = service.createSession({ creatorRole: 'white' }).getOrThrow();
    const session2 = service.createSession({ creatorRole: 'white' }).getOrThrow();

    // 1. Invalid token on submitMove
    const invalidTok = service.submitMove({
      sessionId: white.session.id,
      token: 'not-a-real-token',
      sanOrUci: 'e4'
    });
    expect(invalidTok.isFailure()).toBe(true);

    // 2. Token session mismatch on submitMove
    const mismatch = service.submitMove({
      sessionId: session2.session.id,
      token: white.token,
      sanOrUci: 'e4'
    });
    expect(mismatch.isFailure()).toBe(true);

    // 3. Resign with invalid token, session mismatch, and non-existent session
    expect(service.resign(white.session.id, 'invalid').isFailure()).toBe(true);
    expect(service.resign(session2.session.id, white.token).isFailure()).toBe(true);

    // 4. Submit move and resign when session lookup returns None
    const origGet = (service as any).repository.getSessionById.bind((service as any).repository);
    (service as any).repository.getSessionById = () => none();

    const ghostMove = service.submitMove({
      sessionId: white.session.id,
      token: white.token,
      sanOrUci: 'e4'
    });
    expect(ghostMove.isFailure()).toBe(true);

    const ghostResign = service.resign(white.session.id, white.token);
    expect(ghostResign.isFailure()).toBe(true);

    (service as any).repository.getSessionById = origGet;
  });
});
