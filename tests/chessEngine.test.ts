import { describe, expect, it } from 'bun:test';
import { Chess, type Move } from 'chess.js';

describe('Chess Engine Rules and Move State', () => {
  it('correctly validates castling moves', () => {
    const game = new Chess();
    // Clear kingside for white: 1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O
    game.move('e4');
    game.move('e5');
    game.move('Nf3');
    game.move('Nc6');
    game.move('Bc4');
    game.move('Bc5');

    const moves = game.moves({ verbose: true });
    const kingsideCastle = moves.find((m: Move) => m.flags.includes('k'));
    expect(kingsideCastle).toBeDefined();

    const executed = game.move('O-O');
    expect(executed).not.toBeNull();
    expect(executed?.flags.includes('k')).toBe(true);
  });

  it('correctly tracks captured pieces in history', () => {
    const game = new Chess();
    game.move('e4');
    game.move('d5');
    const captureMove = game.move('exd5');
    expect(captureMove?.captured).toBe('p');

    const history = game.history({ verbose: true });
    expect(history.length).toBe(3);
    expect(history[2]?.captured).toBe('p');
  });

  it('handles undo correctly', () => {
    const game = new Chess();
    game.move('e4');
    game.move('e5');
    expect(game.history().length).toBe(2);

    game.undo();
    expect(game.history().length).toBe(1);
    expect(game.turn()).toBe('b');

    game.undo();
    expect(game.history().length).toBe(0);
    expect(game.turn()).toBe('w');
  });

  it('supports pawn promotion correctly', () => {
    // Custom FEN with White pawn on 7th rank ready to promote
    const game = new Chess('8/4P3/8/8/8/8/8/4K2k w - - 0 1');
    const moves = game.moves({ verbose: true });
    const promoMoves = moves.filter((m: Move) => m.flags.includes('p'));
    expect(promoMoves.length).toBe(4); // q, r, b, n

    const executed = game.move({ from: 'e7', to: 'e8', promotion: 'q' });
    expect(executed).not.toBeNull();
    expect(executed?.promotion).toBe('q');
    expect(game.get('e8')?.type).toBe('q');
  });
});
