import { describe, expect, it } from 'bun:test';
import { Chess } from 'chess.js';
import { extractBoardTensor, evaluateBoardNeural, computeMicroNeuralAIMove } from '../src/engine/neuralAI';

describe('Embedded Micro-Neural Network Engine', () => {
  it('extracts a 791-dimensional float32 tensor from board position', () => {
    const game = new Chess();
    const tensor = extractBoardTensor(game);
    expect(tensor.length).toBe(791);
    expect(tensor instanceof Float32Array).toBe(true);

    // Initial board has turn = 'w' (encoded as 1.0 at index 774)
    expect(tensor[774]).toBe(1.0);
    // Initial material differences should all be 0
    for (let m = 0; m < 6; m++) {
      expect(tensor[768 + m]).toBe(0);
    }
  });

  it('evaluates starting position near 0 and detects checkmate', () => {
    const game = new Chess();
    const startScore = evaluateBoardNeural(game);
    // Should be close to symmetrical
    expect(Math.abs(startScore)).toBeLessThan(100);

    // Fool's mate: 1. f3 e5 2. g4 Qh4#
    game.move('f3');
    game.move('e5');
    game.move('g4');
    game.move('Qh4#');
    expect(game.in_checkmate()).toBe(true);
    // White is checkmated -> extreme negative score
    expect(evaluateBoardNeural(game)).toBe(-99999);
  });

  it('computes a legal move for Black using neural evaluation', () => {
    const game = new Chess();
    game.move('d4');
    const move = computeMicroNeuralAIMove(game);
    expect(move).not.toBeNull();
    expect(move?.color).toBe('b');

    // Executing move should succeed
    const res = game.move(move!);
    expect(res).not.toBeNull();
    expect(game.turn()).toBe('w');
  });

  it('finds an escape or block when Black is in check', () => {
    const game = new Chess();
    // 1. e4 f6 2. Qh5+
    game.move('e4');
    game.move('f6');
    game.move('Qh5+');
    expect(game.in_check()).toBe(true);

    const move = computeMicroNeuralAIMove(game);
    expect(move).not.toBeNull();
    game.move(move!);
    expect(game.in_check()).toBe(false);
  });
});
