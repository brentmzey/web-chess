import { describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MultiGameService } from '../src/server/services/multiGameService';

describe('MultiGameService - Dedicated Tables, Logging/Tracing & History Partitions', () => {
  const initDb = (): Database => {
    const db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON;');
    const schemaSql = readFileSync(
      resolve(import.meta.dir, '../src/server/db/multiGameSchema.sql'),
      'utf8'
    );
    db.run(schemaSql);
    return db;
  };

  it('creates and traces Blackjack session, seats, moves, events, and snapshots', () => {
    const db = initDb();
    const service = new MultiGameService(db);

    // 1. Create session
    const sessionRes = service.createBlackjackSession('BJK-ALPHA', 10, 500, true);
    expect(sessionRes.isSuccess()).toBe(true);
    const session = sessionRes.getOrThrow();
    expect(session.session_code).toBe('BJK-ALPHA');
    expect(session.do_not_delete).toBe(1);

    // 2. Register seats (Seat 1: Human, Seat 2: Bot)
    const seat1 = service.registerBlackjackSeat(session.id, 1, 'usr_h1', 'Alice', false);
    const seat2 = service.registerBlackjackSeat(session.id, 2, 'bot_2', 'Abbot Bot #2', true, 'minimax');
    expect(seat1.isSuccess()).toBe(true);
    expect(seat2.isSuccess()).toBe(true);
    expect(seat1.getOrThrow().is_bot).toBe(0);
    expect(seat2.getOrThrow().is_bot).toBe(1);

    // 3. Record event
    const eventRes = service.recordBlackjackEvent(session.id, 1, 'player_joined', {
      seat: 1,
      playerName: 'Alice'
    });
    expect(eventRes.isSuccess()).toBe(true);

    // 4. Archive snapshot
    const snapRes = service.archiveBlackjackSnapshot(
      'BJK-ALPHA',
      'player_won',
      12,
      19,
      { totalWinnings: 150 },
      true
    );
    expect(snapRes.isSuccess()).toBe(true);
    expect(snapRes.getOrThrow().bln_do_not_delete).toBe(1);

    // Verify snapshot in tbl_archived_bjk_snapshots
    const countRow = db.query('SELECT COUNT(*) as count FROM tbl_archived_bjk_snapshots').get() as {
      count: number;
    };
    expect(countRow.count).toBe(1);

    // 5. Partition/migrate snapshots to history table
    const migrateRes = service.migrateBlackjackSnapshotsToHistory();
    expect(migrateRes.isSuccess()).toBe(true);
    expect(migrateRes.getOrThrow()).toBe(1);

    // Verified original table is empty, history table has 1 record
    const snapCount = db.query('SELECT COUNT(*) as count FROM tbl_archived_bjk_snapshots').get() as {
      count: number;
    };
    const histCount = db.query('SELECT COUNT(*) as count FROM tbl_archived_bjk_snapshots_history').get() as {
      count: number;
    };
    expect(snapCount.count).toBe(0);
    expect(histCount.count).toBe(1);
  });

  it('manages The Resistance: Avalon sessions and roles with foreign key cascade deletion', () => {
    const db = initDb();
    const service = new MultiGameService(db);

    const sessionRes = service.createAvalonSession('AVALON-BETA', 7, false);
    expect(sessionRes.isSuccess()).toBe(true);
    const session = sessionRes.getOrThrow();

    // Register seats with hidden roles
    const seatMerlin = service.registerAvalonSeat(
      session.id,
      1,
      'usr_merlin',
      'Archmage',
      false,
      'Merlin',
      'good'
    );
    const seatAssassin = service.registerAvalonSeat(
      session.id,
      2,
      'bot_assassin',
      'Mordred Shadow',
      true,
      'Assassin',
      'evil',
      'micro-neural'
    );
    expect(seatMerlin.isSuccess()).toBe(true);
    expect(seatAssassin.isSuccess()).toBe(true);

    // Delete session -> verify cascade deletes seats
    db.prepare('DELETE FROM tbl_res_sessions WHERE id = ?').run(session.id);
    const seatsRemaining = db.query('SELECT COUNT(*) as count FROM tbl_res_seats WHERE session_id = ?').get(session.id) as {
      count: number;
    };
    expect(seatsRemaining.count).toBe(0);
  });

  it('manages Cardinal Uno and Phase 10 session lifecycles', () => {
    const db = initDb();
    const service = new MultiGameService(db);

    const unoRes = service.createUnoSession('UNO-GAMMA', 'blue', false);
    expect(unoRes.isSuccess()).toBe(true);
    expect(unoRes.getOrThrow().session_code).toBe('UNO-GAMMA');

    const p10Res = service.createPhase10Session('P10-DELTA', true);
    expect(p10Res.isSuccess()).toBe(true);
    expect(p10Res.getOrThrow().session_code).toBe('P10-DELTA');
    expect(p10Res.getOrThrow().do_not_delete).toBe(1);
  });
});
