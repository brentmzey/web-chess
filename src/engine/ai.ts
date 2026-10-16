import type { Chess, Move } from 'chess.js';
import { PIECE_VALUES } from '../constants/board';
import type { PieceType } from '../types';

/**
 * Evaluates the board position from White's perspective (+ positive for White, - negative for Black)
 * Incorporates material values plus a positional center-control heuristic.
 */
export function evaluateBoard(game: Chess): number {
  if (game.in_checkmate()) {
    return game.turn() === 'w' ? -99999 : 99999;
  }
  if (game.in_draw()) {
    return 0;
  }

  const board = game.board();
  let score = 0;

  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r]?.[f];
      if (p) {
        const base = PIECE_VALUES[p.type as PieceType] || 0;
        const centerBonus = (3.5 - Math.abs(3.5 - f)) * 6 + (3.5 - Math.abs(3.5 - r)) * 6;
        const val = base + centerBonus;
        score += p.color === 'w' ? val : -val;
      }
    }
  }

  return score;
}

/**
 * Minimax 2-ply search with capture-move ordering for the Wizard AI (Black Obsidian)
 */
export function computeBestWizardAIMove(game: Chess): Move | null {
  const legalMoves = game.moves({ verbose: true });
  if (legalMoves.length === 0) return null;

  let bestMove: Move = legalMoves[0]!;
  let bestVal = Infinity;

  // Prioritize captures to optimize alpha-beta search effectiveness
  legalMoves.sort((a: Move, b: Move) => (b.captured ? 10 : 0) - (a.captured ? 10 : 0));

  for (const move of legalMoves) {
    game.move(move);
    const oppMoves = game.moves({ verbose: true });
    let maxReply = -Infinity;

    if (oppMoves.length === 0) {
      maxReply = evaluateBoard(game);
    } else {
      for (const reply of oppMoves) {
        game.move(reply);
        const ev = evaluateBoard(game) + (Math.random() - 0.5) * 12;
        if (ev > maxReply) {
          maxReply = ev;
        }
        game.undo();
      }
    }
    game.undo();

    // Black wants the minimum score (most negative from White's perspective)
    if (maxReply < bestVal) {
      bestVal = maxReply;
      bestMove = move;
    }
  }

  return bestMove;
}
