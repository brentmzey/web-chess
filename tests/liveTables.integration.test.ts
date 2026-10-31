import { describe, expect, it } from 'bun:test';
import { exportTableSnapshot, importTableSnapshot, type ArcadeTableSnapshot, type SnapshotableEngine } from '../src/games/multiplayer/tableSnapshot';
import { HIDDEN_INFO_POLICIES, type HiddenInfoPolicy } from '../src/games/multiplayer/hiddenInfo';
import { applyArcadeIntent, createArcadeIntentHandlers, type ArcadeIntentEngines } from '../src/games/multiplayer/arcadeIntentHandlers';
import type { SeatOwners } from '../src/games/multiplayer/liveSeats';
import { CardinalUnoEngine } from '../src/games/uno/unoEngine';
import { SkipBoEngine } from '../src/games/skipbo/skipboEngine';
import { Phase10Engine } from '../src/games/phase10/phase10Engine';
import { AvalonEngine } from '../src/games/avalon/avalonEngine';
import { SetEngine } from '../src/games/set/setEngine';
import { CathedralPokerEngine } from '../src/games/poker/pokerEngine';
import { BlackjackMultiSeatEngine } from '../src/games/blackjack/blackjackMultiSeatEngine';
import { CathedralSolitaireEngine } from '../src/games/solitaire/solitaireEngine';
import { PokerActionEnum, PokerVariantEnum } from '../src/constants/gameEnums';

/**
 * End-to-end live tables without a browser: the host runs the real engine and intent handlers, every
 * message crosses a JSON "wire", guests only ever see the redacted table plus their own secrets, and
 * both sides must converge on the same public table after each move.
 */

const HOST = 'host-participant';
const GUEST = 'guest-participant';
const STRANGER = 'unseated-participant';

const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

interface Published {
  readonly publicTable: ArcadeTableSnapshot;
  readonly guestSecrets: Record<string, unknown>;
}

/** What the host sends: the public (redacted) table to everyone, and the guest's own secrets to the guest. */
const publish = (host: SnapshotableEngine,
                 policy: HiddenInfoPolicy,
                 owners: SeatOwners,
                 guestSeat: string): Published => {
  const full = wire(exportTableSnapshot(host, { owners, game: null }));
  return { publicTable: wire(policy.redact(full)), guestSecrets: wire({ ...policy.secretsFor(full, guestSeat) }) };
};

/** What the guest renders: the public table with its own secrets put back. */
const guestReceives = (guest: SnapshotableEngine,
                       policy: HiddenInfoPolicy,
                       published: Published,
                       guestSeat: string): void => {
  expect(importTableSnapshot(guest, wire(policy.reveal(published.publicTable, guestSeat, published.guestSecrets))).isSuccess()).toBe(true);
};

/** Every card id under the given keys, anywhere in a value (hands, piles, shoes). */
const idsUnder = (value: unknown,
                  keys: readonly string[],
                  inside: boolean = false): string[] => {
  if (Array.isArray(value)) return value.flatMap(v => idsUnder(v, keys, inside));
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    inside && k === 'id' && typeof v === 'string' ? [v] : idsUnder(v, keys, inside || keys.includes(k)));
};

const engines = (overrides: Partial<ArcadeIntentEngines>): ArcadeIntentEngines => ({
  uno: () => new CardinalUnoEngine('Host', 4),
  skipbo: () => new SkipBoEngine('Host', 'Bot', 15, undefined, 4),
  phase10: () => new Phase10Engine('Host', 'Bot', undefined, 4),
  poker: () => new CathedralPokerEngine(PokerVariantEnum.TexasHoldem, 6, 10, 20),
  blackjack: () => new BlackjackMultiSeatEngine(3, 10, 500),
  avalon: () => new AvalonEngine('Host', 5),
  set: () => new SetEngine(3, 'Host'),
  ensureBjkBettingStage: () => undefined,
  castAvalonBotQuestCards: () => undefined,
  ...overrides
});

/** Forces a turn-based player-list engine onto the given seat index. */
const setTurn = (engine: { state: unknown },
                 turnIndex: number): void => {
  engine.state = { ...(engine.state as object), currentTurnIndex: turnIndex };
};

describe('Live tables: host ↔ guest over the wire, every game', () => {
  const playerListCases = [
    { game: 'uno', make: () => new CardinalUnoEngine('Host', 4), secretKeys: ['hand', 'drawPile'] },
    { game: 'skipbo', make: () => new SkipBoEngine('Host', 'Bot', 15, undefined, 4), secretKeys: ['hand', 'drawPile'] },
    { game: 'phase10', make: () => new Phase10Engine('Host', 'Bot', undefined, 4), secretKeys: ['hand', 'drawPile'] }
  ] as const;

  playerListCases.forEach(({ game, make, secretKeys }) => {
    it(`${game}: guest sees only its own hand, moves only on its turn, and both sides converge`, () => {
      const host = make();
      const guest = make();
      const policy = HIDDEN_INFO_POLICIES[game]!;
      host.claimSeatForHuman(1, 'Guest');
      const owners: SeatOwners = { p1: HOST, p2: GUEST };
      const handlers = createArcadeIntentHandlers(engines({ [game]: () => host } as Partial<ArcadeIntentEngines>));

      const first = publish(host, policy, owners, 'p2');
      const otherSecretIds = idsUnder((wire(exportTableSnapshot(host)).state as any).players.filter((p: any) => p.id !== 'p2'), ['hand'])
        .concat(idsUnder((host.state as any).drawPile ?? [], [], true));
      expect(otherSecretIds.length).toBeGreaterThan(0);
      const publicJson = JSON.stringify(first.publicTable);
      otherSecretIds.forEach(id => expect(publicJson).not.toContain(`"${id}"`));
      guestReceives(guest, policy, first, 'p2');
      const guestHand = (guest.state as any).players[1].hand;
      expect(guestHand).toEqual(wire((host.state as any).players[1].hand));
      expect(secretKeys.length).toBeGreaterThan(0);

      // Out of turn, unseated or malformed moves never touch the table
      const before = JSON.stringify(host.state);
      const drawIntent = game === 'uno' ? ['uno_draw', {}] : game === 'skipbo' ? ['skipbo_discard', { handIndex: 0, targetIndex: 0 }] : ['p10_draw', { fromDiscard: false }];
      setTurn(host, 0);
      expect(applyArcadeIntent(handlers, owners, GUEST, drawIntent[0] as string, drawIntent[1]).getOrThrow()).toBe(false);
      expect(applyArcadeIntent(handlers, owners, STRANGER, drawIntent[0] as string, drawIntent[1]).isFailure()).toBe(true);
      expect(applyArcadeIntent(handlers, owners, GUEST, drawIntent[0] as string, 'garbage').isFailure()).toBe(true);
      expect(JSON.stringify(host.state)).toBe(before);

      // On its turn the guest's move runs on the host and reaches the guest in the next publish
      setTurn(host, 1);
      expect(applyArcadeIntent(handlers, owners, GUEST, drawIntent[0] as string, drawIntent[1]).getOrThrow()).toBe(true);
      expect(JSON.stringify(host.state)).not.toBe(before);
      const second = publish(host, policy, owners, 'p2');
      guestReceives(guest, policy, second, 'p2');
      expect(wire(policy.redact(wire(exportTableSnapshot(guest, { owners, game: null }))))).toEqual(second.publicTable);
      expect((guest.state as any).players[1].hand).toEqual(wire((host.state as any).players[1].hand));
    });
  });

  it('avalon: roles stay secret, only the leader proposes, and the guest votes', () => {
    const host = new AvalonEngine('Host', 5);
    const guest = new AvalonEngine('Host', 5);
    const policy = HIDDEN_INFO_POLICIES.avalon!;
    host.claimSeatForHuman(1, 'Guest');
    const owners: SeatOwners = { p1: HOST, p2: GUEST };
    const handlers = createArcadeIntentHandlers(engines({ avalon: () => host }));

    const first = publish(host, policy, owners, 'p2');
    const publicPlayers = (first.publicTable.state as any).players;
    expect(publicPlayers.filter((p: any) => p.id !== 'p2').every((p: any) => p.role === 'hidden')).toBe(true);
    guestReceives(guest, policy, first, 'p2');
    expect(guest.state.players[1]!.role).toBe(host.state.players[1]!.role);

    const leader = host.getCurrentLeader().id;
    const team = host.state.players.slice(0, host.getCurrentQuest().teamSize).map(p => p.id);
    const notLeader = leader === 'p2' ? 'p1' : 'p2';
    const notLeaderOwners: SeatOwners = { [notLeader]: GUEST };
    expect(applyArcadeIntent(handlers, notLeaderOwners, GUEST, 'avalon_propose', { team }).getOrThrow()).toBe(false);
    expect(applyArcadeIntent(handlers, { [leader]: GUEST }, GUEST, 'avalon_propose', { team }).getOrThrow()).toBe(true);
    expect(host.state.stage).toBe('voting');
    expect(applyArcadeIntent(handlers, owners, GUEST, 'avalon_vote', { approve: true }).getOrThrow()).toBe(true);

    // An open vote stays secret in the public table until every knight has voted
    const voting = publish(host, policy, owners, 'p2');
    expect(Object.values((voting.publicTable.state as any).quests[host.state.currentQuestIndex].votes).every(v => v === null)).toBe(true);
  });

  it('set: the guest claims by card id against a public table whose deck stays hidden', () => {
    const host = new SetEngine(3, 'Host');
    const guest = new SetEngine(3, 'Host');
    const policy = HIDDEN_INFO_POLICIES.set!;
    host.claimSeatForHuman(1, 'Guest');
    const owners: SeatOwners = { p1: HOST, p2: GUEST };
    const handlers = createArcadeIntentHandlers(engines({ set: () => host }));

    const first = publish(host, policy, owners, 'p2');
    const deckIds = host.state.deck.map(card => card.id);
    deckIds.forEach(id => expect(JSON.stringify(first.publicTable)).not.toContain(`"${id}"`));
    guestReceives(guest, policy, first, 'p2');

    // While another set is possible, keep dealing until one is on the table
    while (host.getAvailableSets().length === 0) host.dealThreeMoreCards();
    const triple = host.getAvailableSets()[0]!;
    const cardIds = triple.map(i => guest.state.tableCards[i]?.id ?? host.state.tableCards[i]!.id);
    expect(applyArcadeIntent(handlers, owners, GUEST, 'set_claim', { cardIds: ['gone-1', 'gone-2', 'gone-3'] }).getOrThrow()).toBe(false);
    expect(applyArcadeIntent(handlers, owners, GUEST, 'set_claim', { cardIds: triple.map(i => host.state.tableCards[i]!.id) }).getOrThrow()).toBe(true);
    expect(host.state.players[1]!.score).toBeGreaterThan(0);
    expect(cardIds.length).toBe(3);
  });

  it('poker: hole cards and the shoe stay hidden, and only the seat to act may act', () => {
    const host = new CathedralPokerEngine(PokerVariantEnum.TexasHoldem, 6, 10, 20);
    const guest = new CathedralPokerEngine(PokerVariantEnum.TexasHoldem, 6, 10, 20);
    const policy = HIDDEN_INFO_POLICIES.poker!;
    [host, guest].forEach(engine => {
      engine.seatManager.claimSeat(1, HOST, 'Host');
      engine.seatManager.claimSeat(2, GUEST, 'Guest');
    });
    expect(host.startHand().isSuccess()).toBe(true);
    const actingSeat = host.state.activeSeatTurn.getOrThrow();
    const otherSeat = host.seatManager.getOccupiedSeats().find(seat => seat.seatNumber !== actingSeat)!.seatNumber;
    const owners: SeatOwners = { [String(actingSeat)]: GUEST, [String(otherSeat)]: HOST };
    const handlers = createArcadeIntentHandlers(engines({ poker: () => host }));

    const first = publish(host, policy, owners, String(actingSeat));
    const otherHole = JSON.stringify(host.seatManager.getSeat(otherSeat).getOrThrow().extraData?.holeCards);
    expect(otherHole.length).toBeGreaterThan(2);
    expect(JSON.stringify(first.publicTable)).not.toContain(otherHole);
    guestReceives(guest, policy, first, String(actingSeat));
    expect(guest.seatManager.getSeat(actingSeat).getOrThrow().extraData?.holeCards)
      .toEqual(wire(host.seatManager.getSeat(actingSeat).getOrThrow().extraData?.holeCards));

    expect(applyArcadeIntent(handlers, { [String(otherSeat)]: GUEST }, GUEST, 'poker_action', { action: PokerActionEnum.Fold }).getOrThrow()).toBe(false);
    expect(applyArcadeIntent(handlers, owners, GUEST, 'poker_action', { action: PokerActionEnum.Fold }).getOrThrow()).toBe(true);
    expect(host.state.activeSeatTurn.getOrElse(-1)).not.toBe(actingSeat);
  });

  it('blackjack: the guest bets and plays its seat while the shoe and hole card stay hidden', () => {
    const host = new BlackjackMultiSeatEngine(3, 10, 500);
    const policy = HIDDEN_INFO_POLICIES.blackjack!;
    const table: SnapshotableEngine = {
      get state() {
        return { multi: host.state };
      },
      set state(value: unknown) {
        host.state = (value as { multi: typeof host.state }).multi;
      },
      seatManager: host.seatManager
    };
    host.seatManager.claimSeat(1, HOST, 'Host');
    host.seatManager.claimSeat(2, GUEST, 'Guest');
    const seat = 2;
    const owners: SeatOwners = { [String(seat)]: GUEST };
    let bettingStageChecks = 0;
    const handlers = createArcadeIntentHandlers(engines({ blackjack: () => host, ensureBjkBettingStage: () => { bettingStageChecks++; } }));

    expect(applyArcadeIntent(handlers, owners, GUEST, 'bjk_bet', { amount: 50 }).getOrThrow()).toBe(true);
    expect(bettingStageChecks).toBe(1);
    host.seatManager.getOccupiedSeats().filter(s => s.seatNumber !== seat).forEach(s => host.placeBet(s.seatNumber, 10));
    expect(host.startRound().isSuccess()).toBe(true);

    const published = publish(table, policy, owners, String(seat));
    const publicMulti = (published.publicTable.state as any).multi;
    expect(publicMulti.shoe.every((card: any) => card.hidden === true)).toBe(true);
    expect(publicMulti.dealerHand.filter((card: any) => card.hidden === true).length).toBe(1);

    // The host's seat acts first; once it stands the turn passes to the guest (unless the guest was dealt 21)
    host.state.activeSeatTurn.filter(active => active !== seat).map(active => host.playerStand(active));
    host.state.activeSeatTurn.filter(active => active === seat).map(() =>
      expect(applyArcadeIntent(handlers, owners, GUEST, 'bjk_stand', {}).getOrThrow()).toBe(true));
    expect(applyArcadeIntent(handlers, { '99': GUEST }, GUEST, 'bjk_hit', {}).getOrThrow()).toBe(false);
  });

  it('solitaire: spectators mirror the player board exactly and cannot change it', () => {
    const player = new CathedralSolitaireEngine();
    const spectator = new CathedralSolitaireEngine();
    player.drawFromStock(1);
    player.autoMoveToFoundations();
    expect(spectator.importSnapshot(wire(player.exportSnapshot())).isSuccess()).toBe(true);
    expect(wire(spectator.exportSnapshot())).toEqual(wire(player.exportSnapshot()));
    expect(spectator.importSnapshot('garbage').isFailure()).toBe(true);
    expect(wire(spectator.exportSnapshot())).toEqual(wire(player.exportSnapshot()));
  });

  it('routes every guest intent type to its engine and returns a verdict instead of throwing', () => {
    const avalon = new AvalonEngine('Host', 5);
    let botQuestCards = 0;
    const handlers = createArcadeIntentHandlers(engines({ avalon: () => avalon, castAvalonBotQuestCards: () => { botQuestCards++; } }));
    const assassin = avalon.state.players.find(p => p.role === 'Assassin')!.id;
    const intents: readonly (readonly [string, unknown, string])[] = [
      ['uno_play', { handIndex: 0 }, 'p1'],
      ['uno_call', {}, 'p1'],
      ['skipbo_play', { source: 'hand', sourceIndex: 0, buildingIndex: 0 }, 'p1'],
      ['p10_lay', { g1: [0, 1, 2], g2: [3, 4, 5] }, 'p1'],
      ['p10_hit', { cardIndex: 0, groupIndex: 0, targetPlayerId: 'p2' }, 'p1'],
      ['p10_discard', { cardIndex: 0 }, 'p1'],
      ['poker_draw', { discardIndices: [0] }, '1'],
      ['bjk_hit', {}, '1'],
      ['bjk_double', {}, '1'],
      ['bjk_stand', {}, '1'],
      ['avalon_assassinate', { targetId: 'p1' }, 'p2'],
      ['avalon_assassinate', { targetId: 'p1' }, assassin],
      ['avalon_quest', { pass: true }, 'p1']
    ];
    intents.forEach(([type, payload, seat]) =>
      expect(typeof applyArcadeIntent(handlers, { [seat]: GUEST }, GUEST, type, payload).getOrThrow()).toBe('boolean'));
    expect(botQuestCards).toBe(1);
  });
});
