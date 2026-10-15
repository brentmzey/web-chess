import * as THREE from 'three';
import { BOARD_OFFSET, SQUARE_SIZE } from '../constants/board';

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
