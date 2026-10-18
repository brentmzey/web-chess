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

export enum GameModeEnum {
  PassAndPlay = 'pass-and-play',
  Minimax = 'minimax',
  MicroNeural = 'micro-neural',
  GeminiNano = 'gemini-nano'
}

export enum OpponentDifficultyEnum {
  Cautious = 'cautious',
  Balanced = 'balanced',
  Aggressive = 'aggressive'
}

export enum PieceColorEnum {
  White = 'w',
  Black = 'b'
}

export enum PieceTypeEnum {
  Pawn = 'p',
  Knight = 'n',
  Bishop = 'b',
  Rook = 'r',
  Queen = 'q',
  King = 'k'
}

export enum DeviceTierEnum {
  Desktop = 'desktop',
  MobileLite = 'mobile-lite'
}

export enum ExecutionSideEnum {
  ClientSide = 'CLIENT_SIDE',
  ServerSide = 'SERVER_SIDE'
}

export type GameMode = GameModeEnum | 'pass-and-play' | 'minimax' | 'micro-neural' | 'gemini-nano';
export type OpponentDifficulty = OpponentDifficultyEnum | 'cautious' | 'balanced' | 'aggressive';

export interface DifficultyLevelProfile {
  id: OpponentDifficultyEnum;
  label: string;
  badge: string;
  icon: string;
  aggressiveness: number; // 1 to 3 scale
  styleDescriptions: Record<GameModeEnum, string>;
}

export interface GameModeConfig {
  id: GameModeEnum;
  label: string;
  badge: string;
  icon: string;
  description: string;
  desktopOnly?: boolean;
}

export interface StoredSessionState {
  id: string;
  enabled: boolean;
  fen: string;
  history: string[];
  mode: GameMode;
  difficulty: OpponentDifficulty;
  allowUndo: boolean;
  contrast: number;
  brightness: number;
  deviceTier: DeviceTierEnum;
  timestamp: number;
}

export interface EncryptedEnvelope {
  v: 1;
  alg: 'AES-GCM-256';
  iv: string;
  ciphertext: string;
}

export interface EncryptedStorageRecord {
  id: string;
  envelope: EncryptedEnvelope;
  updatedAt: number;
}

export interface DeviceProfileConfig {
  tier: DeviceTierEnum;
  shadowMapSize: number;
  shardCount: number;
  shardShadows: boolean;
  dustCount: number;
  maxPixelRatio: number;
  antialias: boolean;
  label: string;
  badge: string;
  notice: string;
}

