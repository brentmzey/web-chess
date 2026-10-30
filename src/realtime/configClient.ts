import { ARCADE_GAME_RULES, type GameRuleInfo } from '../constants/gameRules';
import { DEFAULT_ARCADE_GAME_CONFIGS, DEFAULT_SYSTEM_CONTROLS } from '../constants/defaultConfigs';
import type { ArcadeGameConfigRecord, SystemControlRecord } from '../types/config';
import {
  fromNullable,
  Option,
  Result,
  some,
  tryCatch,
  tryCatchAsync
} from '../utils/fp';
import { logger } from '../utils/logger';
import {
  validateArcadeGameConfig,
  validateSystemControl
} from '../validation/gameSchemas';

export const CONFIG_GAMES_COLLECTION = 'tbl_cfg_arcade_games';
export const CONFIG_CONTROLS_COLLECTION = 'tbl_cfg_system_controls';

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
            validateArcadeGameConfig(item).fold(
              err => {
                logger.warn(`Skipping invalid arcade game config: ${err}`);
              },
              rec => {
                this.gamesMap.set(rec.txt_game_key, rec);
                gamesUpdated++;
              }
            );
          }
        }

        if (ctrlRes.ok) {
          const ctrlData = (await ctrlRes.json()) as PocketBaseListResponse<any>;
          for (const item of ctrlData.items) {
            validateSystemControl(item).fold(
              err => {
                logger.warn(`Skipping invalid system control: ${err}`);
              },
              rec => {
                this.controlsMap.set(rec.txt_config_key, rec);
                controlsUpdated++;
              }
            );
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

  /**
   * Applies one realtime change from `tbl_cfg_arcade_games` or `tbl_cfg_system_controls`. Invalid
   * records are ignored; deleted or deactivated games are removed, and deleted controls fall back to
   * their built-in defaults.
   */
  public applyRealtimeConfigChange(collection: string,
                                   action: string,
                                   record: unknown): boolean {
    if (collection === CONFIG_GAMES_COLLECTION) {
      return validateArcadeGameConfig(record).fold(
        () => false,
        rec => {
          if (action === 'delete' || !rec.bln_is_active) {
            this.gamesMap.delete(rec.txt_game_key);
          } else {
            this.gamesMap.set(rec.txt_game_key, rec);
          }
          this.notifyListeners();
          return true;
        }
      );
    }
    if (collection === CONFIG_CONTROLS_COLLECTION) {
      return validateSystemControl(record).fold(
        () => false,
        rec => {
          if (action === 'delete') {
            fromNullable(DEFAULT_SYSTEM_CONTROLS.find(c => c.txt_config_key === rec.txt_config_key)).fold(
              () => {
                this.controlsMap.delete(rec.txt_config_key);
              },
              def => {
                this.controlsMap.set(rec.txt_config_key, { ...rec, ...def });
              }
            );
          } else {
            this.controlsMap.set(rec.txt_config_key, rec);
          }
          this.notifyListeners();
          return true;
        }
      );
    }
    return false;
  }

  /**
   * Keeps configuration live: subscribes to every change in the PocketBase config collections over
   * SSE, so an operator's edit applies to all open clients without a reload. Returns an unsubscribe.
   */
  public subscribeRealtime(baseUrl: string = 'https://web-chess.pockethost.io'): () => void {
    const url = baseUrl.replace(/\/+$/, '');
    const topics = [`${CONFIG_GAMES_COLLECTION}/*`, `${CONFIG_CONTROLS_COLLECTION}/*`];
    return tryCatch(() => new EventSource(`${url}/api/realtime`)).match({
      Ok: es => {
        es.addEventListener('PB_CONNECT', (e: MessageEvent) => {
          void tryCatchAsync(async () => {
            const { clientId } = JSON.parse(e.data) as { clientId: string };
            const res = await fetch(`${url}/api/realtime`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ clientId, subscriptions: topics })
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
          }, err => String(err)).then(res =>
            res.match({
              Ok: () => undefined,
              Err: err => {
                logger.warn(`[CFG_TRACE] Live configuration subscription failed: ${err}`);
              }
            })
          );
        });
        topics.forEach(topic =>
          es.addEventListener(topic, (e: MessageEvent) => {
            tryCatch(() => JSON.parse(e.data) as { action?: string; record?: unknown }).map(msg =>
              this.applyRealtimeConfigChange(topic.split('/')[0]!, String(msg.action ?? 'update'), msg.record)
            );
          })
        );
        return () => es.close();
      },
      Err: err => {
        logger.warn(`[CFG_TRACE] Live configuration unavailable: ${String(err)}`);
        return () => undefined;
      }
    });
  }
}

export const globalConfigClient = new ConfigClient();
