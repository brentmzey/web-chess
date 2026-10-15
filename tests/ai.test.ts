import { describe, expect, it } from 'bun:test';
import { Chess } from 'chess.js';
import { computeBestWizardAIMove, evaluateBoard } from '../src/engine/ai';

describe('Wizard AI and Board Evaluation', () => {
  it('evaluates starting board position as symmetrical / near 0', () => {
    const game = new Chess();
    const score = evaluateBoard(game);
    expect(score).toBe(0);
  });

  it('rewards center control and developed pieces', () => {
    const game = new Chess();
    // 1. e4
    game.move('e4');
    const scoreWhiteAhead = evaluateBoard(game);
    expect(scoreWhiteAhead).toBeGreaterThan(0);
  });

  it('detects checkmate as extreme score', () => {
    const game = new Chess();
    // Scholar's mate: 1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7#
    game.move('e4');
    game.move('e5');
    game.move('Bc4');
    game.move('Nc6');
    game.move('Qh5');
    game.move('Nf6');
    game.move('Qxf7#');

    expect(game.in_checkmate()).toBe(true);
    // Black is in checkmate, turn is 'b', score should be 99999 for White
    expect(evaluateBoard(game)).toBe(99999);
  });

  it('computes a valid legal AI move for Black', () => {
    const game = new Chess();
    game.move('e4');
    const aiMove = computeBestWizardAIMove(game);
    expect(aiMove).not.toBeNull();
    expect(aiMove?.color).toBe('b');

    // Ensure the move is legally executable
    const result = game.move(aiMove!);
    expect(result).not.toBeNull();
    expect(game.turn()).toBe('w');
  });

  it('finds defensive move when in check', () => {
    const game = new Chess();
    // 1. e4 f5 2. Qh5+
    game.move('e4');
    game.move('f5');
    game.move('Qh5+');
    expect(game.in_check()).toBe(true);

    const aiMove = computeBestWizardAIMove(game);
    expect(aiMove).not.toBeNull();
    // Black must block or escape (e.g. g6)
    game.move(aiMove!);
    expect(game.in_check()).toBe(false);
  });
});
