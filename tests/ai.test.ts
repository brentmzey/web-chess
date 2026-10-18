import { describe, expect, it } from 'bun:test';
import { Chess } from 'chess.js';
import { computeBestWizardAIMove, computeMinimaxMove, evaluateBoard } from '../src/engine/ai';
import { OpponentDifficultyEnum } from '../src/types';

describe('Minimax Engine and Board Evaluation with Difficulty Profiles', () => {
  it('evaluates starting board position as symmetrical / near 0 across all difficulties', () => {
    const game = new Chess();
    expect(evaluateBoard(game, OpponentDifficultyEnum.Cautious)).toBe(0);
    expect(evaluateBoard(game, OpponentDifficultyEnum.Balanced)).toBe(0);
    expect(evaluateBoard(game, OpponentDifficultyEnum.Aggressive)).toBe(0);
  });

  it('rewards center control and forward aggression proportionally to difficulty', () => {
    const game = new Chess();
    game.move('e4');
    const scoreCautious = evaluateBoard(game, OpponentDifficultyEnum.Cautious);
    const scoreBalanced = evaluateBoard(game, OpponentDifficultyEnum.Balanced);
    const scoreAggressive = evaluateBoard(game, OpponentDifficultyEnum.Aggressive);

    expect(scoreCautious).toBeGreaterThan(0);
    expect(scoreBalanced).toBeGreaterThan(scoreCautious);
    expect(scoreAggressive).toBeGreaterThan(scoreBalanced);
  });

  it('detects checkmate as extreme score', () => {
    const game = new Chess();
    game.move('e4');
    game.move('e5');
    game.move('Bc4');
    game.move('Nc6');
    game.move('Qh5');
    game.move('Nf6');
    game.move('Qxf7#');

    expect(game.in_checkmate()).toBe(true);
    expect(evaluateBoard(game)).toBe(99999);
  });

  it('computes a valid legal AI move for Black across Cautious, Balanced, and Aggressive levels', () => {
    const difficulties = [
      OpponentDifficultyEnum.Cautious,
      OpponentDifficultyEnum.Balanced,
      OpponentDifficultyEnum.Aggressive
    ];

    for (const diff of difficulties) {
      const game = new Chess();
      game.move('e4');
      const aiMove = computeMinimaxMove(game, diff);
      expect(aiMove).not.toBeNull();
      expect(aiMove?.color).toBe('b');

      const result = game.move(aiMove!);
      expect(result).not.toBeNull();
      expect(game.turn()).toBe('w');
    }

    const gameAlias = new Chess();
    gameAlias.move('d4');
    expect(computeBestWizardAIMove(gameAlias)).not.toBeNull();
  });

  it('finds defensive move when in check', () => {
    const game = new Chess();
    game.move('e4');
    game.move('f5');
    game.move('Qh5+');
    expect(game.in_check()).toBe(true);

    const aiMove = computeBestWizardAIMove(game, OpponentDifficultyEnum.Aggressive);
    expect(aiMove).not.toBeNull();
    game.move(aiMove!);
    expect(game.in_check()).toBe(false);
  });
});
