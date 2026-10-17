import { describe, expect, it } from 'bun:test';
import { Chess } from 'chess.js';
import {
  buildGeminiNanoSystemPrompt,
  checkGeminiNanoStatus,
  computeGeminiNanoAIMove,
  matchResponseToLegalMove
} from '../src/engine/geminiNanoAI';
import { OpponentDifficultyEnum } from '../src/types';

describe('Chrome Canary Built-in AI (Prompt API / Gemini Nano)', () => {
  it('reports unsupported gracefully in non-browser or standard test environment', async () => {
    const status = await checkGeminiNanoStatus();
    expect(status.available).toBe(false);
    expect(status.status).toBe('unsupported');
    expect(status.message.length).toBeGreaterThan(0);
  });

  it('builds distinct persona system prompts for Cautious, Balanced, and Aggressive difficulties', () => {
    const cautiousPrompt = buildGeminiNanoSystemPrompt(OpponentDifficultyEnum.Cautious);
    const balancedPrompt = buildGeminiNanoSystemPrompt(OpponentDifficultyEnum.Balanced);
    const aggressivePrompt = buildGeminiNanoSystemPrompt(OpponentDifficultyEnum.Aggressive);

    expect(cautiousPrompt).toContain('cautious, defensive');
    expect(balancedPrompt).toContain('balanced chess master');
    expect(aggressivePrompt).toContain('ruthless, hyper-aggressive');
  });

  it('matches exact SAN responses from an LLM', () => {
    const game = new Chess();
    game.move('e4');
    const legalMoves = game.moves({ verbose: true });

    const matched = matchResponseToLegalMove('e5', legalMoves);
    expect(matched).not.toBeNull();
    expect(matched?.san).toBe('e5');
  });

  it('matches UCI notation responses (e.g. e7e5)', () => {
    const game = new Chess();
    game.move('e4');
    const legalMoves = game.moves({ verbose: true });

    const matched = matchResponseToLegalMove('e7e5', legalMoves);
    expect(matched).not.toBeNull();
    expect(matched?.san).toBe('e5');
  });

  it('extracts legal move from conversational markdown/wrapped text', () => {
    const game = new Chess();
    game.move('e4');
    const legalMoves = game.moves({ verbose: true });

    const matched = matchResponseToLegalMove('```Nf6```', legalMoves);
    expect(matched).not.toBeNull();
    expect(matched?.san).toBe('Nf6');

    const matched2 = matchResponseToLegalMove('I recommend playing c5 to counter.', legalMoves);
    expect(matched2).not.toBeNull();
    expect(matched2?.san).toBe('c5');
  });

  it('returns null when response contains no valid legal moves', () => {
    const game = new Chess();
    const legalMoves = game.moves({ verbose: true });
    const matched = matchResponseToLegalMove('invalid move xyz', legalMoves);
    expect(matched).toBeNull();
  });

  it('falls back to Micro-Neural AI with chosen difficulty when Gemini Nano is unavailable', async () => {
    const game = new Chess();
    game.move('e4');

    let statusMsg = '';
    const result = await computeGeminiNanoAIMove(
      game,
      msg => {
        statusMsg = msg;
      },
      OpponentDifficultyEnum.Aggressive
    );

    expect(result.source).toBe('fallback');
    expect(result.move).not.toBeNull();
    expect(result.move?.color).toBe('b');
    expect(statusMsg).toContain('Falling back to Micro-Neural AI');
  });
});
