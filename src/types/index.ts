import type * as THREE from 'three';

export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type PieceColor = 'w' | 'b';

export interface PieceUserData {
  type: PieceType;
  color: PieceColor;
  square?: string;
  baseRotY: number;
  bodyGroup?: THREE.Group;
  weaponGroup?: THREE.Group;
  idlePhase: number;
}

export interface PieceMeshGroup extends THREE.Group {
  userData: PieceUserData;
}

export interface SquareTileMesh extends THREE.Mesh {
  userData: {
    square: string;
    isLight: boolean;
    defaultEmissive?: number;
  };
}

export interface ShardParticle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  rotVel: THREE.Vector3;
  life: number;
}

export interface ShockwaveRing {
  mesh: THREE.Mesh;
  scale: number;
  opacity: number;
}

export interface ThuribleData {
  group: THREE.Group;
  speed: number;
  phase: number;
  ampX: number;
  ampZ: number;
}

export interface CandleFlameData {
  mesh: THREE.Mesh;
  baseY: number;
  phase: number;
}

export interface CameraPreset {
  name: string;
  theta: number;
  phi: number;
  radius: number;
  target: THREE.Vector3;
}

export interface CameraState {
  theta: number;
  phi: number;
  radius: number;
  target: THREE.Vector3;
}

export interface SavedCamState {
  target: THREE.Vector3;
  radius: number;
  phi: number;
}
