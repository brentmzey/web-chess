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
  GeminiNano = 'gemini-nano',
  Live = 'live'
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

export enum SettingsApplyActionEnum {
  KeepActiveGame = 'keep_active_game',
  ApplyAndReset = 'apply_and_reset',
  StartNewGame = 'start_new_game'
}

export enum ChessThemeEnum {
  GothicBasilica = 'gothic-basilica',
  EmeraldCitadel = 'emerald-citadel',
  AstralObservatory = 'astral-observatory',
  CrimsonInquisition = 'crimson-inquisition'
}

export type GameMode = GameModeEnum | 'pass-and-play' | 'minimax' | 'micro-neural' | 'gemini-nano' | 'live';

export type OpponentDifficulty = OpponentDifficultyEnum | 'cautious' | 'balanced' | 'aggressive';

export type ChessTheme =
  | ChessThemeEnum
  | 'gothic-basilica'
  | 'emerald-citadel'
  | 'astral-observatory'
  | 'crimson-inquisition';

export interface ThemeConfig {
  id: ChessThemeEnum;
  label: string;
  badge: string;
  icon: string;
  description: string;
  whitePieceColor: number;
  blackPieceColor: number;
  goldAccentColor: number;
  goldAccentEmissive: number;
  arcaneAccentColor: number;
  arcaneAccentEmissive: number;
  flameColor: number;
  darkStoneColor: number;
  trimStoneColor: number;
  crimsonCarpetColor: number;
  lightSquareColor: number;
  lightSquareEmissive: number;
  darkSquareColor: number;
  sceneBackground: number;
  sceneFog: number;
  hemiSkyColor: number;
  hemiGroundColor: number;
  altarLightColor: number;
  strikeFlashColor: number;
}

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

export interface StoredLiveSessionInfo {
  sessionCode: string;
  sessionId: string;
  participantId: string;
  token: string;
  role: 'white' | 'black' | 'spectator';
  playerName?: string;
  doNotDelete?: boolean;
}

export interface StoredSessionState {
  id: string;
  enabled: boolean;
  fen: string;
  history: string[];
  mode: GameMode;
  difficulty: OpponentDifficulty;
  allowUndo: boolean;
  theme?: ChessTheme;
  contrast: number;
  brightness: number;
  deviceTier: DeviceTierEnum;
  timestamp: number;
  gameStarted?: boolean;
  useActionCam?: boolean;
  liveSession?: StoredLiveSessionInfo;
}


/**
 * Exhaustive sum type describing what happened when we tried to restore a saved session.
 * Consumed with `match(outcome.status, { ... })` so every case must be handled.
 */
export enum StorageLoadStatusEnum {
  Restored = 'restored',
  Empty = 'empty',
  Unreadable = 'unreadable',
  Unavailable = 'unavailable'
}

export interface StorageLoadOutcome {
  status: StorageLoadStatusEnum;
  session?: StoredSessionState;
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

export interface EncryptedStorageAuditReport {
  database: string;
  objectStore: string;
  algorithm: 'AES-GCM-256';
  keyLengthBits: 256;
  ivLengthBytes: 12;
  authTagBits: 128;
  cipherMode: 'Galois/Counter Mode (AEAD, 128-bit Auth Tag)';
  keyManagement: 'Web Crypto CSPRNG Non-Extractable CryptoKey (extractable: false)';
  keyExtractable: false;
  hardcodedBundleKey: false;
  aadContextBound: true;
  localStorageUsed: false;
  plaintextExposed: false;
  auditedAt: string;
  recordCount: number;
  records: EncryptedStorageRecord[];
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

export * from '../constants/gameEnums';
export * from './config';



