import type { Database } from 'bun:sqlite';
import { Result, tryCatch } from '../../utils/fp';
import { currentEpochMs } from '../../utils/dateTime';
import { logger } from '../../utils/logger';
import { DatabaseError } from '../../errors/sanctuaryError';
import { generateUuidV4, generateTraceId, type UuidV4 } from '../../utils/uuid';

export interface MultiGameSessionRecord {
  id: UuidV4;
  session_code: string;
  status: string;
  do_not_delete: number;
  created_at: number;
  updated_at: number;
}

export interface MultiGameSeatRecord {
  id: UuidV4;
  session_id: string;
  seat_number: number;
  player_id: string;
  player_name: string;
  is_bot: number;
  bot_model?: string;
  created_at: number;
  updated_at: number;
}

export interface MultiGameMoveRecord {
  id: UuidV4;
  session_id: string;
  seat_number: number;
  action_type: string;
  created_at: number;
}

export interface MultiGameEventRecord {
  id: UuidV4;
  session_id: string;
  event_seq: number;
  event_type: string;
  created_at: number;
}

export interface MultiGameSnapshotRecord {
  id: UuidV4;
  txt_session_code: string;
  txt_outcome?: string;
  bln_do_not_delete: number;
  json_snapshot_payload: string;
  created_at: number;
}

export interface StaleArcadePruneReport {
  totalPruned: number;
  prunedByGame: Record<string, string[]>;
}

export class MultiGameService {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  // ============================================================================
  // 1. BLACKJACK (tbl_bjk_*)
  // ============================================================================

  public createBlackjackSession(sessionCode: string,
                                minBet: number = 10,
                                maxBet: number = 500,
                                doNotDelete: boolean = false): Result<MultiGameSessionRecord, DatabaseError> {
    return tryCatch(
      () => {
        const id = generateUuidV4();
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
      err =>
        new DatabaseError({
          code: 'ERR_DB_BJK_CREATE_SESSION',
          message: `Failed to create blackjack session: ${String(err)}`,
          data: { game: 'blackjack', sessionCode, minBet, maxBet, doNotDelete },
          traceId: generateTraceId(),
          cause: err
        })
    );
  }

  public registerBlackjackSeat(sessionId: string,
                               seatNumber: number,
                               playerId: string,
                               playerName: string,
                               isBot: boolean,
                               botModel?: string): Result<MultiGameSeatRecord, DatabaseError> {
    return tryCatch(
      () => {
        const id = generateUuidV4();
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
      err =>
        new DatabaseError({
          code: 'ERR_DB_BJK_REGISTER_SEAT',
          message: `Failed to register blackjack seat: ${String(err)}`,
          data: { game: 'blackjack', sessionId, seatNumber, playerId, playerName, isBot },
          traceId: generateTraceId(),
          cause: err
        })
    );
  }

  public recordBlackjackEvent(sessionId: string,
                              eventSeq: number,
                              eventType: string,
                              payload: Record<string, unknown>): Result<boolean, DatabaseError> {
    return tryCatch(
      () => {
        const id = generateUuidV4();
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
      err =>
        new DatabaseError({
          code: 'ERR_DB_BJK_RECORD_EVENT',
          message: `Failed to record blackjack event: ${String(err)}`,
          data: { game: 'blackjack', sessionId, eventSeq, eventType },
          traceId: generateTraceId(),
          cause: err
        })
    );
  }

  public archiveBlackjackSnapshot(sessionCode: string,
                                  outcome: string,
                                  totalHands: number,
                                  dealerTotal: number,
                                  payload: Record<string, unknown>,
                                  doNotDelete: boolean = false): Result<MultiGameSnapshotRecord, DatabaseError> {
    return tryCatch(
      () => {
        const id = generateUuidV4();
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
      err =>
        new DatabaseError({
          code: 'ERR_DB_BJK_ARCHIVE_SNAPSHOT',
          message: `Failed to archive blackjack snapshot: ${String(err)}`,
          data: { game: 'blackjack', sessionCode, outcome, totalHands, dealerTotal, doNotDelete },
          traceId: generateTraceId(),
          cause: err
        })
    );
  }

  public migrateBlackjackSnapshotsToHistory(): Result<number, DatabaseError> {
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
      err =>
        new DatabaseError({
          code: 'ERR_DB_BJK_MIGRATE_HISTORY',
          message: `Failed to migrate snapshots to history: ${String(err)}`,
          data: { game: 'blackjack' },
          traceId: generateTraceId(),
          cause: err
        })
    );
  }

  // ============================================================================
  // 2. THE RESISTANCE: AVALON (tbl_res_*)
  // ============================================================================

  public createAvalonSession(sessionCode: string,
                             playerCount: number = 5,
                             doNotDelete: boolean = false): Result<MultiGameSessionRecord, DatabaseError> {
    return tryCatch(
      () => {
        const id = generateUuidV4();
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
      err =>
        new DatabaseError({
          code: 'ERR_DB_AVALON_CREATE_SESSION',
          message: `Failed to create avalon session: ${String(err)}`,
          data: { game: 'avalon', sessionCode, playerCount, doNotDelete },
          traceId: generateTraceId(),
          cause: err
        })
    );
  }

  public registerAvalonSeat(sessionId: string,
                            seatNumber: number,
                            playerId: string,
                            playerName: string,
                            isBot: boolean,
                            role: string = 'Loyal Servant of Arthur',
                            allegiance: 'good' | 'evil' = 'good',
                            botModel?: string): Result<MultiGameSeatRecord, DatabaseError> {
    return tryCatch(
      () => {
        const id = generateUuidV4();
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
      err =>
        new DatabaseError({
          code: 'ERR_DB_AVALON_REGISTER_SEAT',
          message: `Failed to register avalon seat: ${String(err)}`,
          data: { game: 'avalon', sessionId, seatNumber, playerId, playerName, role, allegiance },
          traceId: generateTraceId(),
          cause: err
        })
    );
  }

  // ============================================================================
  // 3. CARDINAL UNO (tbl_uno_*)
  // ============================================================================

  public createUnoSession(sessionCode: string,
                          initialColor: string = 'red',
                          doNotDelete: boolean = false): Result<MultiGameSessionRecord, DatabaseError> {
    return tryCatch(
      () => {
        const id = generateUuidV4();
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
      err =>
        new DatabaseError({
          code: 'ERR_DB_UNO_CREATE_SESSION',
          message: `Failed to create uno session: ${String(err)}`,
          data: { game: 'uno', sessionCode, initialColor, doNotDelete },
          traceId: generateTraceId(),
          cause: err
        })
    );
  }

  // ============================================================================
  // 4. TEN RITES / PHASE 10 (tbl_p10_*)
  // ============================================================================

  public createPhase10Session(sessionCode: string,
                              doNotDelete: boolean = false): Result<MultiGameSessionRecord, DatabaseError> {
    return tryCatch(
      () => {
        const id = generateUuidV4();
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
      err =>
        new DatabaseError({
          code: 'ERR_DB_P10_CREATE_SESSION',
          message: `Failed to create phase 10 session: ${String(err)}`,
          data: { game: 'phase10', sessionCode, doNotDelete },
          traceId: generateTraceId(),
          cause: err
        })
    );
  }

  // ============================================================================
  // 5. CATHEDRAL POKER (tbl_pok_*)
  // ============================================================================

  public createPokerSession(sessionCode: string,
                            variant: string = 'texas-holdem',
                            smallBlind: number = 10,
                            bigBlind: number = 20,
                            doNotDelete: boolean = false): Result<MultiGameSessionRecord, DatabaseError> {
    return tryCatch(
      () => {
        const id = generateUuidV4();
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
      err =>
        new DatabaseError({
          code: 'ERR_DB_POKER_CREATE_SESSION',
          message: `Failed to create poker session: ${String(err)}`,
          data: { game: 'poker', sessionCode, variant, smallBlind, bigBlind, doNotDelete },
          traceId: generateTraceId(),
          cause: err
        })
    );
  }

  public registerPokerSeat(sessionId: string,
                           seatNumber: number,
                           playerId: string,
                           playerName: string,
                           isBot: boolean,
                           chips: number = 1000,
                           botModel?: string): Result<MultiGameSeatRecord, DatabaseError> {
    return tryCatch(
      () => {
        const id = generateUuidV4();
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
      err =>
        new DatabaseError({
          code: 'ERR_DB_POKER_REGISTER_SEAT',
          message: `Failed to register poker seat: ${String(err)}`,
          data: { game: 'poker', sessionId, seatNumber, playerId, playerName, chips, isBot },
          traceId: generateTraceId(),
          cause: err
        })
    );
  }

  public archivePokerSnapshot(sessionCode: string,
                              winnerName: string,
                              variant: string,
                              finalPot: number,
                              payload: Record<string, unknown>,
                              doNotDelete: boolean = false): Result<MultiGameSnapshotRecord, DatabaseError> {
    return tryCatch(
      () => {
        const id = generateUuidV4();
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
      err =>
        new DatabaseError({
          code: 'ERR_DB_POKER_ARCHIVE_SNAPSHOT',
          message: `Failed to archive poker snapshot: ${String(err)}`,
          data: { game: 'poker', sessionCode, winnerName, variant, finalPot, doNotDelete },
          traceId: generateTraceId(),
          cause: err
        })
    );
  }

  // ==========================================================================
  // 6. SACRED SKIP-BO OBSERVABILITY & OPERATIONS (tbl_skp_*)
  // ==========================================================================

  public createSkipBoSession(sessionCode: string,
                             stockpileSize: number = 15,
                             doNotDelete: boolean = false): Result<UuidV4, DatabaseError> {
    return tryCatch(
      () => {
        const id = generateUuidV4();
        const now = currentEpochMs();
        this.db
          .prepare(
            `INSERT INTO tbl_skp_sessions
             (id, session_code, status, stockpile_size, current_turn_index, building_piles_json, do_not_delete, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(id, sessionCode, 'in_progress', stockpileSize, 0, JSON.stringify([[], [], [], []]), doNotDelete ? 1 : 0, now, now);

        logger.info(`[SERVER_SIDE] [SKIPBO_TRACE] Created Skip-Bo session ${sessionCode} (${id})`);
        return id;
      },
      err =>
        new DatabaseError({
          code: 'ERR_DB_SKIPBO_CREATE_SESSION',
          message: `Failed to create Skip-Bo session: ${String(err)}`,
          data: { game: 'skipbo', sessionCode, stockpileSize, doNotDelete },
          traceId: generateTraceId(),
          cause: err
        })
    );
  }

  public registerSkipBoSeat(sessionId: string,
                            seatNumber: number,
                            playerId: string,
                            playerName: string,
                            isBot: boolean,
                            stockpileRemaining: number = 15): Result<UuidV4, DatabaseError> {
    return tryCatch(
      () => {
        const id = generateUuidV4();
        const now = currentEpochMs();
        this.db
          .prepare(
            `INSERT INTO tbl_skp_seats
             (id, session_id, seat_number, player_id, player_name, is_bot, stockpile_remaining, hand_count, discard_piles_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(id, sessionId, seatNumber, playerId, playerName, isBot ? 1 : 0, stockpileRemaining, 5, JSON.stringify([[], [], [], []]), now, now);

        logger.info(`[SERVER_SIDE] [SKIPBO_TRACE] Seat ${seatNumber} registered for Skip-Bo ${sessionId}: ${playerName}`);
        return id;
      },
      err =>
        new DatabaseError({
          code: 'ERR_DB_SKIPBO_REGISTER_SEAT',
          message: `Failed to register Skip-Bo seat: ${String(err)}`,
          data: { game: 'skipbo', sessionId, seatNumber, playerId, playerName, stockpileRemaining },
          traceId: generateTraceId(),
          cause: err
        })
    );
  }

  public archiveSkipBoSnapshot(sessionCode: string,
                               winnerName: string,
                               payload: Record<string, unknown>,
                               doNotDelete: boolean = false): Result<MultiGameSnapshotRecord, DatabaseError> {
    return tryCatch(
      () => {
        const id = generateUuidV4();
        const now = currentEpochMs();
        const payloadJson = JSON.stringify(payload);

        this.db
          .prepare(
            `INSERT OR REPLACE INTO tbl_archived_skp_snapshots
             (id, txt_session_code, txt_winner_name, bln_do_not_delete, json_snapshot_payload, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(id, sessionCode, winnerName, doNotDelete ? 1 : 0, payloadJson, now);

        logger.info(`[SERVER_SIDE] [SKIPBO_TRACE] Archived snapshot for ${sessionCode} into tbl_archived_skp_snapshots`);

        return {
          id,
          txt_session_code: sessionCode,
          txt_outcome: winnerName,
          bln_do_not_delete: doNotDelete ? 1 : 0,
          json_snapshot_payload: payloadJson,
          created_at: now
        };
      },
      err =>
        new DatabaseError({
          code: 'ERR_DB_SKIPBO_ARCHIVE_SNAPSHOT',
          message: `Failed to archive Skip-Bo snapshot: ${String(err)}`,
          data: { game: 'skipbo', sessionCode, winnerName, doNotDelete },
          traceId: generateTraceId(),
          cause: err
        })
    );
  }

  // ==========================================================================
  // 7. SACRED GEOMETRY SET OBSERVABILITY & OPERATIONS (tbl_set_*)
  // ==========================================================================

  public createSetSession(sessionCode: string,
                          doNotDelete: boolean = false): Result<MultiGameSessionRecord, DatabaseError> {
    return tryCatch(
      () => {
        const id = generateUuidV4();
        const now = currentEpochMs();
        this.db
          .prepare(
            `INSERT INTO tbl_set_sessions
             (id, session_code, status, deck_remaining, claimed_sets_count, table_cards_json, do_not_delete, created_at, updated_at)
             VALUES (?, ?, 'playing', 69, 0, '[]', ?, ?, ?)`
          )
          .run(id, sessionCode, doNotDelete ? 1 : 0, now, now);

        logger.info(`[SERVER_SIDE] [SET_TRACE] Created SET session ${sessionCode} (${id})`);

        return {
          id,
          session_code: sessionCode,
          status: 'playing',
          do_not_delete: doNotDelete ? 1 : 0,
          created_at: now,
          updated_at: now
        };
      },
      err =>
        new DatabaseError({
          code: 'ERR_DB_SET_CREATE_SESSION',
          message: `Failed to create SET session: ${String(err)}`,
          data: { game: 'set', sessionCode, doNotDelete },
          traceId: generateTraceId(),
          cause: err
        })
    );
  }

  public registerSetSeat(sessionId: string,
                         seatNumber: number,
                         playerId: string,
                         playerName: string,
                         isBot: boolean,
                         botModel?: string): Result<MultiGameSeatRecord, DatabaseError> {
    return tryCatch(
      () => {
        const id = generateUuidV4();
        const now = currentEpochMs();
        this.db
          .prepare(
            `INSERT OR REPLACE INTO tbl_set_seats
             (id, session_id, seat_number, player_id, player_name, is_bot, bot_model, score, sets_found, penalties, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?)`
          )
          .run(id, sessionId, seatNumber, playerId, playerName, isBot ? 1 : 0, botModel ?? null, now, now);

        logger.info(`[SERVER_SIDE] [SET_TRACE] Seat ${seatNumber} registered for SET ${sessionId}: ${playerName}`);

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
      err =>
        new DatabaseError({
          code: 'ERR_DB_SET_REGISTER_SEAT',
          message: `Failed to register SET seat: ${String(err)}`,
          data: { game: 'set', sessionId, seatNumber, playerId, playerName, isBot },
          traceId: generateTraceId(),
          cause: err
        })
    );
  }

  public recordSetEvent(sessionId: string,
                        eventSeq: number,
                        eventType: string,
                        payload: Record<string, unknown>): Result<boolean, DatabaseError> {
    return tryCatch(
      () => {
        const id = generateUuidV4();
        const now = currentEpochMs();
        this.db
          .prepare(
            `INSERT INTO tbl_set_events (id, session_id, event_seq, event_type, payload_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(id, sessionId, eventSeq, eventType, JSON.stringify(payload), now);

        logger.info(`[SERVER_SIDE] [SET_TRACE] Event #${eventSeq} (${eventType}) recorded for ${sessionId}`);
        return true;
      },
      err =>
        new DatabaseError({
          code: 'ERR_DB_SET_RECORD_EVENT',
          message: `Failed to record SET event: ${String(err)}`,
          data: { game: 'set', sessionId, eventSeq, eventType },
          traceId: generateTraceId(),
          cause: err
        })
    );
  }

  public archiveSetSnapshot(sessionCode: string,
                            winnerName: string,
                            claimedSets: number,
                            payload: Record<string, unknown>,
                            doNotDelete: boolean = false): Result<MultiGameSnapshotRecord, DatabaseError> {
    return tryCatch(
      () => {
        const id = generateUuidV4();
        const now = currentEpochMs();
        const payloadJson = JSON.stringify(payload);

        this.db
          .prepare(
            `INSERT OR REPLACE INTO tbl_archived_set_snapshots
             (id, txt_session_code, txt_winner_name, int_claimed_sets, bln_do_not_delete, json_snapshot_payload, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(id, sessionCode, winnerName, claimedSets, doNotDelete ? 1 : 0, payloadJson, now);

        logger.info(`[SERVER_SIDE] [SET_TRACE] Archived snapshot for ${sessionCode} into tbl_archived_set_snapshots`);

        return {
          id,
          txt_session_code: sessionCode,
          txt_outcome: winnerName,
          bln_do_not_delete: doNotDelete ? 1 : 0,
          json_snapshot_payload: payloadJson,
          created_at: now
        };
      },
      err =>
        new DatabaseError({
          code: 'ERR_DB_SET_ARCHIVE_SNAPSHOT',
          message: `Failed to archive SET snapshot: ${String(err)}`,
          data: { game: 'set', sessionCode, winnerName, claimedSets, doNotDelete },
          traceId: generateTraceId(),
          cause: err
        })
    );
  }

  public migrateSetSnapshotsToHistory(): Result<number, DatabaseError> {
    return tryCatch(
      () => {
        const migratedCount = this.db.transaction(() => {
          const insertStmt = this.db.prepare(
            `INSERT INTO tbl_archived_set_snapshots_history
             (id, txt_session_code, txt_winner_name, int_claimed_sets, bln_do_not_delete, json_snapshot_payload, created_at)
             SELECT id, txt_session_code, txt_winner_name, int_claimed_sets, bln_do_not_delete, json_snapshot_payload, created_at
             FROM tbl_archived_set_snapshots`
          );
          const deleteStmt = this.db.prepare(`DELETE FROM tbl_archived_set_snapshots`);

          const result = insertStmt.run();
          deleteStmt.run();
          return result.changes;
        })();

        logger.info(`[SERVER_SIDE] [SET_TRACE] Migrated ${migratedCount} snapshots to tbl_archived_set_snapshots_history`);
        return migratedCount;
      },
      err =>
        new DatabaseError({
          code: 'ERR_DB_SET_MIGRATE_HISTORY',
          message: `Failed to migrate SET snapshots to history: ${String(err)}`,
          data: { game: 'set' },
          traceId: generateTraceId(),
          cause: err
        })
    );
  }

  // ==========================================================================
  // 8. CATHEDRAL SOLITAIRE OBSERVABILITY & OPERATIONS (tbl_sol_*)
  // ==========================================================================

  public createSolitaireSession(sessionCode: string,
                                doNotDelete: boolean = false): Result<MultiGameSessionRecord, DatabaseError> {
    return tryCatch(
      () => {
        const id = generateUuidV4();
        const now = currentEpochMs();
        this.db
          .prepare(
            `INSERT INTO tbl_sol_sessions
             (id, session_code, status, moves_count, score, tableau_json, foundations_json, stock_remaining, waste_remaining, do_not_delete, created_at, updated_at)
             VALUES (?, ?, 'playing', 0, 0, '[]', '{}', 24, 0, ?, ?, ?)`
          )
          .run(id, sessionCode, doNotDelete ? 1 : 0, now, now);

        logger.info(`[SERVER_SIDE] [SOL_TRACE] Created Solitaire session ${sessionCode} (${id})`);

        return {
          id,
          session_code: sessionCode,
          status: 'playing',
          do_not_delete: doNotDelete ? 1 : 0,
          created_at: now,
          updated_at: now
        };
      },
      err =>
        new DatabaseError({
          code: 'ERR_DB_SOL_CREATE_SESSION',
          message: `Failed to create Solitaire session: ${String(err)}`,
          data: { game: 'solitaire', sessionCode, doNotDelete },
          traceId: generateTraceId(),
          cause: err
        })
    );
  }

  public registerSolitaireSeat(sessionId: string,
                               seatNumber: number,
                               playerId: string,
                               playerName: string,
                               isSpectator: boolean = false): Result<MultiGameSeatRecord, DatabaseError> {
    return tryCatch(
      () => {
        const id = generateUuidV4();
        const now = currentEpochMs();
        this.db
          .prepare(
            `INSERT OR REPLACE INTO tbl_sol_seats
             (id, session_id, seat_number, player_id, player_name, is_spectator, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(id, sessionId, seatNumber, playerId, playerName, isSpectator ? 1 : 0, now, now);

        logger.info(`[SERVER_SIDE] [SOL_TRACE] Seat ${seatNumber} registered for Solitaire ${sessionId}: ${playerName} (spectator=${isSpectator})`);

        return {
          id,
          session_id: sessionId,
          seat_number: seatNumber,
          player_id: playerId,
          player_name: playerName,
          is_bot: 0,
          created_at: now,
          updated_at: now
        };
      },
      err =>
        new DatabaseError({
          code: 'ERR_DB_SOL_REGISTER_SEAT',
          message: `Failed to register Solitaire seat: ${String(err)}`,
          data: { game: 'solitaire', sessionId, seatNumber, playerId, playerName, isSpectator },
          traceId: generateTraceId(),
          cause: err
        })
    );
  }

  public recordSolitaireMove(sessionId: string,
                             moveSeq: number,
                             actionType: string,
                             sourcePile: string,
                             targetPile: string,
                             cardsJson: string): Result<MultiGameMoveRecord, DatabaseError> {
    return tryCatch(
      () => {
        const id = generateUuidV4();
        const now = currentEpochMs();
        this.db
          .prepare(
            `INSERT INTO tbl_sol_moves
             (id, session_id, move_seq, action_type, source_pile, target_pile, cards_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(id, sessionId, moveSeq, actionType, sourcePile, targetPile, cardsJson, now);

        logger.info(`[SERVER_SIDE] [SOL_TRACE] Move #${moveSeq} (${actionType}) recorded for Solitaire ${sessionId}`);

        return {
          id,
          session_id: sessionId,
          seat_number: 1,
          action_type: actionType,
          created_at: now
        };
      },
      err =>
        new DatabaseError({
          code: 'ERR_DB_SOL_RECORD_MOVE',
          message: `Failed to record Solitaire move: ${String(err)}`,
          data: { game: 'solitaire', sessionId, moveSeq, actionType, sourcePile, targetPile },
          traceId: generateTraceId(),
          cause: err
        })
    );
  }

  public recordSolitaireEvent(sessionId: string,
                              eventSeq: number,
                              eventType: string,
                              payloadJson: string): Result<MultiGameEventRecord, DatabaseError> {
    return tryCatch(
      () => {
        const id = generateUuidV4();
        const now = currentEpochMs();
        this.db
          .prepare(
            `INSERT INTO tbl_sol_events
             (id, session_id, event_seq, event_type, payload_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(id, sessionId, eventSeq, eventType, payloadJson, now);

        logger.info(`[SERVER_SIDE] [SOL_TRACE] Event #${eventSeq} (${eventType}) recorded for Solitaire ${sessionId}`);

        return {
          id,
          session_id: sessionId,
          event_seq: eventSeq,
          event_type: eventType,
          created_at: now
        };
      },
      err =>
        new DatabaseError({
          code: 'ERR_DB_SOL_RECORD_EVENT',
          message: `Failed to record Solitaire event: ${String(err)}`,
          data: { game: 'solitaire', sessionId, eventSeq, eventType },
          traceId: generateTraceId(),
          cause: err
        })
    );
  }

  public archiveSolitaireSnapshot(sessionCode: string,
                                  playerName: string,
                                  score: number,
                                  movesCount: number,
                                  doNotDelete: boolean,
                                  payloadJson: string): Result<UuidV4, DatabaseError> {
    return tryCatch(
      () => {
        const id = generateUuidV4();
        const now = currentEpochMs();
        this.db
          .prepare(
            `INSERT OR REPLACE INTO tbl_archived_sol_snapshots
             (id, txt_session_code, txt_player_name, int_score, int_moves_count, bln_do_not_delete, json_snapshot_payload, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(id, sessionCode, playerName, score, movesCount, doNotDelete ? 1 : 0, payloadJson, now);

        logger.info(`[SERVER_SIDE] [SOL_TRACE] Archived snapshot for ${sessionCode} into tbl_archived_sol_snapshots`);
        return id;
      },
      err =>
        new DatabaseError({
          code: 'ERR_DB_SOL_ARCHIVE_SNAPSHOT',
          message: `Failed to archive Solitaire snapshot: ${String(err)}`,
          data: { game: 'solitaire', sessionCode, playerName, score, movesCount, doNotDelete },
          traceId: generateTraceId(),
          cause: err
        })
    );
  }

  public migrateSolitaireSnapshotsToHistory(): Result<number, DatabaseError> {
    return tryCatch(
      () => {
        const migratedCount = this.db.transaction(() => {
          const insertStmt = this.db.prepare(
            `INSERT INTO tbl_archived_sol_snapshots_history
             (id, txt_session_code, txt_player_name, int_score, int_moves_count, bln_do_not_delete, json_snapshot_payload, created_at)
             SELECT id, txt_session_code, txt_player_name, int_score, int_moves_count, bln_do_not_delete, json_snapshot_payload, created_at
             FROM tbl_archived_sol_snapshots`
          );
          const deleteStmt = this.db.prepare(`DELETE FROM tbl_archived_sol_snapshots`);

          const result = insertStmt.run();
          deleteStmt.run();
          return result.changes;
        })();

        logger.info(`[SERVER_SIDE] [SOL_TRACE] Migrated ${migratedCount} snapshots to tbl_archived_sol_snapshots_history`);
        return migratedCount;
      },
      err =>
        new DatabaseError({
          code: 'ERR_DB_SOL_MIGRATE_HISTORY',
          message: `Failed to migrate Solitaire snapshots to history: ${String(err)}`,
          data: { game: 'solitaire' },
          traceId: generateTraceId(),
          cause: err
        })
    );
  }

  // ==========================================================================
  // 9. UNIVERSAL MULTI-GAME STALE SESSION PRUNER (3+ DAYS OLD & do_not_delete = 0)
  // ==========================================================================

  /**
   * Sweeps all 8 arcade SQLite game session tables for records that are older than
   * `olderThanDays` (default 3 days) AND have `do_not_delete = 0`.
   * Archives a compact JSON snapshot into the corresponding `tbl_archived_<prefix>_snapshots`
   * table before cascade-deleting the active session and its child seats/moves/events.
   */
  public pruneAllStaleArcadeGames(olderThanDays: number = 3,
                                  referenceTimeMs: number = currentEpochMs()): Result<StaleArcadePruneReport, DatabaseError> {
    return tryCatch(
      () => {
        const cutoffMs = referenceTimeMs - olderThanDays * 86_400_000;
        const prunedByGame: Record<string, string[]> = {
          blackjack: [],
          avalon: [],
          uno: [],
          phase10: [],
          poker: [],
          skipbo: [],
          set: [],
          solitaire: []
        };

        const tableConfigs = [
          {
            game: 'blackjack',
            sessionTable: 'tbl_bjk_sessions',
            snapshotSql: `INSERT OR REPLACE INTO tbl_archived_bjk_snapshots
              (id, txt_session_code, txt_outcome, int_total_hands, int_dealer_total, bln_do_not_delete, json_snapshot_payload, created_at)
              VALUES (?, ?, 'stale_pruned', 0, 0, 0, ?, ?)`
          },
          {
            game: 'avalon',
            sessionTable: 'tbl_res_sessions',
            snapshotSql: `INSERT OR REPLACE INTO tbl_archived_res_snapshots
              (id, txt_session_code, txt_winner, int_player_count, int_missions_passed, int_missions_failed, bln_do_not_delete, json_snapshot_payload, created_at)
              VALUES (?, ?, 'stale_pruned', 5, 0, 0, 0, ?, ?)`
          },
          {
            game: 'uno',
            sessionTable: 'tbl_uno_sessions',
            snapshotSql: `INSERT OR REPLACE INTO tbl_archived_uno_snapshots
              (id, txt_session_code, txt_winner_name, int_total_turns, bln_do_not_delete, json_snapshot_payload, created_at)
              VALUES (?, ?, 'stale_pruned', 0, 0, ?, ?)`
          },
          {
            game: 'phase10',
            sessionTable: 'tbl_p10_sessions',
            snapshotSql: `INSERT OR REPLACE INTO tbl_archived_p10_snapshots
              (id, txt_session_code, txt_winner_name, int_winning_phase, bln_do_not_delete, json_snapshot_payload, created_at)
              VALUES (?, ?, 'stale_pruned', 1, 0, ?, ?)`
          },
          {
            game: 'poker',
            sessionTable: 'tbl_pok_sessions',
            snapshotSql: `INSERT OR REPLACE INTO tbl_archived_pok_snapshots
              (id, txt_session_code, txt_winner_name, txt_variant, int_final_pot, bln_do_not_delete, json_snapshot_payload, created_at)
              VALUES (?, ?, 'stale_pruned', 'texas-holdem', 0, 0, ?, ?)`
          },
          {
            game: 'skipbo',
            sessionTable: 'tbl_skp_sessions',
            snapshotSql: `INSERT OR REPLACE INTO tbl_archived_skp_snapshots
              (id, txt_session_code, txt_winner_name, bln_do_not_delete, json_snapshot_payload, created_at)
              VALUES (?, ?, 'stale_pruned', 0, ?, ?)`
          },
          {
            game: 'set',
            sessionTable: 'tbl_set_sessions',
            snapshotSql: `INSERT OR REPLACE INTO tbl_archived_set_snapshots
              (id, txt_session_code, txt_winner_name, int_claimed_sets, bln_do_not_delete, json_snapshot_payload, created_at)
              VALUES (?, ?, 'stale_pruned', 0, 0, ?, ?)`
          },
          {
            game: 'solitaire',
            sessionTable: 'tbl_sol_sessions',
            snapshotSql: `INSERT OR REPLACE INTO tbl_archived_sol_snapshots
              (id, txt_session_code, txt_player_name, int_score, int_moves_count, bln_do_not_delete, json_snapshot_payload, created_at)
              VALUES (?, ?, 'stale_pruned', 0, 0, 0, ?, ?)`
          }
        ] as const;

        let totalPruned = 0;

        this.db.transaction(() => {
          for (const cfg of tableConfigs) {
            const staleRows = this.db
              .prepare(
                `SELECT id, session_code, status, do_not_delete, created_at, updated_at
                 FROM ${cfg.sessionTable}
                 WHERE updated_at < ? AND do_not_delete = 0`
              )
              .all(cutoffMs) as MultiGameSessionRecord[];

            const insertSnapStmt = this.db.prepare(cfg.snapshotSql);
            const deleteStmt = this.db.prepare(`DELETE FROM ${cfg.sessionTable} WHERE id = ?`);

            for (const row of staleRows) {
              const snapId = generateUuidV4();
              const snapPayload = JSON.stringify({
                session: row,
                prunedReason: 'stale_inactivity_3_days',
                prunedAt: referenceTimeMs
              });

              insertSnapStmt.run(snapId, row.session_code, snapPayload, referenceTimeMs);
              deleteStmt.run(row.id);

              prunedByGame[cfg.game]!.push(row.session_code);
              totalPruned += 1;
            }
          }
        })();

        logger.info(`[SERVER_SIDE] [MULTI_GAME_PRUNER] Pruned ${totalPruned} stale arcade sessions older than ${olderThanDays} days.`);
        return { totalPruned, prunedByGame };
      },
      err =>
        new DatabaseError({
          code: 'ERR_DB_MULTI_GAME_PRUNER',
          message: `Failed to prune stale arcade games: ${String(err)}`,
          data: { olderThanDays, referenceTimeMs },
          traceId: generateTraceId(),
          cause: err
        })
    );
  }
}
