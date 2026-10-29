import { z } from 'zod';
import { Result, success, failure } from '../utils/fp';
import type { PokerPlayerData } from '../games/poker/pokerEngine';
import type { ArcadeGameConfigRecord, SystemControlRecord } from '../types/config';
import { PokerHandRankEnum } from '../constants/gameEnums';

/**
 * Zod schema for EvaluatedHand in Poker.
 */
export const EvaluatedHandSchema = z.object({
  rank: z.nativeEnum(PokerHandRankEnum),
  score: z.number(),
  description: z.string()
});

/**
 * Zod schema for PlayingCard.
 */
export const PlayingCardSchema = z.object({
  suit: z.string(),
  value: z.string(),
  faceUp: z.boolean().optional().default(true)
});

/**
 * Zod schema for PokerPlayerData with resilient defaults.
 */
export const PokerPlayerDataSchema = z.object({
  holeCards: z.array(PlayingCardSchema).catch([]),
  currentBet: z.number().catch(0),
  chipBank: z.number().catch(1000),
  folded: z.boolean().catch(false),
  isAllIn: z.boolean().catch(false),
  handRank: EvaluatedHandSchema.optional()
});

export const defaultPokerPlayerData = (): PokerPlayerData => ({
  holeCards: [],
  currentBet: 0,
  chipBank: 1000,
  folded: false,
  isAllIn: false,
  handRank: undefined
});

/**
 * Safely parses and normalizes poker player extra data.
 */
export function safeParsePokerPlayerData(input: unknown): PokerPlayerData {
  const result = PokerPlayerDataSchema.safeParse(input);
  if (result.success) {
    return result.data as PokerPlayerData;
  }
  return defaultPokerPlayerData();
}

/**
 * Zod schema for ArcadeGameConfigRecord.
 */
export const ArcadeGameConfigSchema = z.object({
  id: z.string().optional().default(''),
  txt_game_key: z.string().min(1),
  txt_title: z.string().min(1),
  txt_real_life_name: z.string().min(1),
  txt_prefix: z.string().min(1),
  txt_category: z.string().default('cards'),
  txt_summary: z.string().default(''),
  txt_objective: z.string().default(''),
  json_key_rules: z.union([z.array(z.string()), z.string()]).transform(val => {
    if (Array.isArray(val)) return val;
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }),
  txt_official_url: z.string().default(''),
  txt_url_label: z.string().default(''),
  int_min_players: z.coerce.number().default(1),
  int_max_players: z.coerce.number().default(10),
  int_sort_order: z.coerce.number().default(1),
  bln_is_active: z.coerce.boolean().default(true),
  bln_is_maintenance: z.coerce.boolean().default(false),
  txt_badge_text: z.string().default('Live'),
  txt_badge_color: z.string().default('amber'),
  txt_theme_color: z.string().default('amber'),
  json_layout_config: z.record(z.string(), z.any()).optional(),
  int_version: z.coerce.number().default(1),
  txt_updated_by: z.string().optional(),
  created_at: z.number().default(0),
  updated_at: z.number().default(0)
});

/**
 * Zod schema for SystemControlRecord.
 */
export const SystemControlSchema = z.object({
  id: z.string().optional().default(''),
  txt_config_key: z.string().min(1),
  txt_category: z.string().default('general'),
  txt_label: z.string().min(1),
  txt_description: z.string().optional().default(''),
  txt_val_type: z.enum(['string', 'number', 'boolean', 'json']),
  txt_val_string: z.string().optional().default(''),
  dec_val_number: z.coerce.number().optional(),
  bln_val_boolean: z.coerce.boolean().optional(),
  json_val_payload: z.any().optional(),
  bln_is_active: z.coerce.boolean().default(true),
  int_version: z.coerce.number().default(1),
  txt_updated_by: z.string().optional(),
  created_at: z.number().default(0),
  updated_at: z.number().default(0)
});

/**
 * Validates and parses an ArcadeGameConfigRecord using Zod.
 */
export function validateArcadeGameConfig(raw: unknown): Result<ArcadeGameConfigRecord, string> {
  const parsed = ArcadeGameConfigSchema.safeParse(raw);
  if (parsed.success) {
    return success(parsed.data as ArcadeGameConfigRecord);
  }
  return failure(`Invalid ArcadeGameConfig: ${parsed.error.message}`);
}

/**
 * Validates and parses a SystemControlRecord using Zod.
 */
export function validateSystemControl(raw: unknown): Result<SystemControlRecord, string> {
  const parsed = SystemControlSchema.safeParse(raw);
  if (parsed.success) {
    return success(parsed.data as SystemControlRecord);
  }
  return failure(`Invalid SystemControl: ${parsed.error.message}`);
}
