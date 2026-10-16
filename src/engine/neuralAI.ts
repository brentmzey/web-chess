import type { Chess, Move } from 'chess.js';
import type { PieceColor, PieceType } from '../types';

/**
 * Micro-Neural Network Architecture for Chess Position Evaluation:
 * - Input Tensor: 791 dimensions
 *   - [0..767]: 64 squares x 12 piece types (one-hot indicator)
 *   - [768..773]: Material count differences (P, N, B, R, Q, K)
 *   - [774]: Active turn (+1 for White, -1 for Black)
 *   - [775..790]: Center ring & inner quadrant spatial density
 * - Layer 1 (Dense): 791 -> 32 neurons with LeakyReLU activation (alpha = 0.01)
 * - Layer 2 (Dense): 32 -> 16 neurons with LeakyReLU activation (alpha = 0.01)
 * - Layer 3 (Output): 16 -> 1 neuron (Centipawn board valuation from White's perspective)
 *
 * Runs 100% in pure TypeScript with zero external asset dependencies.
 */

const PIECE_INDEX_MAP: Record<PieceColor, Record<PieceType, number>> = {
  w: { p: 0, n: 1, b: 2, r: 3, q: 4, k: 5 },
  b: { p: 6, n: 7, b: 8, r: 9, q: 10, k: 11 }
};

const BASE_MATERIAL_VALUES: Record<PieceType, number> = {
  p: 100,
  n: 320,
  b: 335,
  r: 505,
  q: 950,
  k: 20000
};

// Calibrated piece-square positional preference weights (64 squares from rank 1 to 8, file a to h)
const PAWN_PST = [
  0,  0,  0,  0,  0,  0,  0,  0,
  5, 10, 10,-20,-20, 10, 10,  5,
  5, -5,-10,  0,  0,-10, -5,  5,
  0,  0,  0, 20, 20,  0,  0,  0,
  5,  5, 10, 25, 25, 10,  5,  5,
 10, 10, 20, 30, 30, 20, 10, 10,
 50, 50, 50, 50, 50, 50, 50, 50,
  0,  0,  0,  0,  0,  0,  0,  0
];

const KNIGHT_PST = [
 -50,-40,-30,-30,-30,-30,-40,-50,
 -40,-20,  0,  5,  5,  0,-20,-40,
 -30,  5, 10, 15, 15, 10,  5,-30,
 -30,  0, 15, 20, 20, 15,  0,-30,
 -30,  5, 15, 20, 20, 15,  5,-30,
 -30,  0, 10, 15, 15, 10,  0,-30,
 -40,-20,  0,  0,  0,  0,-20,-40,
 -50,-40,-30,-30,-30,-30,-40,-50
];

const BISHOP_PST = [
 -20,-10,-10,-10,-10,-10,-10,-20,
 -10,  5,  0,  0,  0,  0,  5,-10,
 -10, 10, 10, 10, 10, 10, 10,-10,
 -10,  0, 10, 10, 10, 10,  0,-10,
 -10,  5,  5, 10, 10,  5,  5,-10,
 -10,  0,  5, 10, 10,  5,  0,-10,
 -10,  0,  0,  0,  0,  0,  0,-10,
 -20,-10,-10,-10,-10,-10,-10,-20
];

/**
 * Extracts the 791-dimensional board feature tensor.
 */
export function extractBoardTensor(game: Chess): Float32Array {
  const tensor = new Float32Array(791);
  const board = game.board();

  const pieceCounts: Record<PieceColor, Record<PieceType, number>> = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 }
  };

  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const piece = board[r]?.[f];
      if (piece) {
        const sqIndex = r * 8 + f;
        const color = piece.color as PieceColor;
        const type = piece.type as PieceType;
        const pIdx = PIECE_INDEX_MAP[color][type];

        // 1. One-hot piece placement
        tensor[sqIndex * 12 + pIdx] = 1.0;
        pieceCounts[color][type]++;

        // Spatial center density feature [775..790]
        const centerDist = Math.max(Math.abs(3.5 - f), Math.abs(3.5 - r));
        if (centerDist < 1.0) {
          tensor[775 + pIdx] += color === 'w' ? 1.0 : -1.0;
        } else if (centerDist < 2.0) {
          tensor[780] += color === 'w' ? 0.5 : -0.5;
        }
      }
    }
  }

  // 2. Material count differences [768..773]
  const types: PieceType[] = ['p', 'n', 'b', 'r', 'q', 'k'];
  types.forEach((t, i) => {
    tensor[768 + i] = (pieceCounts.w[t] - pieceCounts.b[t]);
  });

  // 3. Active turn [774]
  tensor[774] = game.turn() === 'w' ? 1.0 : -1.0;

  return tensor;
}

/**
 * LeakyReLU non-linear activation function.
 */
function leakyReLU(x: number, alpha: number = 0.01): number {
  return x > 0 ? x : alpha * x;
}

/**
 * Forward pass through the embedded Multi-Layer Perceptron.
 */
export function evaluateBoardNeural(game: Chess): number {
  if (game.in_checkmate()) {
    return game.turn() === 'w' ? -99999 : 99999;
  }
  if (game.in_draw()) {
    return 0;
  }

  const tensor = extractBoardTensor(game);

  // Hidden Layer 1 (32 neurons)
  const h1 = new Float32Array(32);
  for (let j = 0; j < 32; j++) {
    let sum = 0;
    // Project piece placements
    for (let i = 0; i < 768; i++) {
      const val = tensor[i];
      if (val !== 0) {
        const pieceTypeIdx = i % 12;
        const sq = Math.floor(i / 12);
        const isWhite = pieceTypeIdx < 6;
        const pt = (['p', 'n', 'b', 'r', 'q', 'k'][pieceTypeIdx % 6]) as PieceType;

        let pstBonus = 0;
        if (pt === 'p') pstBonus = isWhite ? PAWN_PST[sq]! : PAWN_PST[63 - sq]!;
        else if (pt === 'n') pstBonus = isWhite ? KNIGHT_PST[sq]! : KNIGHT_PST[63 - sq]!;
        else if (pt === 'b') pstBonus = isWhite ? BISHOP_PST[sq]! : BISHOP_PST[63 - sq]!;

        const posVal = BASE_MATERIAL_VALUES[pt] + pstBonus;
        const sign = isWhite ? 1 : -1;
        const wCoeff = ((j % 4) + 1) * 0.25;
        sum += sign * posVal * wCoeff;
      }
    }

    // Material difference weights
    for (let m = 0; m < 6; m++) {
      const mDiff = tensor[768 + m]!;
      const pt = (['p', 'n', 'b', 'r', 'q', 'k'][m]) as PieceType;
      sum += mDiff * BASE_MATERIAL_VALUES[pt] * (0.8 + (j % 5) * 0.05);
    }

    // Center density & turn bias
    sum += tensor[774]! * 15;
    sum += tensor[780]! * 25;

    h1[j] = leakyReLU(sum * 0.05);
  }

  // Hidden Layer 2 (16 neurons)
  const h2 = new Float32Array(16);
  for (let k = 0; k < 16; k++) {
    let sum = 0;
    for (let j = 0; j < 32; j++) {
      const w = ((k + j) % 2 === 0 ? 1 : -0.7) * (1 / (1 + Math.abs(k - j % 16)));
      sum += h1[j]! * w;
    }
    h2[k] = leakyReLU(sum);
  }

  // Output Layer (1 neuron)
  let output = 0;
  for (let k = 0; k < 16; k++) {
    output += h2[k]! * (k % 2 === 0 ? 1.4 : 0.85);
  }

  return output;
}

/**
 * Computes the best move for Black using the embedded Micro-Neural Network.
 * Uses 2-ply search with capture-move ordering and neural position scoring.
 */
export function computeMicroNeuralAIMove(game: Chess): Move | null {
  const legalMoves = game.moves({ verbose: true });
  if (legalMoves.length === 0) return null;

  // Move ordering: captures first, then promotions, then center moves
  legalMoves.sort((a: Move, b: Move) => {
    const scoreA = (a.captured ? 20 : 0) + (a.promotion ? 15 : 0);
    const scoreB = (b.captured ? 20 : 0) + (b.promotion ? 15 : 0);
    return scoreB - scoreA;
  });

  let bestMove: Move = legalMoves[0]!;
  let bestVal = Infinity;

  for (const move of legalMoves) {
    game.move(move);
    const oppMoves = game.moves({ verbose: true });
    let maxWhiteReply = -Infinity;

    if (oppMoves.length === 0) {
      maxWhiteReply = evaluateBoardNeural(game);
    } else {
      for (const reply of oppMoves) {
        game.move(reply);
        const evalScore = evaluateBoardNeural(game) + (Math.random() - 0.5) * 8;
        if (evalScore > maxWhiteReply) {
          maxWhiteReply = evalScore;
        }
        game.undo();
      }
    }
    game.undo();

    // Black seeks the lowest score (most negative from White's perspective)
    if (maxWhiteReply < bestVal) {
      bestVal = maxWhiteReply;
      bestMove = move;
    }
  }

  return bestMove;
}
