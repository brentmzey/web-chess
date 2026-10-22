import { describe, expect, it } from 'bun:test';
import { SanctuaryDatabase } from '../src/server/db/database';

describe('Sanctuary Real-Time SQL Schema, Foreign Keys & Indices', () => {
  it('initializes in-memory database with foreign keys enabled and all tables created', () => {
    const db = new SanctuaryDatabase(':memory:');
    const raw = db.getRawDb();

    // Verify foreign_keys PRAGMA is enabled
    const fkPragma = raw.query('PRAGMA foreign_keys;').get() as { foreign_keys: number };
    expect(fkPragma.foreign_keys).toBe(1);

    // Verify all 5 tables exist
    const tables = raw
      .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;")
      .all() as { name: string }[];
    const tableNames = tables.map(t => t.name);

    expect(tableNames).toContain('game_sessions');
    expect(tableNames).toContain('session_participants');
    expect(tableNames).toContain('session_tokens');
    expect(tableNames).toContain('game_moves');
    expect(tableNames).toContain('session_events');

    db.close();
  });

  it('enforces CASCADE deletion on participants, tokens, moves, and events when a session is deleted', () => {
    const db = new SanctuaryDatabase(':memory:');
    const raw = db.getRawDb();

    const sessionId = 'session-cascade-test';
    const participantId = 'part-1';
    const tokenId = 'tok-1';
    const moveId = 'mov-1';
    const eventId = 'evt-1';
    const now = Date.now();

    // 1. Insert session
    raw.run(
      `INSERT INTO game_sessions (id, session_code, status, current_fen, turn, move_count, created_at, updated_at)
       VALUES (?, 'SANCT-CASCADE', 'active', 'fen', 'w', 0, ?, ?);`,
      [sessionId, now, now]
    );

    // 2. Insert participant
    raw.run(
      `INSERT INTO session_participants (id, session_id, user_id, role, display_name, is_connected, last_heartbeat_at, connected_at)
       VALUES (?, ?, 'user-1', 'white', 'Player1', 1, ?, ?);`,
      [participantId, sessionId, now, now]
    );

    // 3. Insert token
    raw.run(
      `INSERT INTO session_tokens (id, session_id, participant_id, token_hash, role, expires_at, created_at)
       VALUES (?, ?, ?, 'dummyhash', 'white', ?, ?);`,
      [tokenId, sessionId, participantId, now + 100000, now]
    );

    // 4. Insert move
    raw.run(
      `INSERT INTO game_moves (id, session_id, participant_id, move_number, ply, color, san, uci, fen_before, fen_after, created_at)
       VALUES (?, ?, ?, 1, 1, 'w', 'e4', 'e2e4', 'start', 'after-e4', ?);`,
      [moveId, sessionId, participantId, now]
    );

    // 5. Insert event
    raw.run(
      `INSERT INTO session_events (id, session_id, event_seq, event_type, payload_json, created_at)
       VALUES (?, ?, 1, 'session_created', '{}', ?);`,
      [eventId, sessionId, now]
    );

    // Verify all records exist
    expect(raw.query('SELECT count(*) as c FROM session_participants;').get()).toEqual({ c: 1 });
    expect(raw.query('SELECT count(*) as c FROM session_tokens;').get()).toEqual({ c: 1 });
    expect(raw.query('SELECT count(*) as c FROM game_moves;').get()).toEqual({ c: 1 });
    expect(raw.query('SELECT count(*) as c FROM session_events;').get()).toEqual({ c: 1 });

    // DELETE session -> all referencing child rows must cascade-delete
    raw.run('DELETE FROM game_sessions WHERE id = ?;', [sessionId]);

    expect(raw.query('SELECT count(*) as c FROM game_sessions;').get()).toEqual({ c: 0 });
    expect(raw.query('SELECT count(*) as c FROM session_participants;').get()).toEqual({ c: 0 });
    expect(raw.query('SELECT count(*) as c FROM session_tokens;').get()).toEqual({ c: 0 });
    expect(raw.query('SELECT count(*) as c FROM game_moves;').get()).toEqual({ c: 0 });
    expect(raw.query('SELECT count(*) as c FROM session_events;').get()).toEqual({ c: 0 });

    db.close();
  });

  it('enforces UNIQUE constraint on session_code', () => {
    const db = new SanctuaryDatabase(':memory:');
    const raw = db.getRawDb();
    const now = Date.now();

    raw.run(
      `INSERT INTO game_sessions (id, session_code, status, current_fen, turn, move_count, created_at, updated_at)
       VALUES ('s1', 'SANCT-DUP', 'active', 'fen', 'w', 0, ?, ?);`,
      [now, now]
    );

    expect(() => {
      raw.run(
        `INSERT INTO game_sessions (id, session_code, status, current_fen, turn, move_count, created_at, updated_at)
         VALUES ('s2', 'SANCT-DUP', 'active', 'fen', 'w', 0, ?, ?);`,
        [now, now]
      );
    }).toThrow();

    db.close();
  });

  it('enforces UNIQUE constraint on (session_id, ply) for game moves', () => {
    const db = new SanctuaryDatabase(':memory:');
    const raw = db.getRawDb();
    const now = Date.now();

    raw.run(
      `INSERT INTO game_sessions (id, session_code, status, current_fen, turn, move_count, created_at, updated_at)
       VALUES ('s1', 'SANCT-PLY', 'active', 'fen', 'w', 0, ?, ?);`,
      [now, now]
    );

    raw.run(
      `INSERT INTO game_moves (id, session_id, participant_id, move_number, ply, color, san, uci, fen_before, fen_after, created_at)
       VALUES ('m1', 's1', null, 1, 1, 'w', 'e4', 'e2e4', 'b', 'a', ?);`,
      [now]
    );

    // Duplicate ply 1 for same session must throw
    expect(() => {
      raw.run(
        `INSERT INTO game_moves (id, session_id, participant_id, move_number, ply, color, san, uci, fen_before, fen_after, created_at)
         VALUES ('m2', 's1', null, 1, 1, 'w', 'd4', 'd2d4', 'b', 'a', ?);`,
        [now]
      );
    }).toThrow();

    db.close();
  });

  it('enforces UNIQUE constraint on (session_id, event_seq) for monotonic SSE events', () => {
    const db = new SanctuaryDatabase(':memory:');
    const raw = db.getRawDb();
    const now = Date.now();

    raw.run(
      `INSERT INTO game_sessions (id, session_code, status, current_fen, turn, move_count, created_at, updated_at)
       VALUES ('s1', 'SANCT-EVT', 'active', 'fen', 'w', 0, ?, ?);`,
      [now, now]
    );

    raw.run(
      `INSERT INTO session_events (id, session_id, event_seq, event_type, payload_json, created_at)
       VALUES ('e1', 's1', 1, 'session_created', '{}', ?);`,
      [now]
    );

    expect(() => {
      raw.run(
        `INSERT INTO session_events (id, session_id, event_seq, event_type, payload_json, created_at)
         VALUES ('e2', 's1', 1, 'player_joined', '{}', ?);`,
        [now]
      );
    }).toThrow();

    db.close();
  });

  it('enforces partial UNIQUE constraint on active playing roles (white/black) per session', () => {
    const db = new SanctuaryDatabase(':memory:');
    const raw = db.getRawDb();
    const now = Date.now();

    raw.run(
      `INSERT INTO game_sessions (id, session_code, status, current_fen, turn, move_count, created_at, updated_at)
       VALUES ('s1', 'SANCT-ROLE', 'active', 'fen', 'w', 0, ?, ?);`,
      [now, now]
    );

    raw.run(
      `INSERT INTO session_participants (id, session_id, user_id, role, display_name, is_connected, last_heartbeat_at, connected_at)
       VALUES ('p1', 's1', 'u1', 'white', 'White1', 1, ?, ?);`,
      [now, now]
    );

    // Second white player in the same session must violate partial unique index
    expect(() => {
      raw.run(
        `INSERT INTO session_participants (id, session_id, user_id, role, display_name, is_connected, last_heartbeat_at, connected_at)
         VALUES ('p2', 's1', 'u2', 'white', 'White2', 1, ?, ?);`,
        [now, now]
      );
    }).toThrow();

    // Multiple spectators however are permitted
    raw.run(
      `INSERT INTO session_participants (id, session_id, user_id, role, display_name, is_connected, last_heartbeat_at, connected_at)
       VALUES ('p3', 's1', 'u3', 'spectator', 'Spec1', 1, ?, ?);`,
      [now, now]
    );
    raw.run(
      `INSERT INTO session_participants (id, session_id, user_id, role, display_name, is_connected, last_heartbeat_at, connected_at)
       VALUES ('p4', 's1', 'u4', 'spectator', 'Spec2', 1, ?, ?);`,
      [now, now]
    );

    expect(raw.query('SELECT count(*) as c FROM session_participants;').get()).toEqual({ c: 3 });

    db.close();
  });

  it('supports transactional rollback and commit via SanctuaryDatabase transaction wrapper', () => {
    const db = new SanctuaryDatabase(':memory:');
    const now = Date.now();

    // Successful transaction
    const okRes = db.transaction(() => {
      db.getRawDb().run(
        `INSERT INTO game_sessions (id, session_code, status, current_fen, turn, move_count, created_at, updated_at)
         VALUES ('tx1', 'SANCT-TX1', 'active', 'fen', 'w', 0, ?, ?);`,
        [now, now]
      );
      return 42;
    });

    expect(okRes.isSuccess()).toBe(true);
    expect(okRes.getOrThrow()).toBe(42);

    // Failing transaction must roll back
    const failRes = db.transaction(() => {
      db.getRawDb().run(
        `INSERT INTO game_sessions (id, session_code, status, current_fen, turn, move_count, created_at, updated_at)
         VALUES ('tx2', 'SANCT-TX2', 'active', 'fen', 'w', 0, ?, ?);`,
        [now, now]
      );
      throw new Error('Simulated atomic failure');
    });

    expect(failRes.isFailure()).toBe(true);
    const tx2 = db.getRawDb().query("SELECT * FROM game_sessions WHERE id = 'tx2';").get();
    expect(tx2).toBeNull();

    db.close();
  });
});
