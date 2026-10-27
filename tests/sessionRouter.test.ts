import { describe, expect, it } from 'bun:test';
import {
  ARCADE_GAMES,
  buildArcadeGameUrl,
  detectGameFromSessionCode,
  extractSessionCodeOrUrl,
  resolveRoute
} from '../src/routing/sessionRouter';

describe('Sanctuary Arcade Session Router & URL Deep-Linking', () => {
  it('detects game type accurately from session code prefix', () => {
    expect(detectGameFromSessionCode('SANCT-ABCD')).toBe('chess');
    expect(detectGameFromSessionCode('sanct-1234')).toBe('chess');
    expect(detectGameFromSessionCode('BJK-W7X2')).toBe('blackjack');
    expect(detectGameFromSessionCode('bjk-9999')).toBe('blackjack');
    expect(detectGameFromSessionCode('AVALON-KNIGHTS')).toBe('avalon');
    expect(detectGameFromSessionCode('avalon-mordred')).toBe('avalon');
    expect(detectGameFromSessionCode('UNO-4COLOR')).toBe('uno');
    expect(detectGameFromSessionCode('uno-reverse')).toBe('uno');
    expect(detectGameFromSessionCode('P10-RITE10')).toBe('phase10');
    expect(detectGameFromSessionCode('p10-meld')).toBe('phase10');
    expect(detectGameFromSessionCode('POKER-ROYAL')).toBe('poker');
    expect(detectGameFromSessionCode('poker-texas')).toBe('poker');
    expect(detectGameFromSessionCode('SKIP-FAST')).toBe('skipbo');
    expect(detectGameFromSessionCode('skip-1234')).toBe('skipbo');

    // Unknown or legacy code defaults gracefully to chess
    expect(detectGameFromSessionCode('UNKNOWN-CODE')).toBe('chess');
    expect(detectGameFromSessionCode('')).toBe('chess');
  });

  it('resolves route for default load without query params', () => {
    const route = resolveRoute('');
    expect(route.game).toBe('chess');
    expect(route.sessionCode.isNone()).toBe(true);
    expect(route.isDirectJoin).toBe(false);
    expect(route.showHub).toBe(false);
  });

  it('resolves route when hub front screen is requested explicitly', () => {
    const r1 = resolveRoute('?hub=true');
    expect(r1.showHub).toBe(true);
    expect(r1.isDirectJoin).toBe(false);

    const r2 = resolveRoute('hub=1');
    expect(r2.showHub).toBe(true);
  });

  it('resolves direct session join from URL search string', () => {
    const chessRoute = resolveRoute('?session=SANCT-H4P9');
    expect(chessRoute.game).toBe('chess');
    expect(chessRoute.isDirectJoin).toBe(true);
    expect(chessRoute.sessionCode.getOrElse('')).toBe('SANCT-H4P9');
    expect(chessRoute.showHub).toBe(false);

    const bjkRoute = resolveRoute('?session=bjk-9102');
    expect(bjkRoute.game).toBe('blackjack');
    expect(bjkRoute.isDirectJoin).toBe(true);
    expect(bjkRoute.sessionCode.getOrElse('')).toBe('BJK-9102');

    const avalonRoute = resolveRoute('?game=avalon&session=AVALON-7788');
    expect(avalonRoute.game).toBe('avalon');
    expect(avalonRoute.isDirectJoin).toBe(true);
    expect(avalonRoute.sessionCode.getOrElse('')).toBe('AVALON-7788');
  });

  it('resolves explicit game without session', () => {
    const unoRoute = resolveRoute('?game=uno');
    expect(unoRoute.game).toBe('uno');
    expect(unoRoute.sessionCode.isNone()).toBe(true);
    expect(unoRoute.isDirectJoin).toBe(false);

    const p10Route = resolveRoute('?game=phase10');
    expect(p10Route.game).toBe('phase10');
    expect(p10Route.sessionCode.isNone()).toBe(true);
  });

  it('extracts session code and game from raw codes and full URLs', () => {
    // Empty input returns none
    expect(extractSessionCodeOrUrl('').isNone()).toBe(true);
    expect(extractSessionCodeOrUrl('   ').isNone()).toBe(true);

    // Raw codes
    const chessRaw = extractSessionCodeOrUrl('sanct-test').getOrThrow();
    expect(chessRaw.game).toBe('chess');
    expect(chessRaw.code).toBe('SANCT-TEST');

    const bjkRaw = extractSessionCodeOrUrl('BJK-TABLE').getOrThrow();
    expect(bjkRaw.game).toBe('blackjack');
    expect(bjkRaw.code).toBe('BJK-TABLE');

    // Full URLs
    const url1 = extractSessionCodeOrUrl('https://web-chess.pockethost.io/?session=SANCT-LINK1').getOrThrow();
    expect(url1.game).toBe('chess');
    expect(url1.code).toBe('SANCT-LINK1');

    const url2 = extractSessionCodeOrUrl('https://web-chess-app.netlify.app/?game=uno&session=uno-card4').getOrThrow();
    expect(url2.game).toBe('uno');
    expect(url2.code).toBe('UNO-CARD4');
  });

  it('builds canonical shareable URLs for games and sessions', () => {
    const base = 'https://web-chess.netlify.app';
    const chessUrl = buildArcadeGameUrl(base, 'chess', 'SANCT-8899');
    expect(chessUrl).toBe('https://web-chess.netlify.app/?session=SANCT-8899');

    const bjkUrl = buildArcadeGameUrl(base, 'blackjack', 'BJK-1122');
    expect(bjkUrl).toBe('https://web-chess.netlify.app/?game=blackjack&session=BJK-1122');
  });

  it('contains complete metadata for all Sanctuary Arcade games in ARCADE_GAMES', () => {
    const expectedGames = ['chess', 'blackjack', 'avalon', 'uno', 'phase10', 'poker', 'skipbo'] as const;
    for (const g of expectedGames) {
      const meta = ARCADE_GAMES[g];
      expect(meta).toBeDefined();
      expect(meta.id).toBe(g);
      expect(meta.title.length).toBeGreaterThan(0);
      expect(meta.codePrefix.length).toBeGreaterThan(0);
      expect(meta.minPlayers).toBeGreaterThanOrEqual(1);
      expect(meta.maxPlayers).toBeGreaterThanOrEqual(meta.minPlayers);
      expect(meta.phaseNumber).toBeGreaterThanOrEqual(1);
    }
  });
});
