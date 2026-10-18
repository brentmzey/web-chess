import {
  GameModeEnum,
  OpponentDifficultyEnum,
  type DifficultyLevelProfile,
  type GameMode,
  type GameModeConfig,
  type OpponentDifficulty,
  type PieceColor,
  type PieceType
} from '../types';
import { fromNullable } from '../utils/fp';

export const SQUARE_SIZE = 2.15;
export const BOARD_OFFSET = (8 * SQUARE_SIZE) / 2 - SQUARE_SIZE / 2; // 7.525

export const PIECE_VALUES: Record<PieceType, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000
};

export const UNICODE_PIECES: Record<PieceColor, Record<PieceType, string>> = {
  w: { p: '♙', n: '♘', b: '♗', r: '♖', q: '♕', k: '♔' },
  b: { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' }
};

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
export const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'] as const;

export const GAME_MODES: readonly GameModeConfig[] = [
  {
    id: GameModeEnum.Minimax,
    label: 'Minimax Engine',
    badge: 'MINIMAX',
    icon: 'memory',
    description: 'Classical algorithmic game-tree search with capture-ordering heuristics'
  },
  {
    id: GameModeEnum.MicroNeural,
    label: 'Micro-Neural AI',
    badge: 'NEURAL AI',
    icon: 'psychology',
    description: 'Embedded 791→32→16→1 multi-layer perceptron position evaluator'
  },
  {
    id: GameModeEnum.GeminiNano,
    label: 'Gemini Nano (Local)',
    badge: 'NANO AI',
    icon: 'auto_awesome',
    description: 'On-device LLM via Desktop Chrome Canary Prompt API (window.ai)',
    desktopOnly: true
  },
  {
    id: GameModeEnum.PassAndPlay,
    label: 'Pass & Play',
    badge: '2P DUEL',
    icon: 'group',
    description: 'Two human players alternating turns on this device'
  }
] as const;

export const DIFFICULTY_PROFILES: readonly DifficultyLevelProfile[] = [
  {
    id: OpponentDifficultyEnum.Cautious,
    label: 'Novice / Cautious',
    badge: 'CAUTIOUS',
    icon: 'shield',
    aggressiveness: 1,
    styleDescriptions: {
      [GameModeEnum.Minimax]: '1-Ply Initiate: Evaluates immediate moves with higher variance (±35 cp) and defensive safety bias.',
      [GameModeEnum.MicroNeural]: 'Initiate Network: Softened neural activation weights with exploratory temperature noise (±28 cp).',
      [GameModeEnum.GeminiNano]: 'Contemplative Monk: Instructs Gemini Nano to prioritize king safety, solid pawn structure, and defensive restraint.',
      [GameModeEnum.PassAndPlay]: 'Human 2-Player Duel: Both White Marble and Black Obsidian are commanded directly by human players.'
    }
  },
  {
    id: OpponentDifficultyEnum.Balanced,
    label: 'Tactician / Balanced',
    badge: 'BALANCED',
    icon: 'balance',
    aggressiveness: 2,
    styleDescriptions: {
      [GameModeEnum.Minimax]: '2-Ply Tactician: Full 2-ply Minimax lookahead balancing material value and Crossing Altar center control.',
      [GameModeEnum.MicroNeural]: 'Sanctuary MLP: Calibrated 791→32→16→1 neural evaluation with balanced piece-square positional tables.',
      [GameModeEnum.GeminiNano]: 'Cathedral Scholar: Instructs Gemini Nano to play principled, balanced positional and tactical chess.',
      [GameModeEnum.PassAndPlay]: 'Human 2-Player Duel: Both White Marble and Black Obsidian are commanded directly by human players.'
    }
  },
  {
    id: OpponentDifficultyEnum.Aggressive,
    label: 'Grand Inquisitor / Ruthless',
    badge: 'RUTHLESS',
    icon: 'local_fire_department',
    aggressiveness: 3,
    styleDescriptions: {
      [GameModeEnum.Minimax]: '2-Ply Warlord: Deterministic 2-ply search with +45 cp capture/check aggression bonus and forward-rank pressure.',
      [GameModeEnum.MicroNeural]: 'Zealot Vanguard: Amplifies neural attack weights, capture/promotion greed, check threats, and enemy territory invasion.',
      [GameModeEnum.GeminiNano]: 'Arcane Warmonger: Commands Gemini Nano to seek relentless attacks, checks, sacrifices, and piece shatters.',
      [GameModeEnum.PassAndPlay]: 'Human 2-Player Duel: Both White Marble and Black Obsidian are commanded directly by human players.'
    }
  }
] as const;

export function getGameModeConfig(mode: GameMode): GameModeConfig {
  return fromNullable(GAME_MODES.find(m => m.id === mode)).getOrElse(GAME_MODES[0]!);
}

export function getDifficultyProfile(difficulty: OpponentDifficulty): DifficultyLevelProfile {
  return fromNullable(DIFFICULTY_PROFILES.find(d => d.id === difficulty)).getOrElse(DIFFICULTY_PROFILES[1]!);
}

export interface MatchSettingsSnapshot {
  mode: GameMode;
  difficulty: OpponentDifficulty;
  allowUndo: boolean;
}

/**
 * Returns true only if any match setting (mode, difficulty, or allowUndo)
 * has changed compared to the snapshot captured when Game Settings was opened.
 */
export function haveMatchSettingsChanged(
  before: MatchSettingsSnapshot,
  after: MatchSettingsSnapshot
): boolean {
  return (
    before.mode !== after.mode ||
    before.difficulty !== after.difficulty ||
    before.allowUndo !== after.allowUndo
  );
}

/**
 * Determines whether applying settings should reset the chess board.
 * If a game is already in progress (`inProgress === true`), the board is NEVER wiped
 * if nothing changed in the match settings (`!haveMatchSettingsChanged(before, after)`),
 * unless the user explicitly requested a forced New Game reset (`forceNewGame === true`).
 */
export function shouldResetBoardOnSettingsApply(
  inProgress: boolean,
  before: MatchSettingsSnapshot,
  after: MatchSettingsSnapshot,
  forceNewGame: boolean = false
): boolean {
  if (forceNewGame) return true;
  if (!inProgress) return true;
  return haveMatchSettingsChanged(before, after);
}

