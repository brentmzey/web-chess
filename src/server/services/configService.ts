import { randomUUID } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import {
  fromNullable,
  Option,
  Result,
  tryCatch
} from '../../utils/fp';
import { currentEpochMs, subtractDaysEpochMs } from '../../utils/dateTime';
import { logger } from '../../utils/logger';
import { DEFAULT_ARCADE_GAME_CONFIGS, DEFAULT_SYSTEM_CONTROLS } from '../../constants/defaultConfigs';
import type {
  ArcadeGameConfigInput,
  ArcadeGameConfigRecord,
  ConfigAuditAction,
  ConfigAuditRecord,
  ConfigSnapshotRecord,
  StaleConfigAuditPruneReport,
  SystemControlInput,
  SystemControlRecord
} from '../../types/config';

interface RawGameRow {
  id: string;
  txt_game_key: string;
  txt_title: string;
  txt_real_life_name: string;
  txt_prefix: string;
  txt_category: string;
  txt_summary: string;
  txt_objective: string;
  json_key_rules: string;
  txt_official_url: string;
  txt_url_label: string;
  int_min_players: number;
  int_max_players: number;
  int_sort_order: number;
  bln_is_active: number;
  bln_is_maintenance: number;
  txt_badge_text: string;
  txt_badge_color: string;
  txt_theme_color: string;
  json_layout_config: string | null;
  int_version: number;
  txt_updated_by: string | null;
  created_at: number;
  updated_at: number;
}

interface RawControlRow {
  id: string;
  txt_config_key: string;
  txt_category: string;
  txt_label: string;
  txt_description: string | null;
  txt_val_type: string;
  txt_val_string: string | null;
  dec_val_number: number | null;
  bln_val_boolean: number | null;
  json_val_payload: string | null;
  bln_is_active: number;
  int_version: number;
  txt_updated_by: string | null;
  created_at: number;
  updated_at: number;
}

interface RawAuditRow {
  id: string;
  txt_audit_id: string;
  txt_target_table: string;
  txt_record_key: string;
  txt_action: string;
  json_previous_state: string | null;
  json_new_state: string | null;
  txt_performed_by: string;
  txt_change_reason: string | null;
  bln_do_not_delete: number;
  created_at: number;
  updated_at: number;
}

export class ConfigService {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  // ============================================================================
  // 1. ARCADE GAMES CONFIGURATION MASTER (tbl_cfg_arcade_games)
  // ============================================================================

  public getArcadeGame(gameKey: string): Option<ArcadeGameConfigRecord> {
    const row = this.db
      .prepare('SELECT * FROM tbl_cfg_arcade_games WHERE txt_game_key = ?')
      .get(gameKey) as RawGameRow | null;

    return fromNullable(row).map(r => this.mapGameRow(r));
  }

  public getAllArcadeGames(onlyActive: boolean = false): readonly ArcadeGameConfigRecord[] {
    const sql = onlyActive
      ? 'SELECT * FROM tbl_cfg_arcade_games WHERE bln_is_active = 1 ORDER BY int_sort_order ASC'
      : 'SELECT * FROM tbl_cfg_arcade_games ORDER BY int_sort_order ASC';

    const rows = this.db.prepare(sql).all() as RawGameRow[];
    return rows.map(r => this.mapGameRow(r));
  }

  public upsertArcadeGame(game: ArcadeGameConfigInput,
                          performedBy: string = 'system',
                          changeReason: string = 'Configuration update'): Result<ArcadeGameConfigRecord, string> {
    return tryCatch(
      () => {
        const existing = this.getArcadeGame(game.txt_game_key);
        const now = currentEpochMs();
        const nextVersion = existing.map(e => e.int_version + 1).getOrElse(1);
        const recordId = existing.map(e => e.id).getOrElse(game.id ?? randomUUID());
        const createdAt = existing.map(e => e.created_at).getOrElse(now);

        const keyRulesJson = JSON.stringify(game.json_key_rules ?? []);
        const layoutJson = game.json_layout_config ? JSON.stringify(game.json_layout_config) : null;

        const action: ConfigAuditAction = existing.isSome() ? 'UPDATE' : 'CREATE';

        this.db
          .prepare(
            `INSERT INTO tbl_cfg_arcade_games (
              id, txt_game_key, txt_title, txt_real_life_name, txt_prefix, txt_category,
              txt_summary, txt_objective, json_key_rules, txt_official_url, txt_url_label,
              int_min_players, int_max_players, int_sort_order, bln_is_active, bln_is_maintenance,
              txt_badge_text, txt_badge_color, txt_theme_color, json_layout_config,
              int_version, txt_updated_by, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(txt_game_key) DO UPDATE SET
              txt_title = excluded.txt_title,
              txt_real_life_name = excluded.txt_real_life_name,
              txt_prefix = excluded.txt_prefix,
              txt_category = excluded.txt_category,
              txt_summary = excluded.txt_summary,
              txt_objective = excluded.txt_objective,
              json_key_rules = excluded.json_key_rules,
              txt_official_url = excluded.txt_official_url,
              txt_url_label = excluded.txt_url_label,
              int_min_players = excluded.int_min_players,
              int_max_players = excluded.int_max_players,
              int_sort_order = excluded.int_sort_order,
              bln_is_active = excluded.bln_is_active,
              bln_is_maintenance = excluded.bln_is_maintenance,
              txt_badge_text = excluded.txt_badge_text,
              txt_badge_color = excluded.txt_badge_color,
              txt_theme_color = excluded.txt_theme_color,
              json_layout_config = excluded.json_layout_config,
              int_version = excluded.int_version,
              txt_updated_by = excluded.txt_updated_by,
              updated_at = excluded.updated_at`
          )
          .run(
            recordId,
            game.txt_game_key,
            game.txt_title,
            game.txt_real_life_name,
            game.txt_prefix,
            game.txt_category,
            game.txt_summary,
            game.txt_objective,
            keyRulesJson,
            game.txt_official_url,
            game.txt_url_label,
            game.int_min_players,
            game.int_max_players,
            game.int_sort_order,
            game.bln_is_active ? 1 : 0,
            game.bln_is_maintenance ? 1 : 0,
            game.txt_badge_text,
            game.txt_badge_color,
            game.txt_theme_color,
            layoutJson,
            nextVersion,
            performedBy,
            createdAt,
            now
          );

        const updated = this.getArcadeGame(game.txt_game_key).getOrThrow();

        // Record Audit History
        this.recordAudit(
          'tbl_cfg_arcade_games',
          game.txt_game_key,
          action,
          existing.map(e => JSON.stringify(e)).getOrElse(null as any),
          JSON.stringify(updated),
          performedBy,
          changeReason
        );

        logger.info(`[SERVER_SIDE] [CFG_TRACE] Upserted arcade game ${game.txt_game_key} v${nextVersion} (${action})`);
        return updated;
      },
      err => `Failed to upsert arcade game ${game.txt_game_key}: ${String(err)}`
    );
  }

  // ============================================================================
  // 2. SYSTEM CONTROLS CONFIGURATION MASTER (tbl_cfg_system_controls)
  // ============================================================================

  public getSystemControl(configKey: string): Option<SystemControlRecord> {
    const row = this.db
      .prepare('SELECT * FROM tbl_cfg_system_controls WHERE txt_config_key = ?')
      .get(configKey) as RawControlRow | null;

    return fromNullable(row).map(r => this.mapControlRow(r));
  }

  public getSystemControlValue<T>(configKey: string,
                                 fallback: T): T {
    return this.getSystemControl(configKey)
      .map(ctrl => {
        if (!ctrl.bln_is_active) return fallback;
        switch (ctrl.txt_val_type) {
          case 'string':
            return (ctrl.txt_val_string as unknown as T) ?? fallback;
          case 'number':
            return (ctrl.dec_val_number as unknown as T) ?? fallback;
          case 'boolean':
            return (ctrl.bln_val_boolean as unknown as T) ?? fallback;
          case 'json':
            return (ctrl.json_val_payload as unknown as T) ?? fallback;
          default:
            return fallback;
        }
      })
      .getOrElse(fallback);
  }

  public getAllSystemControls(category?: string): readonly SystemControlRecord[] {
    const sql = category
      ? 'SELECT * FROM tbl_cfg_system_controls WHERE txt_category = ? ORDER BY txt_config_key ASC'
      : 'SELECT * FROM tbl_cfg_system_controls ORDER BY txt_category ASC, txt_config_key ASC';

    const rows = (category ? this.db.prepare(sql).all(category) : this.db.prepare(sql).all()) as RawControlRow[];
    return rows.map(r => this.mapControlRow(r));
  }

  public upsertSystemControl(control: SystemControlInput,
                             performedBy: string = 'system',
                             changeReason: string = 'System control update'): Result<SystemControlRecord, string> {
    return tryCatch(
      () => {
        const existing = this.getSystemControl(control.txt_config_key);
        const now = currentEpochMs();
        const nextVersion = existing.map(e => e.int_version + 1).getOrElse(1);
        const recordId = existing.map(e => e.id).getOrElse(control.id ?? randomUUID());
        const createdAt = existing.map(e => e.created_at).getOrElse(now);

        const payloadJson = control.json_val_payload !== undefined ? JSON.stringify(control.json_val_payload) : null;
        const action: ConfigAuditAction = existing.isSome() ? 'UPDATE' : 'CREATE';

        this.db
          .prepare(
            `INSERT INTO tbl_cfg_system_controls (
              id, txt_config_key, txt_category, txt_label, txt_description, txt_val_type,
              txt_val_string, dec_val_number, bln_val_boolean, json_val_payload,
              bln_is_active, int_version, txt_updated_by, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(txt_config_key) DO UPDATE SET
              txt_category = excluded.txt_category,
              txt_label = excluded.txt_label,
              txt_description = excluded.txt_description,
              txt_val_type = excluded.txt_val_type,
              txt_val_string = excluded.txt_val_string,
              dec_val_number = excluded.dec_val_number,
              bln_val_boolean = excluded.bln_val_boolean,
              json_val_payload = excluded.json_val_payload,
              bln_is_active = excluded.bln_is_active,
              int_version = excluded.int_version,
              txt_updated_by = excluded.txt_updated_by,
              updated_at = excluded.updated_at`
          )
          .run(
            recordId,
            control.txt_config_key,
            control.txt_category,
            control.txt_label,
            control.txt_description ?? null,
            control.txt_val_type,
            control.txt_val_string ?? null,
            control.dec_val_number ?? null,
            control.bln_val_boolean !== undefined ? (control.bln_val_boolean ? 1 : 0) : null,
            payloadJson,
            control.bln_is_active ? 1 : 0,
            nextVersion,
            performedBy,
            createdAt,
            now
          );

        const updated = this.getSystemControl(control.txt_config_key).getOrThrow();

        // Record Audit History
        this.recordAudit(
          'tbl_cfg_system_controls',
          control.txt_config_key,
          action,
          existing.map(e => JSON.stringify(e)).getOrElse(null as any),
          JSON.stringify(updated),
          performedBy,
          changeReason
        );

        logger.info(`[SERVER_SIDE] [CFG_TRACE] Upserted system control ${control.txt_config_key} v${nextVersion} (${action})`);
        return updated;
      },
      err => `Failed to upsert system control ${control.txt_config_key}: ${String(err)}`
    );
  }

  // ============================================================================
  // 3. AUDIT & HISTORY TRACKING (tbl_audit_config_history)
  // ============================================================================

  public recordAudit(targetTable: string,
                     recordKey: string,
                     action: ConfigAuditAction,
                     previousState: string | null,
                     newState: string | null,
                     performedBy: string,
                     changeReason?: string,
                     doNotDelete: boolean = false): ConfigAuditRecord {
    const id = randomUUID();
    const auditId = `aud_${currentEpochMs()}_${Math.random().toString(36).substring(2, 8)}`;
    const now = currentEpochMs();

    this.db
      .prepare(
        `INSERT INTO tbl_audit_config_history (
          id, txt_audit_id, txt_target_table, txt_record_key, txt_action,
          json_previous_state, json_new_state, txt_performed_by, txt_change_reason,
          bln_do_not_delete, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        auditId,
        targetTable,
        recordKey,
        action,
        previousState,
        newState,
        performedBy,
        changeReason ?? null,
        doNotDelete ? 1 : 0,
        now,
        now
      );

    return {
      id,
      txt_audit_id: auditId,
      txt_target_table: targetTable,
      txt_record_key: recordKey,
      txt_action: action,
      json_previous_state: previousState ?? undefined,
      json_new_state: newState ?? undefined,
      txt_performed_by: performedBy,
      txt_change_reason: changeReason,
      bln_do_not_delete: doNotDelete,
      created_at: now,
      updated_at: now
    };
  }

  public getConfigAuditHistory(targetTable?: string,
                               recordKey?: string,
                               limit: number = 50): readonly ConfigAuditRecord[] {
    let sql = 'SELECT * FROM tbl_audit_config_history WHERE 1=1';
    const params: (string | number)[] = [];

    if (targetTable) {
      sql += ' AND txt_target_table = ?';
      params.push(targetTable);
    }
    if (recordKey) {
      sql += ' AND txt_record_key = ?';
      params.push(recordKey);
    }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as RawAuditRow[];
    return rows.map(r => this.mapAuditRow(r));
  }

  public pruneConfigAuditHistory(olderThanDays: number = 3): Result<StaleConfigAuditPruneReport, string> {
    const start = currentEpochMs();
    return tryCatch(
      () => {
        const cutoffMs = subtractDaysEpochMs(olderThanDays);
        const auditLogId = `prn_${start}_${Math.random().toString(36).substring(2, 8)}`;

        const stmt = this.db.prepare(
          'DELETE FROM tbl_audit_config_history WHERE bln_do_not_delete = 0 AND updated_at < ?'
        );
        const result = stmt.run(cutoffMs);
        const deletedCount = result.changes;

        const durationMs = currentEpochMs() - start;
        logger.info(`[SERVER_SIDE] [CFG_TRACE] Pruned ${deletedCount} audit records older than ${olderThanDays} days in ${durationMs}ms`);

        return {
          totalPruned: deletedCount,
          auditLogId,
          durationMs
        };
      },
      err => `Failed to prune config audit history: ${String(err)}`
    );
  }

  // ============================================================================
  // 4. CONFIGURATION SNAPSHOTS & BACKUPS (tbl_archived_cfg_snapshots)
  // ============================================================================

  public createConfigSnapshot(label: string,
                              doNotDelete: boolean = false): Result<ConfigSnapshotRecord, string> {
    return tryCatch(
      () => {
        const games = this.getAllArcadeGames(false);
        const controls = this.getAllSystemControls();
        const id = randomUUID();
        const now = currentEpochMs();
        const total = games.length + controls.length;

        const gamesPayload = JSON.stringify(games);
        const controlsPayload = JSON.stringify(controls);

        this.db
          .prepare(
            `INSERT INTO tbl_archived_cfg_snapshots (
              id, txt_snapshot_label, int_total_configs, json_games_payload,
              json_controls_payload, bln_do_not_delete, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(id, label, total, gamesPayload, controlsPayload, doNotDelete ? 1 : 0, now, now);

        this.recordAudit(
          'tbl_archived_cfg_snapshots',
          label,
          'MIGRATE',
          null,
          JSON.stringify({ snapshotId: id, label, total }),
          'system',
          `Created snapshot ${label}`,
          doNotDelete
        );

        logger.info(`[SERVER_SIDE] [CFG_TRACE] Created configuration snapshot ${label} (${total} items)`);

        return {
          id,
          txt_snapshot_label: label,
          int_total_configs: total,
          json_games_payload: gamesPayload,
          json_controls_payload: controlsPayload,
          bln_do_not_delete: doNotDelete,
          created_at: now,
          updated_at: now
        };
      },
      err => `Failed to create config snapshot ${label}: ${String(err)}`
    );
  }

  // ============================================================================
  // 5. SEEDING & CANONICAL SYNCHRONIZATION
  // ============================================================================

  public seedDefaultConfigurations(force: boolean = false): Result<{ gamesSeeded: number; controlsSeeded: number }, string> {
    return tryCatch(
      () => {
        let gamesSeeded = 0;
        let controlsSeeded = 0;

        for (const game of DEFAULT_ARCADE_GAME_CONFIGS) {
          const existing = this.getArcadeGame(game.txt_game_key);
          if (force || existing.isNone()) {
            this.upsertArcadeGame(game, 'system_seeder', 'Initial canonical default seeding');
            gamesSeeded++;
          }
        }

        for (const ctrl of DEFAULT_SYSTEM_CONTROLS) {
          const existing = this.getSystemControl(ctrl.txt_config_key);
          if (force || existing.isNone()) {
            this.upsertSystemControl(ctrl, 'system_seeder', 'Initial canonical default seeding');
            controlsSeeded++;
          }
        }

        logger.info(`[SERVER_SIDE] [CFG_TRACE] Seeding complete: ${gamesSeeded} games, ${controlsSeeded} controls seeded.`);
        return { gamesSeeded, controlsSeeded };
      },
      err => `Failed to seed default configurations: ${String(err)}`
    );
  }

  // ============================================================================
  // PRIVATE ROW MAPPERS
  // ============================================================================

  private mapGameRow(r: RawGameRow): ArcadeGameConfigRecord {
    let keyRules: readonly string[] = [];
    try {
      keyRules = JSON.parse(r.json_key_rules);
    } catch {
      keyRules = [];
    }

    let layoutConfig: Readonly<Record<string, unknown>> | undefined;
    if (r.json_layout_config) {
      try {
        layoutConfig = JSON.parse(r.json_layout_config);
      } catch {
        layoutConfig = undefined;
      }
    }

    return {
      id: r.id,
      txt_game_key: r.txt_game_key,
      txt_title: r.txt_title,
      txt_real_life_name: r.txt_real_life_name,
      txt_prefix: r.txt_prefix,
      txt_category: r.txt_category,
      txt_summary: r.txt_summary,
      txt_objective: r.txt_objective,
      json_key_rules: keyRules,
      txt_official_url: r.txt_official_url,
      txt_url_label: r.txt_url_label,
      int_min_players: r.int_min_players,
      int_max_players: r.int_max_players,
      int_sort_order: r.int_sort_order,
      bln_is_active: r.bln_is_active === 1,
      bln_is_maintenance: r.bln_is_maintenance === 1,
      txt_badge_text: r.txt_badge_text,
      txt_badge_color: r.txt_badge_color,
      txt_theme_color: r.txt_theme_color,
      json_layout_config: layoutConfig,
      int_version: r.int_version,
      txt_updated_by: r.txt_updated_by ?? undefined,
      created_at: r.created_at,
      updated_at: r.updated_at
    };
  }

  private mapControlRow(r: RawControlRow): SystemControlRecord {
    let payload: unknown = undefined;
    if (r.json_val_payload) {
      try {
        payload = JSON.parse(r.json_val_payload);
      } catch {
        payload = undefined;
      }
    }

    return {
      id: r.id,
      txt_config_key: r.txt_config_key,
      txt_category: r.txt_category,
      txt_label: r.txt_label,
      txt_description: r.txt_description ?? undefined,
      txt_val_type: r.txt_val_type as any,
      txt_val_string: r.txt_val_string ?? undefined,
      dec_val_number: r.dec_val_number !== null ? Number(r.dec_val_number) : undefined,
      bln_val_boolean: r.bln_val_boolean !== null ? r.bln_val_boolean === 1 : undefined,
      json_val_payload: payload,
      bln_is_active: r.bln_is_active === 1,
      int_version: r.int_version,
      txt_updated_by: r.txt_updated_by ?? undefined,
      created_at: r.created_at,
      updated_at: r.updated_at
    };
  }

  private mapAuditRow(r: RawAuditRow): ConfigAuditRecord {
    return {
      id: r.id,
      txt_audit_id: r.txt_audit_id,
      txt_target_table: r.txt_target_table,
      txt_record_key: r.txt_record_key,
      txt_action: r.txt_action as ConfigAuditAction,
      json_previous_state: r.json_previous_state ?? undefined,
      json_new_state: r.json_new_state ?? undefined,
      txt_performed_by: r.txt_performed_by,
      txt_change_reason: r.txt_change_reason ?? undefined,
      bln_do_not_delete: r.bln_do_not_delete === 1,
      created_at: r.created_at,
      updated_at: r.updated_at
    };
  }
}
