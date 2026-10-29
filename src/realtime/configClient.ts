import { ARCADE_GAME_RULES, type GameRuleInfo } from '../constants/gameRules';
import { DEFAULT_ARCADE_GAME_CONFIGS, DEFAULT_SYSTEM_CONTROLS } from '../constants/defaultConfigs';
import type { ArcadeGameConfigRecord, SystemControlRecord } from '../types/config';
import {
  fromNullable,
  Option,
  Result,
  some,
  tryCatchAsync
} from '../utils/fp';
import { logger } from '../utils/logger';

interface PocketBaseListResponse<T> {
  readonly items: readonly T[];
  readonly totalItems: number;
}

export type ConfigChangeListener = () => void;

/**
 * Client-Side Database-Driven Configuration Driver
 * Dynamically synchronizes UI/UX text, game definitions, real-life rules, and system controls
 * directly from PocketBase `tbl_cfg_arcade_games` and `tbl_cfg_system_controls` without app redeployment.
 */
export class ConfigClient {
  private gamesMap: Map<string, ArcadeGameConfigRecord> = new Map();
  private controlsMap: Map<string, SystemControlRecord> = new Map();
  private listeners: Set<ConfigChangeListener> = new Set();
  private isLoadedFromRemote: boolean = false;

  constructor() {
    this.seedLocalDefaults();
  }

  private seedLocalDefaults(): void {
    for (const g of DEFAULT_ARCADE_GAME_CONFIGS) {
      const rec: ArcadeGameConfigRecord = {
        id: `local_${g.txt_game_key}`,
        txt_game_key: g.txt_game_key,
        txt_title: g.txt_title,
        txt_real_life_name: g.txt_real_life_name,
        txt_prefix: g.txt_prefix,
        txt_category: g.txt_category,
        txt_summary: g.txt_summary,
        txt_objective: g.txt_objective,
        json_key_rules: g.json_key_rules,
        txt_official_url: g.txt_official_url,
        txt_url_label: g.txt_url_label,
        int_min_players: g.int_min_players,
        int_max_players: g.int_max_players,
        int_sort_order: g.int_sort_order,
        bln_is_active: g.bln_is_active,
        bln_is_maintenance: g.bln_is_maintenance,
        txt_badge_text: g.txt_badge_text,
        txt_badge_color: g.txt_badge_color,
        txt_theme_color: g.txt_theme_color,
        json_layout_config: g.json_layout_config,
        int_version: 1,
        created_at: 0,
        updated_at: 0
      };
      this.gamesMap.set(g.txt_game_key, rec);
    }

    for (const c of DEFAULT_SYSTEM_CONTROLS) {
      const rec: SystemControlRecord = {
        id: `local_${c.txt_config_key}`,
        txt_config_key: c.txt_config_key,
        txt_category: c.txt_category,
        txt_label: c.txt_label,
        txt_description: c.txt_description,
        txt_val_type: c.txt_val_type,
        txt_val_string: c.txt_val_string,
        dec_val_number: c.dec_val_number,
        bln_val_boolean: c.bln_val_boolean,
        json_val_payload: c.json_val_payload,
        bln_is_active: c.bln_is_active,
        int_version: 1,
        created_at: 0,
        updated_at: 0
      };
      this.controlsMap.set(c.txt_config_key, rec);
    }
  }

  public subscribe(listener: ConfigChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        logger.warn(`ConfigClient listener threw error: ${String(err)}`);
      }
    }
  }

  public getGameConfig(gameKey: string): Option<ArcadeGameConfigRecord> {
    return fromNullable(this.gamesMap.get(gameKey));
  }

  public getAllActiveGames(): readonly ArcadeGameConfigRecord[] {
    return Array.from(this.gamesMap.values())
      .filter(g => g.bln_is_active)
      .sort((a, b) => a.int_sort_order - b.int_sort_order);
  }

  public getGameRuleInfo(gameKey: string): Option<GameRuleInfo> {
    return this.getGameConfig(gameKey)
      .map((g): GameRuleInfo => ({
        id: g.txt_game_key,
        title: g.txt_title,
        realLifeName: g.txt_real_life_name,
        objective: g.txt_objective,
        summary: g.txt_summary,
        keyRules: g.json_key_rules,
        officialUrl: g.txt_official_url,
        urlLabel: g.txt_url_label
      }))
      .fold(
        () => fromNullable(ARCADE_GAME_RULES[gameKey]),
        info => some(info)
      );
  }

  public getSystemControlValue<T>(configKey: string,
                                  fallback: T): T {
    return fromNullable(this.controlsMap.get(configKey))
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

  public async fetchRemoteConfig(baseUrl: string = 'https://web-chess.pockethost.io'): Promise<Result<{ gamesUpdated: number; controlsUpdated: number }, string>> {
    const url = baseUrl.replace(/\/+$/, '');

    return tryCatchAsync(
      async () => {
        const gamesUrl = `${url}/api/collections/tbl_cfg_arcade_games/records?filter=(bln_is_active=true)&sort=int_sort_order&perPage=50`;
        const ctrlUrl = `${url}/api/collections/tbl_cfg_system_controls/records?filter=(bln_is_active=true)&perPage=100`;

        const [gamesRes, ctrlRes] = await Promise.all([
          fetch(gamesUrl, { method: 'GET', headers: { Accept: 'application/json' } }),
          fetch(ctrlUrl, { method: 'GET', headers: { Accept: 'application/json' } })
        ]);

        let gamesUpdated = 0;
        let controlsUpdated = 0;

        if (gamesRes.ok) {
          const gamesData = (await gamesRes.json()) as PocketBaseListResponse<any>;
          for (const item of gamesData.items) {
            let keyRules: readonly string[] = [];
            if (Array.isArray(item.json_key_rules)) {
              keyRules = item.json_key_rules;
            } else if (typeof item.json_key_rules === 'string') {
              try {
                keyRules = JSON.parse(item.json_key_rules);
              } catch {
                keyRules = [];
              }
            }

            const rec: ArcadeGameConfigRecord = {
              id: item.id,
              txt_game_key: item.txt_game_key,
              txt_title: item.txt_title,
              txt_real_life_name: item.txt_real_life_name,
              txt_prefix: item.txt_prefix,
              txt_category: item.txt_category,
              txt_summary: item.txt_summary,
              txt_objective: item.txt_objective,
              json_key_rules: keyRules,
              txt_official_url: item.txt_official_url,
              txt_url_label: item.txt_url_label,
              int_min_players: Number(item.int_min_players),
              int_max_players: Number(item.int_max_players),
              int_sort_order: Number(item.int_sort_order),
              bln_is_active: item.bln_is_active === true || item.bln_is_active === 1,
              bln_is_maintenance: item.bln_is_maintenance === true || item.bln_is_maintenance === 1,
              txt_badge_text: item.txt_badge_text,
              txt_badge_color: item.txt_badge_color,
              txt_theme_color: item.txt_theme_color,
              json_layout_config: typeof item.json_layout_config === 'object' ? item.json_layout_config : undefined,
              int_version: Number(item.int_version || 1),
              txt_updated_by: item.txt_updated_by,
              created_at: 0,
              updated_at: 0
            };
            this.gamesMap.set(rec.txt_game_key, rec);
            gamesUpdated++;
          }
        }

        if (ctrlRes.ok) {
          const ctrlData = (await ctrlRes.json()) as PocketBaseListResponse<any>;
          for (const item of ctrlData.items) {
            const rec: SystemControlRecord = {
              id: item.id,
              txt_config_key: item.txt_config_key,
              txt_category: item.txt_category,
              txt_label: item.txt_label,
              txt_description: item.txt_description,
              txt_val_type: item.txt_val_type,
              txt_val_string: item.txt_val_string,
              dec_val_number: item.dec_val_number !== undefined && item.dec_val_number !== null ? Number(item.dec_val_number) : undefined,
              bln_val_boolean: item.bln_val_boolean !== undefined && item.bln_val_boolean !== null ? Boolean(item.bln_val_boolean) : undefined,
              json_val_payload: item.json_val_payload,
              bln_is_active: item.bln_is_active === true || item.bln_is_active === 1,
              int_version: Number(item.int_version || 1),
              txt_updated_by: item.txt_updated_by,
              created_at: 0,
              updated_at: 0
            };
            this.controlsMap.set(rec.txt_config_key, rec);
            controlsUpdated++;
          }
        }

        if (gamesUpdated > 0 || controlsUpdated > 0) {
          this.isLoadedFromRemote = true;
          this.notifyListeners();
          logger.info(`[CLIENT_SIDE] [CFG_TRACE] Loaded live configuration from PocketBase: ${gamesUpdated} games, ${controlsUpdated} controls.`);
        }

        return { gamesUpdated, controlsUpdated };
      },
      err => `Failed to load remote configuration: ${String(err)}`
    );
  }

  public isRemoteConfigActive(): boolean {
    return this.isLoadedFromRemote;
  }
}

export const globalConfigClient = new ConfigClient();
