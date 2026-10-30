import * as THREE from 'three';
import { BOARD_OFFSET, SQUARE_SIZE } from '../constants/board';
import { none, some, type Option } from '../utils/fp';

/**
 * Converts standard chess algebraic square notation (e.g. 'e4', 'a1') to Three.js world coordinates
 */
export function squareToWorld(sq: string): THREE.Vector3 {
  if (!sq || sq.length < 2) {
    return new THREE.Vector3(0, 0, 0);
  }
  const file = sq.charCodeAt(0) - 97; // 'a' -> 0, 'h' -> 7
  const rank = 8 - parseInt(sq[1], 10); // '8' -> 0, '1' -> 7
  return new THREE.Vector3(
    file * SQUARE_SIZE - BOARD_OFFSET,
    0,
    rank * SQUARE_SIZE - BOARD_OFFSET
  );
}

/**
 * Converts 0-indexed file (0=a..7=h) and rank (0=rank 8..7=rank 1) to algebraic notation
 */
export function indicesToSquare(fileIdx: number, rankIdx: number): string {
  return String.fromCharCode(97 + fileIdx) + (8 - rankIdx);
}

/**
 * Converts a Three.js world (x, z) point on the board plane (y = 0) into an Option<string> square ('a1'..'h8').
 */
export function worldToSquare(x: number, z: number): Option<string> {
  const fileIdx = Math.floor((x + BOARD_OFFSET + SQUARE_SIZE * 0.5) / SQUARE_SIZE);
  const rankIdx = Math.floor((z + BOARD_OFFSET + SQUARE_SIZE * 0.5) / SQUARE_SIZE);
  if (fileIdx >= 0 && fileIdx < 8 && rankIdx >= 0 && rankIdx < 8) {
    return some(indicesToSquare(fileIdx, rankIdx));
  }
  return none();
}

/**
 * Half-move count after the position in `fen` (1 after 1. e4, 2 after 1...e5). Derived from the FEN's
 * fullmove number and side to move, so it stays correct after a mid-game `chess.load(fen)`, which
 * clears the local move history.
 */
export function plyFromFen(fen: string): number {
  const [, sideToMove = 'w', , , , fullmove = '1'] = fen.trim().split(/\s+/);
  const fullmoveNumber = Math.max(1, parseInt(fullmove, 10) || 1);
  return (fullmoveNumber - 1) * 2 + (sideToMove === 'b' ? 1 : 0);
}

