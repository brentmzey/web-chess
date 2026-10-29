import { describe, expect, it, beforeEach } from 'bun:test';
import { ConfigClient } from '../src/realtime/configClient';

describe('ConfigClient - Client-Side Database-Driven Dynamic UI Synchronization', () => {
  let client: ConfigClient;

  beforeEach(() => {
    client = new ConfigClient();
  });

  it('initializes with canonical local defaults without needing a remote network call', () => {
    const allGames = client.getAllActiveGames();
    expect(allGames.length).toBe(8);

    const chessConfig = client.getGameConfig('chess');
    expect(chessConfig.isSome()).toBe(true);
    expect(chessConfig.getOrThrow().txt_real_life_name).toBe('Classical Chess (FIDE)');

    const ruleInfo = client.getGameRuleInfo('blackjack').getOrThrow();
    expect(ruleInfo.realLifeName).toBe('Blackjack (Twenty-One)');
    expect(ruleInfo.objective).toContain('21');

    const appTitle = client.getSystemControlValue('ui.app_title', 'default');
    expect(appTitle).toContain("Wizard's Chess 3D");

    const rulesEnabled = client.getSystemControlValue('ui.rules_modal_enabled', false);
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
});
