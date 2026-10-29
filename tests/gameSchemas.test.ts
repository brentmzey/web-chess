import { describe, it, expect } from 'bun:test';
import {
  safeParsePokerPlayerData,
  defaultPokerPlayerData,
  validateArcadeGameConfig,
  validateSystemControl,
  PokerPlayerDataSchema,
  ArcadeGameConfigSchema,
  SystemControlSchema
} from '../src/validation/gameSchemas';
import { PokerHandRankEnum, ArcadeGameEnum, SystemControlKeyEnum } from '../src/constants/gameEnums';

describe('Zod Schema Validation & Strong Typing for Arcade Games', () => {
  it('exports underlying Zod schema definitions', () => {
    expect(PokerPlayerDataSchema).toBeDefined();
    expect(ArcadeGameConfigSchema).toBeDefined();
    expect(SystemControlSchema).toBeDefined();
  });
  describe('Poker Player Data Schema & Normalization', () => {
    it('returns default poker player data on null, undefined, or empty object input', () => {
      const def = defaultPokerPlayerData();
      expect(def.holeCards).toEqual([]);
      expect(def.currentBet).toBe(0);
      expect(def.chipBank).toBe(1000);
      expect(def.folded).toBe(false);
      expect(def.isAllIn).toBe(false);
      expect(def.handRank).toBeUndefined();

      const fromNull = safeParsePokerPlayerData(null);
      expect(fromNull.holeCards).toEqual([]);
      expect(fromNull.chipBank).toBe(1000);

      const fromEmpty = safeParsePokerPlayerData({});
      expect(fromEmpty.holeCards).toEqual([]);
      expect(fromEmpty.chipBank).toBe(1000);
      expect(fromEmpty.folded).toBe(false);

      const fromUndefined = safeParsePokerPlayerData(undefined);
      expect(fromUndefined.holeCards).toEqual([]);
    });

    it('safely parses valid poker player data with cards and hand rank', () => {
      const valid = {
        holeCards: [
          { suit: 'hearts', value: 'A', faceUp: true },
          { suit: 'spades', value: 'K', faceUp: true }
        ],
        currentBet: 40,
        chipBank: 960,
        folded: false,
        isAllIn: false,
        handRank: {
          rank: PokerHandRankEnum.OnePair,
          score: 200,
          description: 'Pair of Aces'
        }
      };

      const parsed = safeParsePokerPlayerData(valid);
      expect(parsed.holeCards.length).toBe(2);
      expect(parsed.holeCards[0]!.value).toBe('A');
      expect(parsed.currentBet).toBe(40);
      expect(parsed.chipBank).toBe(960);
      expect(parsed.handRank?.description).toBe('Pair of Aces');
    });

    it('catches and defaults invalid nested card structures or wrong types', () => {
      const invalidCards = {
        holeCards: 'not-an-array',
        currentBet: 'not-a-number',
        chipBank: 'not-a-number',
        folded: 'not-a-bool'
      };

      const parsed = safeParsePokerPlayerData(invalidCards);
      expect(parsed.holeCards).toEqual([]);
      expect(parsed.currentBet).toBe(0);
      expect(parsed.chipBank).toBe(1000);
      expect(parsed.folded).toBe(false);
    });
  });

  describe('ArcadeGameConfig Zod Validation', () => {
    it('validates and parses a valid ArcadeGameConfigRecord', () => {
      const valid = {
        txt_game_key: ArcadeGameEnum.Chess,
        txt_title: 'Sanctuary Chess',
        txt_real_life_name: 'Chess (FIDE)',
        txt_prefix: 'SANCT-',
        txt_category: 'board',
        txt_summary: '3D Gothic Chess',
        txt_objective: 'Checkmate',
        json_key_rules: ['Rule 1', 'Rule 2'],
        txt_official_url: 'https://en.wikipedia.org/wiki/Chess',
        txt_url_label: 'Chess Wikipedia',
        int_min_players: 2,
        int_max_players: 2,
        int_sort_order: 1,
        bln_is_active: true,
        bln_is_maintenance: false,
        txt_badge_text: 'Live',
        txt_badge_color: 'emerald',
        txt_theme_color: 'amber'
      };

      const res = validateArcadeGameConfig(valid);
      expect(res.isSuccess()).toBe(true);
      const val = res.getOrThrow();
      expect(val.txt_game_key).toBe('chess');
      expect(val.json_key_rules).toEqual(['Rule 1', 'Rule 2']);
      expect(val.int_min_players).toBe(2);
    });

    it('transforms stringified JSON rules into array of strings', () => {
      const withStringRules = {
        txt_game_key: 'poker',
        txt_title: 'Cathedral Poker',
        txt_real_life_name: 'Texas Holdem',
        txt_prefix: 'POKER-',
        txt_category: 'cards',
        txt_summary: 'Poker Summary',
        txt_objective: 'Win the pot',
        json_key_rules: JSON.stringify(['Rule Alpha', 'Rule Beta']),
        txt_official_url: 'https://example.com',
        txt_url_label: 'Poker',
        int_min_players: '2',
        int_max_players: '9',
        int_sort_order: '3',
        bln_is_active: 1,
        bln_is_maintenance: 0,
        txt_badge_text: 'Live',
        txt_badge_color: 'amber',
        txt_theme_color: 'amber'
      };

      const res = validateArcadeGameConfig(withStringRules);
      expect(res.isSuccess()).toBe(true);
      const val = res.getOrThrow();
      expect(val.json_key_rules).toEqual(['Rule Alpha', 'Rule Beta']);
      expect(val.int_min_players).toBe(2);
      expect(val.int_max_players).toBe(9);
      expect(val.bln_is_active).toBe(true);
      expect(val.bln_is_maintenance).toBe(false);
    });

    it('falls back to empty array for corrupted stringified rules', () => {
      const withCorruptedRules = {
        txt_game_key: 'uno',
        txt_title: 'Cardinal Uno',
        txt_real_life_name: 'Uno',
        txt_prefix: 'UNO-',
        json_key_rules: '{corrupt json',
        txt_badge_text: 'Live',
        txt_badge_color: 'amber',
        txt_theme_color: 'amber'
      };

      const res = validateArcadeGameConfig(withCorruptedRules);
      expect(res.isSuccess()).toBe(true);
      expect(res.getOrThrow().json_key_rules).toEqual([]);
    });

    it('returns a Failure when mandatory fields are missing', () => {
      const invalid = {
        txt_game_key: '', // Empty string violates min(1)
        txt_title: 'Test'
      };

      const res = validateArcadeGameConfig(invalid);
      expect(res.isFailure()).toBe(true);
      expect(res.fold(err => err, () => '')).toContain('Invalid ArcadeGameConfig');
    });
  });

  describe('SystemControl Zod Validation', () => {
    it('validates string, number, boolean, and json system controls', () => {
      const ctrlStr = {
        txt_config_key: SystemControlKeyEnum.AppTitle,
        txt_category: 'ui',
        txt_label: 'Title',
        txt_val_type: 'string',
        txt_val_string: 'Sanctuary 3D'
      };
      const resStr = validateSystemControl(ctrlStr);
      expect(resStr.isSuccess()).toBe(true);
      expect(resStr.getOrThrow().txt_val_string).toBe('Sanctuary 3D');

      const ctrlNum = {
        txt_config_key: 'system.stale_days',
        txt_category: 'system',
        txt_label: 'Stale Days',
        txt_val_type: 'number',
        dec_val_number: '5'
      };
      const resNum = validateSystemControl(ctrlNum);
      expect(resNum.isSuccess()).toBe(true);
      expect(resNum.getOrThrow().dec_val_number).toBe(5);

      const ctrlBool = {
        txt_config_key: 'arcade.quick_join',
        txt_category: 'arcade',
        txt_label: 'Quick Join',
        txt_val_type: 'boolean',
        bln_val_boolean: 1
      };
      const resBool = validateSystemControl(ctrlBool);
      expect(resBool.isSuccess()).toBe(true);
      expect(resBool.getOrThrow().bln_val_boolean).toBe(true);

      const ctrlJson = {
        txt_config_key: 'arcade.features',
        txt_category: 'arcade',
        txt_label: 'Features',
        txt_val_type: 'json',
        json_val_payload: { enabled: true }
      };
      const resJson = validateSystemControl(ctrlJson);
      expect(resJson.isSuccess()).toBe(true);
      expect(resJson.getOrThrow().json_val_payload).toEqual({ enabled: true });
    });

    it('rejects unknown control types or missing keys', () => {
      const invalidType = {
        txt_config_key: 'ui.test',
        txt_label: 'Test',
        txt_val_type: 'invalid_type'
      };
      const res = validateSystemControl(invalidType);
      expect(res.isFailure()).toBe(true);
      expect(res.fold(err => err, () => '')).toContain('Invalid SystemControl');
    });
  });
});
