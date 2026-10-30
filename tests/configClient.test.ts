import { describe, expect, it, beforeEach, mock } from 'bun:test';
import { ConfigClient, CONFIG_CONTROLS_COLLECTION, CONFIG_GAMES_COLLECTION } from '../src/realtime/configClient';
import { DEFAULT_ARCADE_GAME_CONFIGS, DEFAULT_SYSTEM_CONTROLS } from '../src/constants/defaultConfigs';
import { ArcadeGameEnum, SystemControlKeyEnum } from '../src/constants/gameEnums';

describe('ConfigClient - Client-Side Database-Driven Dynamic UI Synchronization', () => {
  let client: ConfigClient;

  beforeEach(() => {
    client = new ConfigClient();
  });

  it('initializes with canonical local defaults without needing a remote network call', () => {
    const allGames = client.getAllActiveGames();
    expect(allGames.length).toBe(9);

    const chessConfig = client.getGameConfig(ArcadeGameEnum.Chess);
    expect(chessConfig.isSome()).toBe(true);
    expect(chessConfig.getOrThrow().txt_real_life_name).toBe('Classical Chess (FIDE)');

    const ruleInfo = client.getGameRuleInfo(ArcadeGameEnum.Blackjack).getOrThrow();
    expect(ruleInfo.realLifeName).toBe('Blackjack (Twenty-One)');
    expect(ruleInfo.objective).toContain('21');

    const appTitle = client.getSystemControlValue(SystemControlKeyEnum.AppTitle, 'default');
    expect(appTitle).toContain("Wizard's Chess 3D");

    const rulesEnabled = client.getSystemControlValue(SystemControlKeyEnum.RulesModalEnabled, false);
    expect(rulesEnabled).toBe(true);
  });

  it('returns fallback for unknown game keys and configs', () => {
    const unknownRule = client.getGameRuleInfo('unknown_game');
    expect(unknownRule.isNone()).toBe(true);

    const fallbackVal = client.getSystemControlValue('non.existent.key', 'fallback_result');
    expect(fallbackVal).toBe('fallback_result');
  });

  it('subscribes to changes and receives notifications when remote config loads', async () => {
    let notified = false;
    const unsubscribe = client.subscribe(() => {
      notified = true;
    });

    // Mock fetch for PocketBase
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = async (url: string) => {
      if (url.includes('tbl_cfg_arcade_games')) {
        return {
          ok: true,
          json: async () => ({
            totalItems: 1,
            items: [
              {
                id: 'pb_chess',
                txt_game_key: 'chess',
                txt_title: "Cathedral Grandmaster Chess 3D",
                txt_real_life_name: 'Classical Chess (FIDE World Championship)',
                txt_prefix: 'SANCT-',
                txt_category: 'classic-board',
                txt_summary: 'Remote driven summary',
                txt_objective: 'Remote checkmate objective',
                json_key_rules: ['Rule 1 from remote', 'Rule 2 from remote'],
                txt_official_url: 'https://en.wikipedia.org/wiki/Rules_of_chess',
                txt_url_label: 'FIDE Rules',
                int_min_players: 2,
                int_max_players: 2,
                int_sort_order: 1,
                bln_is_active: true,
                bln_is_maintenance: false,
                txt_badge_text: 'Live Remote',
                txt_badge_color: 'amber',
                txt_theme_color: 'amber',
                int_version: 3
              }
            ]
          })
        };
      }
      if (url.includes('tbl_cfg_system_controls')) {
        return {
          ok: true,
          json: async () => ({
            totalItems: 1,
            items: [
              {
                id: 'pb_title',
                txt_config_key: 'ui.app_title',
                txt_category: 'ui',
                txt_label: 'Main Application Title',
                txt_val_type: 'string',
                txt_val_string: 'High Gothic Cathedral Online (PB Driven)',
                bln_is_active: true,
                int_version: 5
              }
            ]
          })
        };
      }
      return { ok: false, status: 404 };
    };

    const fetchRes = await client.fetchRemoteConfig('https://web-chess.pockethost.io');
    expect(fetchRes.isSuccess()).toBe(true);
    expect(notified).toBe(true);
    expect(client.isRemoteConfigActive()).toBe(true);

    // Verify updated values from remote
    const updatedChess = client.getGameConfig('chess').getOrThrow();
    expect(updatedChess.txt_title).toBe('Cathedral Grandmaster Chess 3D');
    expect(updatedChess.txt_real_life_name).toBe('Classical Chess (FIDE World Championship)');
    expect(updatedChess.int_version).toBe(3);

    const updatedTitle = client.getSystemControlValue('ui.app_title', '');
    expect(updatedTitle).toBe('High Gothic Cathedral Online (PB Driven)');

    unsubscribe();
    (globalThis as any).fetch = originalFetch;
  });

  it('handles remote network failures gracefully without affecting local fallback', async () => {
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => {
      throw new Error('Network error / offline');
    };

    const fetchRes = await client.fetchRemoteConfig('https://offline.mock.io');
    expect(fetchRes.isFailure()).toBe(true);

    // Default configuration must remain perfectly intact
    const chess = client.getGameConfig('chess').getOrThrow();
    expect(chess.txt_title).toContain("Wizard's Chess 3D");

    (globalThis as any).fetch = originalFetch;
  });

  it('handles throwing listeners, string rules parsing, corrupted string rules, and unknown control types', async () => {
    // 1. Throwing listener does not abort other listeners
    let secondListenerRan = false;
    client.subscribe(() => {
      throw new Error('Exploding subscriber');
    });
    client.subscribe(() => {
      secondListenerRan = true;
    });

    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = async (url: string) => {
      if (url.includes('tbl_cfg_arcade_games')) {
        return {
          ok: true,
          json: async () => ({
            totalItems: 2,
            items: [
              {
                id: 'pb_g1',
                txt_game_key: 'chess',
                txt_title: 'Title Valid String Rules',
                txt_real_life_name: 'Chess',
                txt_prefix: 'SANCT-',
                txt_category: 'board',
                txt_summary: 'S',
                txt_objective: 'O',
                json_key_rules: JSON.stringify(['Rule Alpha', 'Rule Beta']),
                txt_official_url: 'https://example.com',
                txt_url_label: 'Label',
                int_min_players: 2,
                int_max_players: 2,
                int_sort_order: 1,
                bln_is_active: 1,
                bln_is_maintenance: 0,
                txt_badge_text: 'Live',
                txt_badge_color: 'emerald',
                txt_theme_color: 'amber',
                json_layout_config: { customKey: 'val' }
              },
              {
                id: 'pb_g2',
                txt_game_key: 'blackjack',
                txt_title: 'Corrupt Rules Game',
                txt_real_life_name: 'Blackjack',
                txt_prefix: 'BJK-',
                txt_category: 'cards',
                txt_summary: 'S',
                txt_objective: 'O',
                json_key_rules: '{corrupt_json',
                txt_official_url: 'https://example.com',
                txt_url_label: 'Label',
                int_min_players: 1,
                int_max_players: 7,
                int_sort_order: 2,
                bln_is_active: 1,
                bln_is_maintenance: 0,
                txt_badge_text: 'Live',
                txt_badge_color: 'emerald',
                txt_theme_color: 'emerald'
              },
              {
                id: 'pb_invalid',
                txt_game_key: '',
                txt_title: 'Invalid'
              }
            ]
          })
        };
      }
      if (url.includes('tbl_cfg_system_controls')) {
        return {
          ok: true,
          json: async () => ({
            totalItems: 2,
            items: [
              {
                id: 'ctrl_unknown',
                txt_config_key: 'custom.unknown_type',
                txt_category: 'ui',
                txt_label: 'Unknown',
                txt_val_type: 'unknown_type_variant',
                bln_is_active: 1
              },
              {
                id: 'ctrl_json',
                txt_config_key: 'custom.json_payload',
                txt_category: 'ui',
                txt_label: 'JSON Payload',
                txt_val_type: 'json',
                json_val_payload: { activeTheme: 'cathedral' },
                bln_is_active: 1
              }
            ]
          })
        };
      }
      return { ok: false, status: 404 };
    };

    const fetchRes = await client.fetchRemoteConfig();
    expect(fetchRes.isSuccess()).toBe(true);
    expect(secondListenerRan).toBe(true);

    const chessRules = client.getGameConfig('chess').getOrThrow().json_key_rules;
    expect(chessRules).toEqual(['Rule Alpha', 'Rule Beta']);

    const bjkRules = client.getGameConfig('blackjack').getOrThrow().json_key_rules;
    expect(bjkRules).toEqual([]);

    expect(client.getSystemControlValue('custom.unknown_type', 'fallback_unknown')).toBe('fallback_unknown');
    expect(client.getSystemControlValue<any>('custom.json_payload', null)).toEqual({ activeTheme: 'cathedral' });

    (globalThis as any).fetch = originalFetch;
  });

  describe('live configuration over PocketBase SSE', () => {
    const control = (key: string,
                     over: Record<string, unknown> = {}) => ({
      ...DEFAULT_SYSTEM_CONTROLS.find(c => c.txt_config_key === key)!,
      id: `rec_${key}`,
      int_version: 2,
      created_at: 0,
      updated_at: 0,
      ...over
    });

    it('applies control edits, restores defaults on delete, and ignores invalid or unknown records', () => {
      let notified = 0;
      client.subscribe(() => { notified += 1; });

      expect(client.applyRealtimeConfigChange(CONFIG_CONTROLS_COLLECTION, 'update',
                                              control(SystemControlKeyEnum.ArcadeBotTurnDelayMs, { dec_val_number: 1200 }))).toBe(true);
      expect(client.getSystemControlValue(SystemControlKeyEnum.ArcadeBotTurnDelayMs, 0)).toBe(1200);

      expect(client.applyRealtimeConfigChange(CONFIG_CONTROLS_COLLECTION, 'delete',
                                              control(SystemControlKeyEnum.ArcadeBotTurnDelayMs, { dec_val_number: 1200 }))).toBe(true);
      expect(client.getSystemControlValue(SystemControlKeyEnum.ArcadeBotTurnDelayMs, 0)).toBe(700);

      expect(client.applyRealtimeConfigChange(CONFIG_CONTROLS_COLLECTION, 'delete',
                                              control(SystemControlKeyEnum.ArcadeBotTurnDelayMs, { txt_config_key: 'custom.operator_key' }))).toBe(true);
      expect(client.getSystemControlValue('custom.operator_key', 'fallback')).toBe('fallback');

      expect(client.applyRealtimeConfigChange(CONFIG_CONTROLS_COLLECTION, 'update', { nonsense: true })).toBe(false);
      expect(client.applyRealtimeConfigChange('tbl_other', 'update', {})).toBe(false);
      expect(notified).toBe(3);
    });

    it('adds, updates and removes arcade games live', () => {
      const uno = { ...DEFAULT_ARCADE_GAME_CONFIGS.find(g => g.txt_game_key === ArcadeGameEnum.Uno)!, id: 'rec_uno', int_version: 2, created_at: 0, updated_at: 0 };
      expect(client.applyRealtimeConfigChange(CONFIG_GAMES_COLLECTION, 'update', { ...uno, txt_title: 'Cardinal Uno Live' })).toBe(true);
      expect(client.getGameConfig(ArcadeGameEnum.Uno).getOrThrow().txt_title).toBe('Cardinal Uno Live');

      expect(client.applyRealtimeConfigChange(CONFIG_GAMES_COLLECTION, 'update', { ...uno, bln_is_active: false })).toBe(true);
      expect(client.getGameConfig(ArcadeGameEnum.Uno).isNone()).toBe(true);

      client.applyRealtimeConfigChange(CONFIG_GAMES_COLLECTION, 'update', uno);
      expect(client.applyRealtimeConfigChange(CONFIG_GAMES_COLLECTION, 'delete', uno)).toBe(true);
      expect(client.getGameConfig(ArcadeGameEnum.Uno).isNone()).toBe(true);
      expect(client.applyRealtimeConfigChange(CONFIG_GAMES_COLLECTION, 'update', { broken: 1 })).toBe(false);
    });

    it('subscribes to both config collections and applies streamed changes', async () => {
      const originalES = (globalThis as any).EventSource;
      const originalFetch = globalThis.fetch;
      const bodies: any[] = [];
      let es: any = null;
      (globalThis as any).EventSource = class {
        public listeners: Record<string, ((e: any) => void)[]> = {};
        public closed = false;
        constructor(public url: string) { es = this; }
        addEventListener(t: string, fn: (e: any) => void) { (this.listeners[t] ||= []).push(fn); }
        close() { this.closed = true; }
      };
      let status = 204;
      globalThis.fetch = mock(async (_url: string, init?: any) => {
        bodies.push(JSON.parse(init.body));
        return new Response(null, { status });
      }) as any;

      try {
        const unsubscribe = client.subscribeRealtime('https://cfg.pockethost.io/');
        expect(es.url).toBe('https://cfg.pockethost.io/api/realtime');
        es.listeners['PB_CONNECT'][0]({ data: JSON.stringify({ clientId: 'c1' }) });
        await new Promise(r => setTimeout(r, 0));
        expect(bodies[0]).toEqual({ clientId: 'c1', subscriptions: [`${CONFIG_GAMES_COLLECTION}/*`, `${CONFIG_CONTROLS_COLLECTION}/*`] });

        status = 403;
        es.listeners['PB_CONNECT'][0]({ data: JSON.stringify({ clientId: 'c2' }) });
        await new Promise(r => setTimeout(r, 0));

        es.listeners[`${CONFIG_CONTROLS_COLLECTION}/*`][0]({
          data: JSON.stringify({ action: 'update', record: control(SystemControlKeyEnum.ArcadeSyncBatchMs, { dec_val_number: 400 }) })
        });
        expect(client.getSystemControlValue(SystemControlKeyEnum.ArcadeSyncBatchMs, 0)).toBe(400);
        es.listeners[`${CONFIG_GAMES_COLLECTION}/*`][0]({ data: JSON.stringify({ record: { broken: 1 } }) });
        es.listeners[`${CONFIG_GAMES_COLLECTION}/*`][0]({ data: 'not json' });

        unsubscribe();
        expect(es.closed).toBe(true);

        (globalThis as any).EventSource = class {
          constructor() { throw new Error('blocked'); }
        };
        const noop = client.subscribeRealtime();
        expect(() => noop()).not.toThrow();
      } finally {
        (globalThis as any).EventSource = originalES;
        globalThis.fetch = originalFetch;
      }
    });
  });
});
