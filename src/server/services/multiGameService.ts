import { randomUUID } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import { Result, tryCatch } from '../../utils/fp';
import { currentEpochMs } from '../../utils/dateTime';
import { logger } from '../../utils/logger';

export interface MultiGameSessionRecord {
  id: string;
  session_code: string;
  status: string;
  do_not_delete: number;
  created_at: number;
  updated_at: number;
}

export interface MultiGameSeatRecord {
  id: string;
  session_id: string;
  seat_number: number;
  player_id: string;
  player_name: string;
  is_bot: number;
  bot_model?: string;
  created_at: number;
  updated_at: number;
}

export interface MultiGameSnapshotRecord {
  id: string;
  txt_session_code: string;
  txt_outcome?: string;
  bln_do_not_delete: number;
  json_snapshot_payload: string;
  created_at: number;
}

export class MultiGameService {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  // ============================================================================
  // 1. BLACKJACK (tbl_bjk_*)
  // ============================================================================

  public createBlackjackSession(
    sessionCode: string,
    minBet: number = 10,
    maxBet: number = 500,
    doNotDelete: boolean = false
  ): Result<MultiGameSessionRecord, string> {
    return tryCatch(
      () => {
        const id = randomUUID();
        const now = currentEpochMs();
        this.db
          .prepare(
            `INSERT INTO tbl_bjk_sessions (id, session_code, status, min_bet, max_bet, deck_shoe_count, do_not_delete, created_at, updated_at)
             VALUES (?, ?, 'betting', ?, ?, 6, ?, ?, ?)`
          )
          .run(id, sessionCode, minBet, maxBet, doNotDelete ? 1 : 0, now, now);

        logger.info(`[SERVER_SIDE] [BJK_TRACE] Created Blackjack session ${sessionCode} (${id})`);

        return {
          id,
          session_code: sessionCode,
          status: 'betting',
          do_not_delete: doNotDelete ? 1 : 0,
          created_at: now,
          updated_at: now
        };
      },
      err => `Failed to create blackjack session: ${String(err)}`
    );
  }

  public registerBlackjackSeat(
    sessionId: string,
    seatNumber: number,
    playerId: string,
    playerName: string,
    isBot: boolean,
    botModel?: string
  ): Result<MultiGameSeatRecord, string> {
    return tryCatch(
      () => {
        const id = randomUUID();
        const now = currentEpochMs();
        this.db
          .prepare(
            `INSERT OR REPLACE INTO tbl_bjk_seats (id, session_id, seat_number, player_id, player_name, is_bot, bot_model, chip_bank, current_bet, hand_status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 500, 25, 'waiting', ?, ?)`
          )
          .run(id, sessionId, seatNumber, playerId, playerName, isBot ? 1 : 0, botModel ?? null, now, now);

        logger.info(
          `[SERVER_SIDE] [BJK_TRACE] Seat ${seatNumber} registered for session ${sessionId}: ${playerName} (isBot=${isBot})`
        );

        return {
          id,
          session_id: sessionId,
          seat_number: seatNumber,
          player_id: playerId,
          player_name: playerName,
          is_bot: isBot ? 1 : 0,
          bot_model: botModel,
          created_at: now,
          updated_at: now
        };
      },
      err => `Failed to register blackjack seat: ${String(err)}`
    );
  }

  public recordBlackjackEvent(
    sessionId: string,
    eventSeq: number,
    eventType: string,
    payload: Record<string, unknown>
  ): Result<boolean, string> {
    return tryCatch(
      () => {
        const id = randomUUID();
        const now = currentEpochMs();
        this.db
          .prepare(
            `INSERT INTO tbl_bjk_events (id, session_id, event_seq, event_type, payload_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(id, sessionId, eventSeq, eventType, JSON.stringify(payload), now);

        logger.info(`[SERVER_SIDE] [BJK_TRACE] Event #${eventSeq} (${eventType}) recorded for ${sessionId}`);
        return true;
      },
      err => `Failed to record blackjack event: ${String(err)}`
    );
  }

  public archiveBlackjackSnapshot(
    sessionCode: string,
    outcome: string,
    totalHands: number,
    dealerTotal: number,
    payload: Record<string, unknown>,
    doNotDelete: boolean = false
  ): Result<MultiGameSnapshotRecord, string> {
    return tryCatch(
      () => {
        const id = randomUUID();
        const now = currentEpochMs();
        const payloadJson = JSON.stringify(payload);

        this.db
          .prepare(
            `INSERT OR REPLACE INTO tbl_archived_bjk_snapshots
             (id, txt_session_code, txt_outcome, int_total_hands, int_dealer_total, bln_do_not_delete, json_snapshot_payload, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(id, sessionCode, outcome, totalHands, dealerTotal, doNotDelete ? 1 : 0, payloadJson, now);

        logger.info(`[SERVER_SIDE] [BJK_TRACE] Archived snapshot for ${sessionCode} into tbl_archived_bjk_snapshots`);

        return {
          id,
          txt_session_code: sessionCode,
          txt_outcome: outcome,
          bln_do_not_delete: doNotDelete ? 1 : 0,
          json_snapshot_payload: payloadJson,
          created_at: now
        };
      },
      err => `Failed to archive blackjack snapshot: ${String(err)}`
    );
  }

  public migrateBlackjackSnapshotsToHistory(): Result<number, string> {
    return tryCatch(
      () => {
        const migratedCount = this.db.transaction(() => {
          const insertStmt = this.db.prepare(
            `INSERT INTO tbl_archived_bjk_snapshots_history
             (id, txt_session_code, txt_outcome, int_total_hands, int_dealer_total, bln_do_not_delete, json_snapshot_payload, created_at)
             SELECT id, txt_session_code, txt_outcome, int_total_hands, int_dealer_total, bln_do_not_delete, json_snapshot_payload, created_at
             FROM tbl_archived_bjk_snapshots`
          );
          const deleteStmt = this.db.prepare(`DELETE FROM tbl_archived_bjk_snapshots`);

          const result = insertStmt.run();
          deleteStmt.run();
          return result.changes;
        })();

        logger.info(`[SERVER_SIDE] [BJK_TRACE] Migrated ${migratedCount} snapshots to tbl_archived_bjk_snapshots_history`);
        return migratedCount;
      },
      err => `Failed to migrate snapshots to history: ${String(err)}`
    );
  }

  // ============================================================================
  // 2. THE RESISTANCE: AVALON (tbl_res_*)
  // ============================================================================

  public createAvalonSession(
    sessionCode: string,
    playerCount: number = 5,
    doNotDelete: boolean = false
  ): Result<MultiGameSessionRecord, string> {
    return tryCatch(
      () => {
        const id = randomUUID();
        const now = currentEpochMs();
        this.db
          .prepare(
            `INSERT INTO tbl_res_sessions (id, session_code, player_count, current_mission, failed_proposals, status, do_not_delete, created_at, updated_at)
             VALUES (?, ?, ?, 1, 0, 'lobby', ?, ?, ?)`
          )
          .run(id, sessionCode, playerCount, doNotDelete ? 1 : 0, now, now);

        logger.info(`[SERVER_SIDE] [RES_TRACE] Created Avalon session ${sessionCode} (${id})`);

        return {
          id,
          session_code: sessionCode,
          status: 'lobby',
          do_not_delete: doNotDelete ? 1 : 0,
          created_at: now,
          updated_at: now
        };
      },
      err => `Failed to create avalon session: ${String(err)}`
    );
  }

  public registerAvalonSeat(
    sessionId: string,
    seatNumber: number,
    playerId: string,
    playerName: string,
    isBot: boolean,
    role: string = 'Loyal Servant of Arthur',
    allegiance: 'good' | 'evil' = 'good',
    botModel?: string
  ): Result<MultiGameSeatRecord, string> {
    return tryCatch(
      () => {
        const id = randomUUID();
        const now = currentEpochMs();
        this.db
          .prepare(
            `INSERT OR REPLACE INTO tbl_res_seats (id, session_id, seat_number, player_id, player_name, is_bot, bot_model, role, allegiance, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(id, sessionId, seatNumber, playerId, playerName, isBot ? 1 : 0, botModel ?? null, role, allegiance, now, now);

        logger.info(
          `[SERVER_SIDE] [RES_TRACE] Seat ${seatNumber} registered for Avalon ${sessionId}: ${playerName} (${role}, ${allegiance})`
        );

        return {
          id,
          session_id: sessionId,
          seat_number: seatNumber,
          player_id: playerId,
          player_name: playerName,
          is_bot: isBot ? 1 : 0,
          bot_model: botModel,
          created_at: now,
          updated_at: now
        };
      },
      err => `Failed to register avalon seat: ${String(err)}`
    );
  }

  // ============================================================================
  // 3. CARDINAL UNO (tbl_uno_*)
  // ============================================================================

  public createUnoSession(
    sessionCode: string,
    initialColor: string = 'red',
    doNotDelete: boolean = false
  ): Result<MultiGameSessionRecord, string> {
    return tryCatch(
      () => {
        const id = randomUUID();
        const now = currentEpochMs();
        this.db
          .prepare(
            `INSERT INTO tbl_uno_sessions (id, session_code, current_color, top_card_json, turn_direction, draw_pile_count, status, do_not_delete, created_at, updated_at)
             VALUES (?, ?, ?, '{"color":"red","value":"7"}', 1, 100, 'lobby', ?, ?, ?)`
          )
          .run(id, sessionCode, initialColor, doNotDelete ? 1 : 0, now, now);

        logger.info(`[SERVER_SIDE] [UNO_TRACE] Created Uno session ${sessionCode} (${id})`);

        return {
          id,
          session_code: sessionCode,
          status: 'lobby',
          do_not_delete: doNotDelete ? 1 : 0,
          created_at: now,
          updated_at: now
        };
      },
      err => `Failed to create uno session: ${String(err)}`
    );
  }

  // ============================================================================
  // 4. TEN RITES / PHASE 10 (tbl_p10_*)
  // ============================================================================

  public createPhase10Session(
    sessionCode: string,
    doNotDelete: boolean = false
  ): Result<MultiGameSessionRecord, string> {
    return tryCatch(
      () => {
        const id = randomUUID();
        const now = currentEpochMs();
        this.db
          .prepare(
            `INSERT INTO tbl_p10_sessions (id, session_code, current_round, top_discard_json, status, do_not_delete, created_at, updated_at)
             VALUES (?, ?, 1, '{"value":1,"color":"blue"}', 'lobby', ?, ?, ?)`
          )
          .run(id, sessionCode, doNotDelete ? 1 : 0, now, now);

        logger.info(`[SERVER_SIDE] [P10_TRACE] Created Phase 10 session ${sessionCode} (${id})`);

        return {
          id,
          session_code: sessionCode,
          status: 'lobby',
          do_not_delete: doNotDelete ? 1 : 0,
          created_at: now,
          updated_at: now
        };
      },
      err => `Failed to create phase 10 session: ${String(err)}`
    );
  }

  // ============================================================================
  // 5. CATHEDRAL POKER (tbl_pok_*)
  // ============================================================================

  public createPokerSession(
    sessionCode: string,
    variant: string = 'texas-holdem',
    smallBlind: number = 10,
    bigBlind: number = 20,
    doNotDelete: boolean = false
  ): Result<MultiGameSessionRecord, string> {
    return tryCatch(
      () => {
        const id = randomUUID();
        const now = currentEpochMs();
        this.db
          .prepare(
            `INSERT INTO tbl_pok_sessions (id, session_code, variant, status, pot, current_bet, small_blind, big_blind, dealer_seat, do_not_delete, created_at, updated_at)
             VALUES (?, ?, ?, 'lobby', 0, 0, ?, ?, 1, ?, ?, ?)`
          )
          .run(id, sessionCode, variant, smallBlind, bigBlind, doNotDelete ? 1 : 0, now, now);

        logger.info(`[SERVER_SIDE] [POKER_TRACE] Created Poker session ${sessionCode} (${variant}, id=${id})`);

        return {
          id,
          session_code: sessionCode,
          status: 'lobby',
          do_not_delete: doNotDelete ? 1 : 0,
          created_at: now,
          updated_at: now
        };
      },
      err => `Failed to create poker session: ${String(err)}`
    );
  }

  public registerPokerSeat(
    sessionId: string,
    seatNumber: number,
    playerId: string,
    playerName: string,
    isBot: boolean,
    chips: number = 1000,
    botModel?: string
  ): Result<MultiGameSeatRecord, string> {
    return tryCatch(
      () => {
        const id = randomUUID();
        const now = currentEpochMs();
        this.db
          .prepare(
            `INSERT OR REPLACE INTO tbl_pok_seats (id, session_id, seat_number, player_id, player_name, is_bot, bot_model, chips, current_bet, folded, is_all_in, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?)`
          )
          .run(id, sessionId, seatNumber, playerId, playerName, isBot ? 1 : 0, botModel ?? null, chips, now, now);

        logger.info(
          `[SERVER_SIDE] [POKER_TRACE] Seat ${seatNumber} registered for Poker ${sessionId}: ${playerName} (chips=${chips}, isBot=${isBot})`
        );

        return {
          id,
          session_id: sessionId,
          seat_number: seatNumber,
          player_id: playerId,
          player_name: playerName,
          is_bot: isBot ? 1 : 0,
          bot_model: botModel,
          created_at: now,
          updated_at: now
        };
      },
      err => `Failed to register poker seat: ${String(err)}`
    );
  }

  public archivePokerSnapshot(
    sessionCode: string,
    winnerName: string,
    variant: string,
    finalPot: number,
    payload: Record<string, unknown>,
    doNotDelete: boolean = false
  ): Result<MultiGameSnapshotRecord, string> {
    return tryCatch(
      () => {
        const id = randomUUID();
        const now = currentEpochMs();
        const payloadJson = JSON.stringify(payload);

        this.db
          .prepare(
            `INSERT OR REPLACE INTO tbl_archived_pok_snapshots
             (id, txt_session_code, txt_winner_name, txt_variant, int_final_pot, bln_do_not_delete, json_snapshot_payload, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(id, sessionCode, winnerName, variant, finalPot, doNotDelete ? 1 : 0, payloadJson, now);

        logger.info(`[SERVER_SIDE] [POKER_TRACE] Archived snapshot for ${sessionCode} into tbl_archived_pok_snapshots`);

        return {
          id,
          txt_session_code: sessionCode,
          txt_outcome: winnerName,
          bln_do_not_delete: doNotDelete ? 1 : 0,
          json_snapshot_payload: payloadJson,
          created_at: now
        };
      },
      err => `Failed to archive poker snapshot: ${String(err)}`
    );
  }
}
