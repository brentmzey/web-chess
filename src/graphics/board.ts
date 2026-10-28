import * as THREE from 'three';
import { BOARD_OFFSET, FILES, RANKS, SQUARE_SIZE } from '../constants/board';
import { indicesToSquare, squareToWorld } from '../engine/coordinates';
import type { SquareTileMesh } from '../types';
import type { AppMaterials } from './materials';
import { createBoardTileTexture, createCoordinateTexture } from './textures';

export interface BoardElements {
  boardGroup: THREE.Group;
  squareMeshes: Record<string, SquareTileMesh>;
  highlightGroup: THREE.Group;
}

export function buildChessboardGrid(scene: THREE.Scene, materials: AppMaterials): BoardElements {
  const boardGroup = new THREE.Group();
  scene.add(boardGroup);

  const highlightGroup = new THREE.Group();
  scene.add(highlightGroup);

  const squareMeshes: Record<string, SquareTileMesh> = {};

  const lightTileTex = createBoardTileTexture(true);
  const darkTileTex = createBoardTileTexture(false);

  const lightSquareMat = new THREE.MeshStandardMaterial({
    color: 0xEAE4D7,
    map: lightTileTex,
    roughness: 0.24,
    metalness: 0.05,
    emissive: 0x1a1712,
    emissiveIntensity: 0.12
  });

  const darkSquareMat = new THREE.MeshStandardMaterial({
    color: 0x181A22,
    map: darkTileTex,
    roughness: 0.14,
    metalness: 0.38
  });

  const tileGeo = new THREE.BoxGeometry(SQUARE_SIZE * 0.955, 0.16, SQUARE_SIZE * 0.955);

  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const isLight = (r + f) % 2 === 0;
      const sqName = indicesToSquare(f, r);
      const tileMat = isLight ? lightSquareMat.clone() : darkSquareMat.clone();
      tileMat.userData = { defaultEmissive: isLight ? 0x1a1712 : 0x000000 };
      const tileMesh = new THREE.Mesh(tileGeo, tileMat) as unknown as SquareTileMesh;
      const pos = squareToWorld(sqName);
      tileMesh.position.set(pos.x, -0.08, pos.z);
      tileMesh.receiveShadow = true;
      tileMesh.userData = { square: sqName, isLight, defaultEmissive: isLight ? 0x1a1712 : 0x000000 };
      boardGroup.add(tileMesh);
      squareMeshes[sqName] = tileMesh;
    }
  }

  // Inlaid Gilded Brass Divider Strips between Ranks & Files
  const boardSpan = 8 * SQUARE_SIZE;
  const stripThickness = 0.045;
  const stripHeight = 0.156;
  const stripGeoX = new THREE.BoxGeometry(boardSpan + stripThickness, stripHeight, stripThickness);
  const stripGeoZ = new THREE.BoxGeometry(stripThickness, stripHeight, boardSpan + stripThickness);

  for (let i = 0; i <= 8; i++) {
    const offset = (i - 4) * SQUARE_SIZE;

    const rankStrip = new THREE.Mesh(stripGeoX, materials.goldAccentMaterial);
    rankStrip.position.set(0, -0.08, offset);
    rankStrip.receiveShadow = true;
    boardGroup.add(rankStrip);

    const fileStrip = new THREE.Mesh(stripGeoZ, materials.goldAccentMaterial);
    fileStrip.position.set(offset, -0.08, 0);
    fileStrip.receiveShadow = true;
    boardGroup.add(fileStrip);
  }

  // Raised Stone & Brass Border Molding Framing the 64 Squares
  const borderThickness = 1.05;
  const outerSpan = boardSpan + borderThickness * 2;
  const borderMat = new THREE.MeshStandardMaterial({
    color: 0x262230,
    roughness: 0.45,
    metalness: 0.25
  });

  [-1, 1].forEach(sign => {
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(outerSpan, 0.18, borderThickness),
      borderMat
    );
    beam.position.set(0, -0.08, sign * (boardSpan / 2 + borderThickness / 2));
    beam.receiveShadow = true;
    boardGroup.add(beam);
  });

  [-1, 1].forEach(sign => {
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(borderThickness, 0.18, boardSpan),
      borderMat
    );
    beam.position.set(sign * (boardSpan / 2 + borderThickness / 2), -0.08, 0);
    beam.receiveShadow = true;
    boardGroup.add(beam);
  });

  // Golden Algebraic Coordinates along all Four Outer Stone Borders
  const coordOffset = boardSpan / 2 + borderThickness * 0.5;

  FILES.forEach((letter, fIdx) => {
    const tex = createCoordinateTexture(letter.toUpperCase());
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
    const xPos = fIdx * SQUARE_SIZE - BOARD_OFFSET;

    // South Border (White Side)
    const labelS = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.68), mat);
    labelS.rotation.x = -Math.PI / 2;
    labelS.position.set(xPos, 0.02, coordOffset);
    boardGroup.add(labelS);

    // North Border (Black Side)
    const labelN = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.68), mat);
    labelN.rotation.x = -Math.PI / 2;
    labelN.rotation.z = Math.PI;
    labelN.position.set(xPos, 0.02, -coordOffset);
    boardGroup.add(labelN);
  });

  RANKS.forEach((num, rIdx) => {
    const tex = createCoordinateTexture(num);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
    const zPos = rIdx * SQUARE_SIZE - BOARD_OFFSET;

    // West Border
    const labelW = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.68), mat);
    labelW.rotation.x = -Math.PI / 2;
    labelW.position.set(-coordOffset, 0.02, zPos);
    boardGroup.add(labelW);

    // East Border
    const labelE = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.68), mat);
    labelE.rotation.x = -Math.PI / 2;
    labelE.position.set(coordOffset, 0.02, zPos);
    boardGroup.add(labelE);
  });

  return {
    boardGroup,
    squareMeshes,
    highlightGroup
  };
}

const SHARED_SELECT_RING_GEO = new THREE.RingGeometry(0.68, 0.88, 32);
const SHARED_SELECT_RING_MAT = new THREE.MeshBasicMaterial({
  color: 0xfacc15,
  side: THREE.DoubleSide
});
const SHARED_CAPTURE_RING_GEO = new THREE.RingGeometry(0.66, 0.92, 28);
const SHARED_CAPTURE_RING_MAT = new THREE.MeshBasicMaterial({
  color: 0xef4444,
  side: THREE.DoubleSide
});
const SHARED_MOVE_DOT_GEO = new THREE.CircleGeometry(0.32, 24);
const SHARED_MOVE_DOT_MAT = new THREE.MeshBasicMaterial({
  color: 0x38bdf8,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.85
});

/**
 * Updates selected square rings, legal move target dots, capture rings, and check indicator highlights
 */
export function updateBoardHighlights(highlightGroup: THREE.Group,
                                      squareMeshes: Record<string, SquareTileMesh>,
                                      selectedSquare: string | null,
                                      legalMoves: Array<{ to: string; flags: string }>,
                                      inCheck: boolean,
                                      turnColor: 'w' | 'b',
                                      pieceMap: Record<string, THREE.Group>): void {
  while (highlightGroup.children.length > 0) {
    const child = highlightGroup.children[0]!;
    highlightGroup.remove(child);
  }

  // Restore square default emissive
  Object.values(squareMeshes).forEach(tile => {
    const mat = tile.material as THREE.MeshStandardMaterial;
    const defEmissive = tile.userData?.defaultEmissive ?? 0x000000;
    mat.emissive.setHex(defEmissive);
  });

  // Highlight King in check in crimson
  if (inCheck) {
    Object.keys(pieceMap).forEach(sq => {
      const p = pieceMap[sq];
      if (p && p.userData?.type === 'k' && p.userData?.color === turnColor) {
        const tile = squareMeshes[sq];
        if (tile) {
          (tile.material as THREE.MeshStandardMaterial).emissive.setHex(0x991b1b);
        }
      }
    });
  }

  if (!selectedSquare) return;

  // Selected square gold ring
  const selPos = squareToWorld(selectedSquare);
  const selRing = new THREE.Mesh(SHARED_SELECT_RING_GEO, SHARED_SELECT_RING_MAT);
  selRing.rotation.x = -Math.PI / 2;
  selRing.position.set(selPos.x, 0.03, selPos.z);
  highlightGroup.add(selRing);

  // Legal moves highlights
  legalMoves.forEach(move => {
    const targetPos = squareToWorld(move.to);
    const isCapture = move.flags.includes('c') || move.flags.includes('e');

    if (isCapture) {
      const capRing = new THREE.Mesh(SHARED_CAPTURE_RING_GEO, SHARED_CAPTURE_RING_MAT);
      capRing.rotation.x = -Math.PI / 2;
      capRing.position.set(targetPos.x, 0.035, targetPos.z);
      highlightGroup.add(capRing);

      const targetTile = squareMeshes[move.to];
      if (targetTile) {
        (targetTile.material as THREE.MeshStandardMaterial).emissive.setHex(0x450a0a);
      }
    } else {
      const dot = new THREE.Mesh(SHARED_MOVE_DOT_GEO, SHARED_MOVE_DOT_MAT);
      dot.rotation.x = -Math.PI / 2;
      dot.position.set(targetPos.x, 0.03, targetPos.z);
      highlightGroup.add(dot);
    }
  });
}
