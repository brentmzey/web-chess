import { describe, expect, it } from 'bun:test';
import { Chess } from 'chess.js';
import {
  computeMicroNeuralAIMove,
  evaluateBoardNeural,
  extractBoardTensor
} from '../src/engine/neuralAI';
import { OpponentDifficultyEnum } from '../src/types';

describe('Embedded Micro-Neural Network Engine with Difficulty Levels', () => {
  it('extracts a 791-dimensional float32 tensor from board position', () => {
    const game = new Chess();
    const tensor = extractBoardTensor(game);
    expect(tensor.length).toBe(791);
    expect(tensor instanceof Float32Array).toBe(true);

    expect(tensor[774]).toBe(1.0);
    for (let m = 0; m < 6; m++) {
      expect(tensor[768 + m]).toBe(0);
    }
  });

  it('evaluates starting position near 0 and detects checkmate', () => {
    const game = new Chess();
    const startScore = evaluateBoardNeural(game, OpponentDifficultyEnum.Balanced);
    expect(Math.abs(startScore)).toBeLessThan(100);

    game.move('f3');
    game.move('e5');
    game.move('g4');
    game.move('Qh4#');
    expect(game.in_checkmate()).toBe(true);
    expect(evaluateBoardNeural(game)).toBe(-99999);
  });

  it('computes a legal move for Black across Cautious, Balanced, and Aggressive difficulty profiles', () => {
    const diffs = [
      OpponentDifficultyEnum.Cautious,
      OpponentDifficultyEnum.Balanced,
      OpponentDifficultyEnum.Aggressive
    ];

    for (const diff of diffs) {
      const game = new Chess();
      game.move('d4');
      const move = computeMicroNeuralAIMove(game, diff);
      expect(move).not.toBeNull();
      expect(move?.color).toBe('b');

      const res = game.move(move!);
      expect(res).not.toBeNull();
      expect(game.turn()).toBe('w');
    }
  });

  it('finds an escape or block when Black is in check', () => {
    const game = new Chess();
    game.move('e4');
    game.move('f6');
    game.move('Qh5+');
    expect(game.in_check()).toBe(true);

    const move = computeMicroNeuralAIMove(game, OpponentDifficultyEnum.Aggressive);
    expect(move).not.toBeNull();
    game.move(move!);
    expect(game.in_check()).toBe(false);
  });
});
