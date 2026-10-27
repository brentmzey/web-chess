import { fromNullable, Option, some, none } from '../utils/fp';
import { ArcadeGameEnum, GameCodePrefixEnum } from '../constants/gameEnums';

export type ArcadeGameType =
  | 'chess'
  | 'blackjack'
  | 'avalon'
  | 'uno'
  | 'phase10'
  | 'poker'
  | 'skipbo'
  | 'set'
  | ArcadeGameEnum;

export interface ArcadeGameMetadata {
  id: ArcadeGameType;
  title: string;
  tagline: string;
  codePrefix: string;
  minPlayers: number;
  maxPlayers: number;
  icon: string;
  badgeText: string;
  isAvailable: boolean;
  phaseNumber: number;
}

export const ARCADE_GAMES: Record<string, ArcadeGameMetadata> = {
  [ArcadeGameEnum.Chess]: {
    id: ArcadeGameEnum.Chess,
    title: "Wizard's Chess 3D",
    tagline: 'Articulated High Gothic Cathedral Chess with procedural acoustics & AI.',
    codePrefix: GameCodePrefixEnum.Sanctuary,
    minPlayers: 1,
    maxPlayers: 2,
    icon: 'church',
    badgeText: 'Live & Playable',
    isAvailable: true,
    phaseNumber: 1
  },
  [ArcadeGameEnum.Blackjack]: {
    id: ArcadeGameEnum.Blackjack,
    title: 'Gothic Blackjack',
    tagline: 'High-stakes sanctuary card tables against the Cathedral Dealer.',
    codePrefix: GameCodePrefixEnum.Blackjack,
    minPlayers: 1,
    maxPlayers: 7,
    icon: 'playing_cards',
    badgeText: 'Live & Playable',
    isAvailable: true,
    phaseNumber: 2
  },
  [ArcadeGameEnum.Avalon]: {
    id: ArcadeGameEnum.Avalon,
    title: 'The Resistance: Avalon',
    tagline: 'Holy Knights vs Mordred Minions. Secret voting, quests & assassinations.',
    codePrefix: GameCodePrefixEnum.Avalon,
    minPlayers: 5,
    maxPlayers: 10,
    icon: 'swords',
    badgeText: 'Live & Playable',
    isAvailable: true,
    phaseNumber: 3
  },
  [ArcadeGameEnum.Uno]: {
    id: ArcadeGameEnum.Uno,
    title: 'Cardinal Uno',
    tagline: 'Cathedral stained glass color matching with Reverse, Skip, & Wild +4.',
    codePrefix: GameCodePrefixEnum.Uno,
    minPlayers: 2,
    maxPlayers: 10,
    icon: 'style',
    badgeText: 'Live & Playable',
    isAvailable: true,
    phaseNumber: 4
  },
  [ArcadeGameEnum.Phase10]: {
    id: ArcadeGameEnum.Phase10,
    title: 'Ten Rites (Phase 10)',
    tagline: 'Master the 10 liturgical card rites: sets, runs, and sacred melds.',
    codePrefix: GameCodePrefixEnum.Phase10,
    minPlayers: 2,
    maxPlayers: 6,
    icon: 'auto_stories',
    badgeText: 'Live & Playable',
    isAvailable: true,
    phaseNumber: 5
  },
  [ArcadeGameEnum.Poker]: {
    id: ArcadeGameEnum.Poker,
    title: 'Cathedral Poker',
    tagline: "Texas Hold'em, Omaha, Stud & Draw variants with high-stakes sanctuary blinds.",
    codePrefix: GameCodePrefixEnum.Poker,
    minPlayers: 2,
    maxPlayers: 10,
    icon: 'token',
    badgeText: 'Live & Playable',
    isAvailable: true,
    phaseNumber: 6
  },
  [ArcadeGameEnum.SkipBo]: {
    id: ArcadeGameEnum.SkipBo,
    title: 'Sacred Skip-Bo',
    tagline: 'Race to deplete your 15-card stockpile onto 4 shared ascending building piles.',
    codePrefix: GameCodePrefixEnum.SkipBo,
    minPlayers: 2,
    maxPlayers: 6,
    icon: 'counter_1',
    badgeText: 'Live & Playable',
    isAvailable: true,
    phaseNumber: 7
  },
  [ArcadeGameEnum.Set]: {
    id: ArcadeGameEnum.Set,
    title: 'Sacred Geometry SET',
    tagline: '81-card GF(3)^4 finite geometry pattern recognition: match 3 cards where each of 4 attributes is all identical or all distinct.',
    codePrefix: GameCodePrefixEnum.Set,
    minPlayers: 1,
    maxPlayers: 20,
    icon: 'category',
    badgeText: 'Live & Playable',
    isAvailable: true,
    phaseNumber: 8
  }
};

export interface RouteResolution {
  game: ArcadeGameType;
  sessionCode: Option<string>;
  isDirectJoin: boolean;
  showHub: boolean;
}

/**
 * Detects the game type from a session code prefix (e.g. SANCT-, BJK-, AVALON-, UNO-, P10-, POKER-, SKIP-, SET-).
 */
export function detectGameFromSessionCode(code: string): ArcadeGameType {
  const normalized = code.trim().toUpperCase();
  if (normalized.startsWith(GameCodePrefixEnum.Sanctuary)) return ArcadeGameEnum.Chess;
  if (normalized.startsWith(GameCodePrefixEnum.Blackjack)) return ArcadeGameEnum.Blackjack;
  if (normalized.startsWith(GameCodePrefixEnum.Avalon)) return ArcadeGameEnum.Avalon;
  if (normalized.startsWith(GameCodePrefixEnum.Uno)) return ArcadeGameEnum.Uno;
  if (normalized.startsWith(GameCodePrefixEnum.Phase10)) return ArcadeGameEnum.Phase10;
  if (normalized.startsWith(GameCodePrefixEnum.Poker)) return ArcadeGameEnum.Poker;
  if (normalized.startsWith(GameCodePrefixEnum.SkipBo)) return ArcadeGameEnum.SkipBo;
  if (normalized.startsWith(GameCodePrefixEnum.Set)) return ArcadeGameEnum.Set;

  // Default fallback for legacy or custom session codes
  return ArcadeGameEnum.Chess;
}

/**
 * Resolves the application route from a URL search query string (e.g. window.location.search).
 */
export function resolveRoute(searchString: string): RouteResolution {
  const params = new URLSearchParams(searchString.startsWith('?') ? searchString : `?${searchString}`);
  const gameParam = params.get('game')?.toLowerCase();
  const sessionParam = params.get('session')?.trim();
  const hubParam = params.get('hub');

  // If hub is explicitly requested and no session join is present
  if (hubParam === 'true' || hubParam === '1') {
    return {
      game: 'chess',
      sessionCode: fromNullable(sessionParam),
      isDirectJoin: Boolean(sessionParam),
      showHub: true
    };
  }

  // If a session code is provided, detect game from its prefix or explicit game param
  if (sessionParam) {
    const gameOpt = fromNullable(gameParam)
      .filter(g => g in ARCADE_GAMES)
      .map(g => g as ArcadeGameType);
    const detectedGame: ArcadeGameType = gameOpt.getOrElse(detectGameFromSessionCode(sessionParam));

    return {
      game: detectedGame,
      sessionCode: some(sessionParam.toUpperCase()),
      isDirectJoin: true,
      showHub: false
    };
  }

  // If an explicit game is specified without session
  if (gameParam && gameParam in ARCADE_GAMES) {
    return {
      game: gameParam as ArcadeGameType,
      sessionCode: none(),
      isDirectJoin: false,
      showHub: false
    };
  }

  // Default initial load: if no query params at all, show the chess game with quick hub launcher
  return {
    game: 'chess',
    sessionCode: none(),
    isDirectJoin: false,
    showHub: false
  };
}

/**
 * Builds a shareable URL for a given game and optional session code.
 */
export function buildArcadeGameUrl(baseUrl: string,
                                   game: ArcadeGameType,
                                   sessionCode?: string): string {
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://web-chess.pockethost.io';
  const url =
    baseUrl.startsWith('http://') || baseUrl.startsWith('https://')
      ? new URL(baseUrl)
      : new URL(baseUrl, origin);
  if (game !== 'chess') {
    url.searchParams.set('game', game);
  }
  if (sessionCode) {
    url.searchParams.set('session', sessionCode.toUpperCase());
  }
  return url.toString();
}

/**
 * Extracts a session code from either a full URL or a raw code string.
 */
export function extractSessionCodeOrUrl(input: string): Option<{ game: ArcadeGameType; code: string }> {
  const trimmed = input.trim();
  if (!trimmed) return none();

  try {
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      const parsed = new URL(trimmed);
      const session = parsed.searchParams.get('session');
      if (session) {
        const game = parsed.searchParams.get('game') as ArcadeGameType | null;
        const resolvedGame = game && game in ARCADE_GAMES ? game : detectGameFromSessionCode(session);
        return some({ game: resolvedGame, code: session.toUpperCase() });
      }
    }
  } catch {
    // Not a valid URL, treat as raw code
  }

  const rawCode = trimmed.toUpperCase();
  return some({
    game: detectGameFromSessionCode(rawCode),
    code: rawCode
  });
}
