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

  it('manages Cathedral Poker sessions, multi-seats, and snapshot archival', () => {
    const db = initDb();
    const service = new MultiGameService(db);

    const pokerRes = service.createPokerSession('POKER-EPSILON', 'texas-holdem', 10, 20, true);
    expect(pokerRes.isSuccess()).toBe(true);
    const session = pokerRes.getOrThrow();
    expect(session.session_code).toBe('POKER-EPSILON');
    expect(session.do_not_delete).toBe(1);

    // Register seats
    const seat1 = service.registerPokerSeat(session.id, 1, 'usr_p1', 'HighRoller', false, 2500);
    const seat2 = service.registerPokerSeat(session.id, 2, 'bot_p2', 'PokerBot #2', true, 1000, 'micro-neural');
    expect(seat1.isSuccess()).toBe(true);
    expect(seat2.isSuccess()).toBe(true);

    // Archive snapshot
    const snapRes = service.archivePokerSnapshot(
      'POKER-EPSILON',
      'HighRoller',
      'texas-holdem',
      500,
      { winningHand: 'Full House' },
      true
    );
    expect(snapRes.isSuccess()).toBe(true);
    expect(snapRes.getOrThrow().bln_do_not_delete).toBe(1);
  });

  it('manages Sacred Skip-Bo sessions, seats, and snapshot archival', () => {
    const db = initDb();
    const service = new MultiGameService(db);

    const skpRes = service.createSkipBoSession('SKIP-ZETA', 15, true);
    expect(skpRes.isSuccess()).toBe(true);
    const sessionId = skpRes.getOrThrow();

    const seat1 = service.registerSkipBoSeat(sessionId, 1, 'usr_s1', 'Speedy', false, 15);
    const seat2 = service.registerSkipBoSeat(sessionId, 2, 'bot_s2', 'SkipBot #2', true, 15);
    expect(seat1.isSuccess()).toBe(true);
    expect(seat2.isSuccess()).toBe(true);

    const snapRes = service.archiveSkipBoSnapshot('SKIP-ZETA', 'Speedy', { turnsPlayed: 8 }, true);
    expect(snapRes.isSuccess()).toBe(true);
    expect(snapRes.getOrThrow().bln_do_not_delete).toBe(1);
  });

  it('manages Sacred Geometry SET sessions, seats, events, snapshots, and history migration', () => {
    const db = initDb();
    const service = new MultiGameService(db);

    const setRes = service.createSetSession('SET-OMEGA', true);
    expect(setRes.isSuccess()).toBe(true);
    const session = setRes.getOrThrow();
    expect(session.session_code).toBe('SET-OMEGA');
    expect(session.do_not_delete).toBe(1);

    const seat1 = service.registerSetSeat(session.id, 1, 'usr_g1', 'Euclid', false);
    const seat2 = service.registerSetSeat(session.id, 2, 'bot_g2', 'Hypatia Bot', true, 'micro-neural');
    expect(seat1.isSuccess()).toBe(true);
    expect(seat2.isSuccess()).toBe(true);

    const evtRes = service.recordSetEvent(session.id, 1, 'set_claimed', {
      playerId: 'usr_g1',
      cards: ['set-1-diamond-solid-red', 'set-2-diamond-solid-red', 'set-3-diamond-solid-red']
    });
    expect(evtRes.isSuccess()).toBe(true);

    const snapRes = service.archiveSetSnapshot('SET-OMEGA', 'Euclid', 14, { setsFound: 14 }, true);
    expect(snapRes.isSuccess()).toBe(true);
    expect(snapRes.getOrThrow().bln_do_not_delete).toBe(1);

    const migrateRes = service.migrateSetSnapshotsToHistory();
    expect(migrateRes.isSuccess()).toBe(true);
    expect(migrateRes.getOrThrow()).toBe(1);

    const histCount = db.query('SELECT COUNT(*) as count FROM tbl_archived_set_snapshots_history').get() as {
      count: number;
    };
    expect(histCount.count).toBe(1);
  });

  it('prunes all stale 3+ day old sessions across all 7 arcade games while strictly preserving do_not_delete = 1 and fresh games', () => {
    const db = initDb();
    const service = new MultiGameService(db);
    const now = Date.now();
    const fourDaysAgo = now - 4 * 86_400_000;
    const oneDayAgo = now - 1 * 86_400_000;

    // Create 1 stale unpinned, 1 stale pinned (do_not_delete=true), and 1 fresh unpinned for each game
    service.createBlackjackSession('BJK-STALE', 10, 500, false);
    service.createBlackjackSession('BJK-PINNED', 10, 500, true);
    service.createBlackjackSession('BJK-FRESH', 10, 500, false);

    service.createAvalonSession('AVALON-STALE', 5, false);
    service.createAvalonSession('AVALON-PINNED', 5, true);

    service.createUnoSession('UNO-STALE', 'red', false);
    service.createPhase10Session('P10-STALE', false);
    service.createPokerSession('POKER-STALE', 'texas-holdem', 10, 20, false);
    service.createSkipBoSession('SKIP-STALE', 15, false);
    service.createSetSession('SET-STALE', false);
    service.createSetSession('SET-PINNED', true);

    // Backdate the STALE and PINNED sessions to 4 days ago, and FRESH to 1 day ago
    const tables = [
      'tbl_bjk_sessions',
      'tbl_res_sessions',
      'tbl_uno_sessions',
      'tbl_p10_sessions',
      'tbl_pok_sessions',
      'tbl_skp_sessions',
      'tbl_set_sessions'
    ];
    for (const tbl of tables) {
      db.prepare(`UPDATE ${tbl} SET updated_at = ? WHERE session_code LIKE '%-STALE' OR session_code LIKE '%-PINNED'`).run(fourDaysAgo);
      db.prepare(`UPDATE ${tbl} SET updated_at = ? WHERE session_code LIKE '%-FRESH'`).run(oneDayAgo);
    }

    const pruneRes = service.pruneAllStaleArcadeGames(3, now);
    expect(pruneRes.isSuccess()).toBe(true);
    const report = pruneRes.getOrThrow();

    // Exactly 7 stale unpinned sessions (1 per game) should be pruned
    expect(report.totalPruned).toBe(7);
    expect(report.prunedByGame.blackjack).toEqual(['BJK-STALE']);
    expect(report.prunedByGame.avalon).toEqual(['AVALON-STALE']);
    expect(report.prunedByGame.uno).toEqual(['UNO-STALE']);
    expect(report.prunedByGame.phase10).toEqual(['P10-STALE']);
    expect(report.prunedByGame.poker).toEqual(['POKER-STALE']);
    expect(report.prunedByGame.skipbo).toEqual(['SKIP-STALE']);
    expect(report.prunedByGame.set).toEqual(['SET-STALE']);

    // Verify BJK-PINNED and BJK-FRESH remain in tbl_bjk_sessions
    const remainingBjk = db.query('SELECT session_code FROM tbl_bjk_sessions ORDER BY session_code').all() as Array<{ session_code: string }>;
    expect(remainingBjk.map(r => r.session_code)).toEqual(['BJK-FRESH', 'BJK-PINNED']);

    // Verify SET-PINNED remains in tbl_set_sessions while SET-STALE was archived into tbl_archived_set_snapshots
    const remainingSet = db.query('SELECT session_code FROM tbl_set_sessions').all() as Array<{ session_code: string }>;
    expect(remainingSet.map(r => r.session_code)).toEqual(['SET-PINNED']);

    const archivedSet = db.query('SELECT txt_session_code FROM tbl_archived_set_snapshots').all() as Array<{ txt_session_code: string }>;
    expect(archivedSet.map(r => r.txt_session_code)).toEqual(['SET-STALE']);
  });
});
