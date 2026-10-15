import { describe, expect, it } from 'bun:test';
import { indicesToSquare, squareToWorld } from '../src/engine/coordinates';
import { BOARD_OFFSET, SQUARE_SIZE } from '../src/constants/board';

describe('Coordinate transformations', () => {
  it('correctly maps indices to algebraic square', () => {
    expect(indicesToSquare(0, 0)).toBe('a8');
    expect(indicesToSquare(4, 4)).toBe('e4');
    expect(indicesToSquare(7, 7)).toBe('h1');
    expect(indicesToSquare(3, 7)).toBe('d1');
    expect(indicesToSquare(4, 0)).toBe('e8');
  });

  it('correctly maps algebraic square to 3D world coordinates', () => {
    // a8: file 0, rank 0
    const a8World = squareToWorld('a8');
    expect(a8World.x).toBeCloseTo(-BOARD_OFFSET, 3);
    expect(a8World.y).toBe(0);
    expect(a8World.z).toBeCloseTo(-BOARD_OFFSET, 3);

    // h1: file 7, rank 7
    const h1World = squareToWorld('h1');
    expect(h1World.x).toBeCloseTo(7 * SQUARE_SIZE - BOARD_OFFSET, 3);
    expect(h1World.z).toBeCloseTo(7 * SQUARE_SIZE - BOARD_OFFSET, 3);

    // Center squares (e4 / d4) symmetry
    const e4 = squareToWorld('e4'); // file 4, rank 4
    const d5 = squareToWorld('d5'); // file 3, rank 3
    expect(e4.x).toBeCloseTo(-d5.x, 3);
    expect(e4.z).toBeCloseTo(-d5.z, 3);
  });

  it('safely handles empty or invalid square input', () => {
    const fallback = squareToWorld('');
    expect(fallback.x).toBe(0);
    expect(fallback.y).toBe(0);
    expect(fallback.z).toBe(0);
  });
});
