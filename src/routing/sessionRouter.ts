import { fromNullable, Option, some, none } from '../utils/fp';

export type ArcadeGameType = 'chess' | 'blackjack' | 'avalon' | 'uno' | 'phase10';

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

export const ARCADE_GAMES: Record<ArcadeGameType, ArcadeGameMetadata> = {
  chess: {
    id: 'chess',
    title: "Wizard's Chess 3D",
    tagline: 'Articulated High Gothic Cathedral Chess with procedural acoustics & AI.',
    codePrefix: 'SANCT-',
    minPlayers: 1,
    maxPlayers: 2,
    icon: 'church',
    badgeText: 'Live & Playable',
    isAvailable: true,
    phaseNumber: 1
  },
  blackjack: {
    id: 'blackjack',
    title: 'Gothic Blackjack',
    tagline: 'High-stakes sanctuary card tables against the Cathedral Dealer.',
    codePrefix: 'BJK-',
    minPlayers: 1,
    maxPlayers: 7,
    icon: 'playing_cards',
    badgeText: 'Phase 2 Preview',
    isAvailable: false,
    phaseNumber: 2
  },
  avalon: {
    id: 'avalon',
    title: 'The Resistance: Avalon',
    tagline: 'Holy Knights vs Mordred Minions. Secret voting, quests & assassinations.',
    codePrefix: 'AVALON-',
    minPlayers: 5,
    maxPlayers: 10,
    icon: 'swords',
    badgeText: 'Phase 3 Preview',
    isAvailable: false,
    phaseNumber: 3
  },
  uno: {
    id: 'uno',
    title: 'Cardinal Uno',
    tagline: 'Cathedral stained glass color matching with Reverse, Skip, & Wild +4.',
    codePrefix: 'UNO-',
    minPlayers: 2,
    maxPlayers: 8,
    icon: 'style',
    badgeText: 'Phase 4 Preview',
    isAvailable: false,
    phaseNumber: 4
  },
  phase10: {
    id: 'phase10',
    title: 'Ten Rites (Phase 10)',
    tagline: 'Master the 10 liturgical card rites: sets, runs, and sacred melds.',
    codePrefix: 'P10-',
    minPlayers: 2,
    maxPlayers: 6,
    icon: 'auto_stories',
    badgeText: 'Phase 5 Preview',
    isAvailable: false,
    phaseNumber: 5
  }
};

export interface RouteResolution {
  game: ArcadeGameType;
  sessionCode: Option<string>;
  isDirectJoin: boolean;
  showHub: boolean;
}

/**
 * Detects the game type from a session code prefix (e.g. SANCT-, BJK-, AVALON-, UNO-, P10-).
 */
export function detectGameFromSessionCode(code: string): ArcadeGameType {
  const normalized = code.trim().toUpperCase();
  if (normalized.startsWith('SANCT-')) return 'chess';
  if (normalized.startsWith('BJK-')) return 'blackjack';
  if (normalized.startsWith('AVALON-')) return 'avalon';
  if (normalized.startsWith('UNO-')) return 'uno';
  if (normalized.startsWith('P10-')) return 'phase10';

  // Default fallback for legacy or custom session codes
  return 'chess';
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
export function buildArcadeGameUrl(
  baseUrl: string,
  game: ArcadeGameType,
  sessionCode?: string
): string {
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
