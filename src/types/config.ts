import {
  ArcadeGameEnum,
  SystemControlKeyEnum,
  ConfigCategoryEnum,
  ConfigValTypeEnum,
  ConfigAuditActionEnum
} from '../constants/gameEnums';

/**
 * Hungarian-typed Database Schema & Config Master Entities
 * Backed by PocketBase tbl_cfg_arcade_games, tbl_cfg_system_controls, tbl_audit_config_history, tbl_archived_cfg_snapshots
 */

export interface ArcadeGameConfigRecord {
  readonly id: string;
  readonly txt_game_key: ArcadeGameEnum | string;
  readonly txt_title: string;
  readonly txt_real_life_name: string;
  readonly txt_prefix: string;
  readonly txt_category: ConfigCategoryEnum | string;
  readonly txt_summary: string;
  readonly txt_objective: string;
  readonly json_key_rules: readonly string[];
  readonly txt_official_url: string;
  readonly txt_url_label: string;
  readonly int_min_players: number;
  readonly int_max_players: number;
  readonly int_sort_order: number;
  readonly bln_is_active: boolean;
  readonly bln_is_maintenance: boolean;
  readonly txt_badge_text: string;
  readonly txt_badge_color: string;
  readonly txt_theme_color: string;
  readonly json_layout_config?: Readonly<Record<string, unknown>>;
  readonly int_version: number;
  readonly txt_updated_by?: string;
  readonly created_at: number;
  readonly updated_at: number;
}

export type ArcadeGameConfigInput = Omit<ArcadeGameConfigRecord, 'id' | 'created_at' | 'updated_at' | 'int_version'> & {
  readonly id?: string;
  readonly int_version?: number;
};

export type SystemControlValueType = ConfigValTypeEnum | 'string' | 'number' | 'boolean' | 'json';

export interface SystemControlRecord {
  readonly id: string;
  readonly txt_config_key: SystemControlKeyEnum | string;
  readonly txt_category: ConfigCategoryEnum | string;
  readonly txt_label: string;
  readonly txt_description?: string;
  readonly txt_val_type: SystemControlValueType;
  readonly txt_val_string?: string;
  readonly dec_val_number?: number;
  readonly bln_val_boolean?: boolean;
  readonly json_val_payload?: unknown;
  readonly bln_is_active: boolean;
  readonly int_version: number;
  readonly txt_updated_by?: string;
  readonly created_at: number;
  readonly updated_at: number;
}

export type SystemControlInput = Omit<SystemControlRecord, 'id' | 'created_at' | 'updated_at' | 'int_version'> & {
  readonly id?: string;
  readonly int_version?: number;
};

export type ConfigAuditAction = ConfigAuditActionEnum | 'CREATE' | 'UPDATE' | 'DELETE' | 'MIGRATE' | 'SYNC' | 'PURGE';

export interface ConfigAuditRecord {
  readonly id: string;
  readonly txt_audit_id: string;
  readonly txt_target_table: string;
  readonly txt_record_key: string;
  readonly txt_action: ConfigAuditAction;
  readonly json_previous_state?: string;
  readonly json_new_state?: string;
  readonly txt_performed_by: string;
  readonly txt_change_reason?: string;
  readonly bln_do_not_delete: boolean;
  readonly created_at: number;
  readonly updated_at: number;
}

export interface ConfigSnapshotRecord {
  readonly id: string;
  readonly txt_snapshot_label: string;
  readonly int_total_configs: number;
  readonly json_games_payload: string;
  readonly json_controls_payload: string;
  readonly bln_do_not_delete: boolean;
  readonly created_at: number;
  readonly updated_at: number;
}

export interface StaleConfigAuditPruneReport {
  readonly totalPruned: number;
  readonly auditLogId: string;
  readonly durationMs: number;
}
