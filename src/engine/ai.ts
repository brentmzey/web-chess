import type { Chess, Move } from 'chess.js';
import { PIECE_VALUES } from '../constants/board';
import {
  OpponentDifficultyEnum,
  PieceColorEnum,
  type OpponentDifficulty,
  type PieceType
} from '../types';
import { match } from '../utils/fp';

/**
 * Evaluates the board position from White's perspective (+ positive for White, - negative for Black)
 * Incorporates material values plus a positional center-control heuristic and difficulty/aggressiveness tuning.
 */
export function evaluateBoard(
  game: Chess,
  difficulty: OpponentDifficulty = OpponentDifficultyEnum.Balanced
): number {
  if (game.in_checkmate()) {
    return game.turn() === PieceColorEnum.White ? -99999 : 99999;
  }
  if (game.in_draw()) {
    return 0;
  }

  const centerWeight = match(difficulty as OpponentDifficultyEnum, {
    [OpponentDifficultyEnum.Cautious]: () => 3,
    [OpponentDifficultyEnum.Balanced]: () => 6,
    [OpponentDifficultyEnum.Aggressive]: () => 9
  });

  const forwardAggressionWeight = match(difficulty as OpponentDifficultyEnum, {
    [OpponentDifficultyEnum.Cautious]: () => 0,
    [OpponentDifficultyEnum.Balanced]: () => 2,
    [OpponentDifficultyEnum.Aggressive]: () => 7
  });

  const board = game.board();
  let score = 0;

  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r]?.[f];
      if (p) {
        const base = PIECE_VALUES[p.type as PieceType] || 0;
        const centerBonus =
          (3.5 - Math.abs(3.5 - f)) * centerWeight +
          (3.5 - Math.abs(3.5 - r)) * centerWeight;
        // r=0 is rank 8 (Black home), r=7 is rank 1 (White home)
        const advanceBonus =
          p.color === PieceColorEnum.White
            ? (7 - r) * forwardAggressionWeight
            : r * forwardAggressionWeight;

        const val = base + centerBonus + advanceBonus;
        score += p.color === PieceColorEnum.White ? val : -val;
      }
    }
  }

  return score;
}

/**
 * Classical Minimax search with difficulty & aggressiveness profiles:
 * - Cautious: 1-ply search with higher exploratory variance (±35 cp) and defensive restraint.
 * - Balanced: 2-ply search with capture-move ordering and standard center control (±12 cp).
 * - Aggressive: 2-ply ruthless search with capture/check/invasion bonuses and minimal noise.
 */
export function computeMinimaxMove(
  game: Chess,
  difficulty: OpponentDifficulty = OpponentDifficultyEnum.Balanced
): Move | null {
  const legalMoves = game.moves({ verbose: true });
  if (legalMoves.length === 0) return null;

  let bestMove: Move = legalMoves[0]!;
  let bestVal = Infinity;

  // Prioritize captures & promotions to optimize search effectiveness
  legalMoves.sort(
    (a: Move, b: Move) =>
      (b.captured ? 12 : 0) + (b.promotion ? 10 : 0) -
      ((a.captured ? 12 : 0) + (a.promotion ? 10 : 0))
  );

  const searchParams = match(difficulty as OpponentDifficultyEnum, {
    [OpponentDifficultyEnum.Cautious]: () => ({
      twoPly: false,
      noiseRange: 35,
      captureAggressionBonus: -5, // Slight caution around reckless trades
      checkAggressionBonus: 0
    }),
    [OpponentDifficultyEnum.Balanced]: () => ({
      twoPly: true,
      noiseRange: 12,
      captureAggressionBonus: 0,
      checkAggressionBonus: 10
    }),
    [OpponentDifficultyEnum.Aggressive]: () => ({
      twoPly: true,
      noiseRange: 2,
      captureAggressionBonus: 45,
      checkAggressionBonus: 35
    })
  });

  for (const move of legalMoves) {
    game.move(move);
    const deliversCheck = game.in_check();

    // Negative adjustment favors Black
    const tacticalBias =
      (move.captured ? -searchParams.captureAggressionBonus : 0) +
      (deliversCheck ? -searchParams.checkAggressionBonus : 0) +
      (move.promotion ? -40 : 0);

    let moveValuation: number;

    if (!searchParams.twoPly) {
      moveValuation =
        evaluateBoard(game, difficulty) +
        tacticalBias +
        (Math.random() - 0.5) * searchParams.noiseRange;
    } else {
      const oppMoves = game.moves({ verbose: true });
      let maxReply = -Infinity;

      if (oppMoves.length === 0) {
        maxReply = evaluateBoard(game, difficulty);
      } else {
        for (const reply of oppMoves) {
          game.move(reply);
          const ev =
            evaluateBoard(game, difficulty) +
            tacticalBias +
            (Math.random() - 0.5) * searchParams.noiseRange;
          if (ev > maxReply) {
            maxReply = ev;
          }
          game.undo();
        }
      }
      moveValuation = maxReply;
    }

    game.undo();

    // Black wants the minimum score (most negative from White's perspective)
    if (moveValuation < bestVal) {
      bestVal = moveValuation;
      bestMove = move;
    }
  }

  return bestMove;
}

/** Backward-compatible alias for existing tests and call sites */
export const computeBestWizardAIMove = computeMinimaxMove;
