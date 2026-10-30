import { z } from 'zod';
import { failure, type Result } from '../utils/fp';
import { parseWith } from './realtimeSchemas';

/**
 * Typed moves a guest asks the table host to make on their seat. The host validates the payload here,
 * then checks that the sender owns the seat whose turn it is before running the engine.
 */

const index = z.number().int().min(0).max(200);
const empty = z.object({}).passthrough();

export const ARCADE_INTENT_SCHEMAS = {
  uno_play: z.object({ handIndex: index, wildColor: z.enum(['red', 'blue', 'green', 'yellow']).optional() }),
  uno_draw: empty,
  uno_call: empty,
  skipbo_play: z.object({ source: z.string().min(1).max(16), sourceIndex: index, buildingIndex: z.number().int().min(0).max(3) }),
  skipbo_discard: z.object({ handIndex: index, targetIndex: z.number().int().min(0).max(3) }),
  p10_draw: z.object({ fromDiscard: z.boolean() }),
  p10_lay: z.object({ g1: z.array(index).max(20), g2: z.array(index).max(20) }),
  p10_hit: z.object({ cardIndex: index, groupIndex: z.number().int().min(0).max(5), targetPlayerId: z.string().min(1).max(64) }),
  p10_discard: z.object({ cardIndex: index }),
  poker_action: z.object({ action: z.string().min(1).max(16), amount: z.number().int().min(0).optional() }),
  poker_draw: z.object({ discardIndices: z.array(index).max(5) }),
  bjk_bet: z.object({ amount: z.number().int().min(1).max(100000) }),
  bjk_hit: empty,
  bjk_stand: empty,
  bjk_double: empty,
  avalon_propose: z.object({ team: z.array(z.string().min(1).max(64)).min(1).max(10) }),
  avalon_vote: z.object({ approve: z.boolean() }),
  avalon_quest: z.object({ pass: z.boolean() }),
  avalon_assassinate: z.object({ targetId: z.string().min(1).max(64) }),
  set_claim: z.object({ cardIds: z.array(z.string().min(1).max(64)).length(3) })
} as const;

export type ArcadeIntentType = keyof typeof ARCADE_INTENT_SCHEMAS;
export type ArcadeIntentPayload<T extends ArcadeIntentType> = z.infer<(typeof ARCADE_INTENT_SCHEMAS)[T]>;

/** A validated intent, discriminated by its type. */
export type ArcadeIntent = { [T in ArcadeIntentType]: { readonly type: T; readonly payload: ArcadeIntentPayload<T> } }[ArcadeIntentType];

export const isArcadeIntentType = (actionType: string): actionType is ArcadeIntentType =>
  Object.prototype.hasOwnProperty.call(ARCADE_INTENT_SCHEMAS, actionType);

/** Parses an incoming action into a typed intent, rejecting unknown types and malformed payloads. */
export const parseArcadeIntent = (actionType: string,
                                  payload: unknown): Result<ArcadeIntent, string> =>
  isArcadeIntentType(actionType)
    ? parseWith(ARCADE_INTENT_SCHEMAS[actionType] as z.ZodType<unknown>, payload ?? {}, `${actionType} intent`)
      .map(parsed => ({ type: actionType, payload: parsed }) as ArcadeIntent)
    : failure(`Unknown arcade intent: ${actionType}`);
