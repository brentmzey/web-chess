import {
  ChessThemeEnum,
  GameModeEnum,
  OpponentDifficultyEnum,
  SettingsApplyActionEnum,
  type ChessTheme,
  type DifficultyLevelProfile,
  type GameMode,
  type GameModeConfig,
  type OpponentDifficulty,
  type PieceColor,
  type PieceType,
  type ThemeConfig
} from '../types';
import { fromNullable, match, matchBool } from '../utils/fp';

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
  },
  {
    id: GameModeEnum.Live,
    label: 'Live Multiplayer',
    badge: 'LIVE SSE',
    icon: 'sensors',
    description: 'Real-time peer match via Server-Sent Events with cryptographically secure sessions'
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
      [GameModeEnum.PassAndPlay]: 'Human 2-Player Duel: Both White Marble and Black Obsidian are commanded directly by human players.',
      [GameModeEnum.Live]: 'Real-Time Multiplayer: Live peer matched via Server-Sent Events with cryptographically secure session tokens.'
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
      [GameModeEnum.PassAndPlay]: 'Human 2-Player Duel: Both White Marble and Black Obsidian are commanded directly by human players.',
      [GameModeEnum.Live]: 'Real-Time Multiplayer: Live peer matched via Server-Sent Events with cryptographically secure session tokens.'
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
      [GameModeEnum.PassAndPlay]: 'Human 2-Player Duel: Both White Marble and Black Obsidian are commanded directly by human players.',
      [GameModeEnum.Live]: 'Real-Time Multiplayer: Live peer matched via Server-Sent Events with cryptographically secure session tokens.'
    }
  }
] as const;

export const CHESS_THEMES: readonly ThemeConfig[] = [
  {
    id: ChessThemeEnum.GothicBasilica,
    label: 'High Gothic Basilica',
    badge: 'BASILICA',
    icon: 'church',
    description:
      'Carrara marble & volcanic obsidian with gilded brass and amethyst runes under stained glass.',
    whitePieceColor: 0xf7f4ee,
    blackPieceColor: 0x1c1726,
    goldAccentColor: 0xe5c158,
    goldAccentEmissive: 0x3b2a08,
    arcaneAccentColor: 0xa855f7,
    arcaneAccentEmissive: 0x6b21a8,
    flameColor: 0xffd54f,
    darkStoneColor: 0x221f29,
    trimStoneColor: 0x353040,
    crimsonCarpetColor: 0x69141e,
    lightSquareColor: 0xeae4d7,
    lightSquareEmissive: 0x1a1712,
    darkSquareColor: 0x181a22,
    sceneBackground: 0x09070e,
    sceneFog: 0x0b0914,
    hemiSkyColor: 0xd8c8ff,
    hemiGroundColor: 0x261d16,
    altarLightColor: 0xffb74d,
    strikeFlashColor: 0xfef08a
  },
  {
    id: ChessThemeEnum.EmeraldCitadel,
    label: 'Emerald Citadel',
    badge: 'EMERALD',
    icon: 'diamond',
    description:
      'Polished jade & malachite slate with aged bronze filigree and emerald elder-runes.',
    whitePieceColor: 0xeaf7f0,
    blackPieceColor: 0x0f241d,
    goldAccentColor: 0xd4a359,
    goldAccentEmissive: 0x362407,
    arcaneAccentColor: 0x10b981,
    arcaneAccentEmissive: 0x047857,
    flameColor: 0x6ee7b7,
    darkStoneColor: 0x14241e,
    trimStoneColor: 0x233830,
    crimsonCarpetColor: 0x0d4a38,
    lightSquareColor: 0xdcebe2,
    lightSquareEmissive: 0x0d1f18,
    darkSquareColor: 0x11261f,
    sceneBackground: 0x050e0b,
    sceneFog: 0x071410,
    hemiSkyColor: 0xb8f2d8,
    hemiGroundColor: 0x0e241b,
    altarLightColor: 0x34d399,
    strikeFlashColor: 0x6ee7b7
  },
  {
    id: ChessThemeEnum.AstralObservatory,
    label: 'Astral Observatory',
    badge: 'ASTRAL',
    icon: 'auto_awesome',
    description:
      'Starlight silver-ivory & midnight void stone with celestial platinum and cyan-sapphire runes.',
    whitePieceColor: 0xf0f6ff,
    blackPieceColor: 0x0f172a,
    goldAccentColor: 0x93c5fd,
    goldAccentEmissive: 0x1e3a8a,
    arcaneAccentColor: 0x38bdf8,
    arcaneAccentEmissive: 0x0284c7,
    flameColor: 0x7dd3fc,
    darkStoneColor: 0x131c2e,
    trimStoneColor: 0x1e293b,
    crimsonCarpetColor: 0x1e1b4b,
    lightSquareColor: 0xdbeafe,
    lightSquareEmissive: 0x0f172a,
    darkSquareColor: 0x0f1b33,
    sceneBackground: 0x040814,
    sceneFog: 0x060c1f,
    hemiSkyColor: 0xbae6fd,
    hemiGroundColor: 0x0f172a,
    altarLightColor: 0x38bdf8,
    strikeFlashColor: 0xbae6fd
  },
  {
    id: ChessThemeEnum.CrimsonInquisition,
    label: 'Crimson Crucible',
    badge: 'CRIMSON',
    icon: 'local_fire_department',
    description:
      'Warm bone-ivory & charred basalt with burnished copper and blood-ruby embers.',
    whitePieceColor: 0xfaf0e4,
    blackPieceColor: 0x1f1214,
    goldAccentColor: 0xf59e0b,
    goldAccentEmissive: 0x451a03,
    arcaneAccentColor: 0xf43f5e,
    arcaneAccentEmissive: 0xbe123c,
    flameColor: 0xfb923c,
    darkStoneColor: 0x29181b,
    trimStoneColor: 0x3d2428,
    crimsonCarpetColor: 0x7f1d1d,
    lightSquareColor: 0xefe2d0,
    lightSquareEmissive: 0x241410,
    darkSquareColor: 0x241215,
    sceneBackground: 0x120608,
    sceneFog: 0x17080b,
    hemiSkyColor: 0xfecdd3,
    hemiGroundColor: 0x2b1215,
    altarLightColor: 0xf97316,
    strikeFlashColor: 0xfda4af
  }
] as const;

export function getGameModeConfig(mode: GameMode): GameModeConfig {
  const defaultMode = fromNullable(GAME_MODES[0]).getOrThrow('GAME_MODES registry cannot be empty');
  return fromNullable(GAME_MODES.find(m => m.id === mode)).getOrElse(defaultMode);
}

export function getDifficultyProfile(difficulty: OpponentDifficulty): DifficultyLevelProfile {
  const defaultProfile = fromNullable(DIFFICULTY_PROFILES[1]).getOrThrow(
    'DIFFICULTY_PROFILES registry cannot be empty'
  );
  return fromNullable(DIFFICULTY_PROFILES.find(d => d.id === difficulty)).getOrElse(defaultProfile);
}

export function getThemeConfig(theme: ChessTheme): ThemeConfig {
  const defaultTheme = fromNullable(CHESS_THEMES[0]).getOrThrow(
    'CHESS_THEMES registry cannot be empty'
  );
  return fromNullable(CHESS_THEMES.find(t => t.id === theme)).getOrElse(defaultTheme);
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
 * Resolves the SettingsApplyActionEnum variant using Rust/Scala-style exhaustive pattern matching.
 * - `StartNewGame`: when `forceNewGame` is true OR when no game is currently in progress.
 * - `ApplyAndReset`: when a game is in progress AND at least one match setting (`mode`, `difficulty`, `allowUndo`) changed.
 * - `KeepActiveGame`: when a game is in progress AND no match settings changed.
 */
export function resolveSettingsApplyAction(
  inProgress: boolean,
  before: MatchSettingsSnapshot,
  after: MatchSettingsSnapshot,
  forceNewGame: boolean = false
): SettingsApplyActionEnum {
  return matchBool(forceNewGame, {
    true: () => SettingsApplyActionEnum.StartNewGame,
    false: () =>
      matchBool(inProgress, {
        false: () => SettingsApplyActionEnum.StartNewGame,
        true: () =>
          matchBool(haveMatchSettingsChanged(before, after), {
            true: () => SettingsApplyActionEnum.ApplyAndReset,
            false: () => SettingsApplyActionEnum.KeepActiveGame
          })
      })
  });
}

/**
 * Maps a `SettingsApplyActionEnum` variant to its primary modal button label using exhaustive pattern matching.
 */
export function getSettingsActionButtonLabel(action: SettingsApplyActionEnum): string {
  return match(action, {
    [SettingsApplyActionEnum.KeepActiveGame]: () => 'Keep Current Game',
    [SettingsApplyActionEnum.ApplyAndReset]: () => 'Apply & Start New Game',
    [SettingsApplyActionEnum.StartNewGame]: () => 'Start New Game'
  });
}

/**
 * Determines whether applying settings should reset the chess board.
 * If a game is already in progress (`inProgress === true`), the board is NEVER wiped
 * if nothing changed in the match settings (`SettingsApplyActionEnum.KeepActiveGame`),
 * unless the user explicitly requested a forced New Game reset (`forceNewGame === true`).
 */
export function shouldResetBoardOnSettingsApply(
  inProgress: boolean,
  before: MatchSettingsSnapshot,
  after: MatchSettingsSnapshot,
  forceNewGame: boolean = false
): boolean {
  const action = resolveSettingsApplyAction(inProgress, before, after, forceNewGame);
  return match(action, {
    [SettingsApplyActionEnum.KeepActiveGame]: () => false,
    [SettingsApplyActionEnum.ApplyAndReset]: () => true,
    [SettingsApplyActionEnum.StartNewGame]: () => true
  });
}


