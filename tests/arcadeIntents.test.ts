import { describe, expect, it } from 'bun:test';
import { isArcadeIntentType, parseArcadeIntent } from '../src/validation/arcadeIntents';

describe('Arcade guest intents', () => {
  it('parses valid intents into typed payloads', () => {
    expect(parseArcadeIntent('uno_play', { handIndex: 2, wildColor: 'red' }).getOrThrow()).toEqual({ type: 'uno_play', payload: { handIndex: 2, wildColor: 'red' } });
    expect(parseArcadeIntent('uno_draw', undefined).getOrThrow()).toEqual({ type: 'uno_draw', payload: {} });
    expect(parseArcadeIntent('set_claim', { cardIds: ['a', 'b', 'c'] }).isSuccess()).toBe(true);
    expect(parseArcadeIntent('avalon_vote', { approve: false }).getOrThrow().payload).toEqual({ approve: false });
    expect(parseArcadeIntent('avalon_assassinate', { targetId: 'p3' }).isSuccess()).toBe(true);
  });

  it('rejects unknown intents and malformed or out-of-range payloads', () => {
    expect(isArcadeIntentType('state_sync')).toBe(false);
    expect(isArcadeIntentType('toString')).toBe(false);
    expect(parseArcadeIntent('state_sync', {}).match({ Ok: () => '', Err: e => e })).toBe('Unknown arcade intent: state_sync');
    expect(parseArcadeIntent('uno_play', { handIndex: -1 }).isFailure()).toBe(true);
    expect(parseArcadeIntent('uno_play', { handIndex: 1, wildColor: 'purple' }).isFailure()).toBe(true);
    expect(parseArcadeIntent('skipbo_play', { source: 'hand', sourceIndex: 0, buildingIndex: 4 }).isFailure()).toBe(true);
    expect(parseArcadeIntent('set_claim', { cardIds: ['a', 'b'] }).isFailure()).toBe(true);
    expect(parseArcadeIntent('bjk_bet', { amount: 0 }).isFailure()).toBe(true);
    expect(parseArcadeIntent('p10_lay', { g1: [0, 1], g2: 'x' }).isFailure()).toBe(true);
  });
});
