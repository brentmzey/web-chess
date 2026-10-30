import { describe, expect, it } from 'bun:test';
import { exportTableSnapshot, importTableSnapshot, type ArcadeTableSnapshot, type SnapshotableEngine } from '../src/games/multiplayer/tableSnapshot';
import { HIDDEN_CARD, HIDDEN_INFO_POLICIES, HIDDEN_TEXT, playerListPolicy } from '../src/games/multiplayer/hiddenInfo';
import { CardinalUnoEngine } from '../src/games/uno/unoEngine';
import { SkipBoEngine } from '../src/games/skipbo/skipboEngine';
import { Phase10Engine } from '../src/games/phase10/phase10Engine';
import { AvalonEngine } from '../src/games/avalon/avalonEngine';
import { SetEngine } from '../src/games/set/setEngine';
import { CathedralPokerEngine } from '../src/games/poker/pokerEngine';
import { BlackjackMultiSeatEngine } from '../src/games/blackjack/blackjackMultiSeatEngine';
import { BlackjackEngine } from '../src/games/blackjack/blackjackEngine';
import { PokerVariantEnum } from '../src/constants/gameEnums';

/** Exports a table the way the app does: seat owners plus engine extras wrapped together. */
const snapshotOf = (engine: SnapshotableEngine,
                    extras: unknown = null): ArcadeTableSnapshot =>
  JSON.parse(JSON.stringify(exportTableSnapshot(engine, { owners: {}, game: extras })));

const cardKey = (card: any) => JSON.stringify(card);

describe('Hidden information policies', () => {
  it('Uno: hides every hand and the draw pile, keeps counts, and reveals only the viewer’s hand', () => {
    const uno = new CardinalUnoEngine('Pilgrim', 4);
    uno.claimSeatForHuman(1, 'Guest');
    const full = snapshotOf(uno);
    const guestHand = uno.state.players[1]!.hand;
    const policy = HIDDEN_INFO_POLICIES.uno!;

    const pub = policy.redact(full);
    const pubJson = JSON.stringify(pub);
    uno.state.players.forEach(p => p.hand.forEach(card => expect(pubJson).not.toContain(cardKey(card))));
    const pubPlayers = (pub.state as any).players;
    expect(pubPlayers[1].hand.length).toBe(guestHand.length);
    expect(pubPlayers[1].hand[0]).toEqual(HIDDEN_CARD);
    expect((pub.state as any).drawPile.length).toBe(uno.state.drawPile.length);
    expect((pub.state as any).discardPile).toEqual(JSON.parse(JSON.stringify(uno.state.discardPile)));

    const secrets = policy.secretsFor(full, 'p2');
    expect(secrets).toEqual({ hand: JSON.parse(JSON.stringify(guestHand)) });
    const view = policy.reveal(pub, 'p2', secrets);
    expect((view.state as any).players[1].hand).toEqual(JSON.parse(JSON.stringify(guestHand)));
    expect((view.state as any).players[0].hand[0]).toEqual(HIDDEN_CARD);

    // Seat extraData mirrors the player state and must be scrubbed and revealed too
    const guestSeat = (pub.seats as any[]).find(s => s.playerId === 'p2');
    expect(guestSeat.extraData.hand[0]).toEqual(HIDDEN_CARD);
    expect((view.seats as any[]).find(s => s.playerId === 'p2').extraData.hand).toEqual(JSON.parse(JSON.stringify(guestHand)));

    // Before the private record arrives the viewer sees an empty hand, never placeholders
    expect((policy.reveal(pub, 'p2', {}).state as any).players[1].hand).toEqual([]);
    expect(policy.secretsFor(full, 'p9')).toEqual({});

    // The revealed view still imports into a real engine for rendering
    const guestEngine = new CardinalUnoEngine('Pilgrim', 4);
    expect(importTableSnapshot(guestEngine, view).isSuccess()).toBe(true);
    expect(guestEngine.state.players[1]!.hand.length).toBe(guestHand.length);
  });

  it('Skip-Bo: hides hands and piles but keeps each stockpile’s top card public', () => {
    const skipbo = new SkipBoEngine('Pilgrim', 'Abbot', 15, undefined, 3);
    const full = snapshotOf(skipbo);
    const pub = HIDDEN_INFO_POLICIES.skipbo!.redact(full);
    const player = (pub.state as any).players[0];
    const realStock = skipbo.state.players[0]!.stockpile;
    expect(player.stockpile.length).toBe(realStock.length);
    expect(player.stockpile.at(-1)).toEqual(JSON.parse(JSON.stringify(realStock.at(-1))));
    expect(player.stockpile[0]).toEqual(HIDDEN_CARD);
    expect(player.hand.every((c: any) => c.hidden)).toBe(true);
    expect((pub.state as any).drawPile.every((c: any) => c.hidden)).toBe(true);
  });

  it('Phase 10 and SET: hide hands and the deck order', () => {
    const p10 = new Phase10Engine('Pilgrim', 'Prior', undefined, 3);
    const p10Pub = HIDDEN_INFO_POLICIES.phase10!.redact(snapshotOf(p10));
    expect((p10Pub.state as any).players.every((p: any) => p.hand.every((c: any) => c.hidden))).toBe(true);
    expect((p10Pub.state as any).discardPile.length).toBe(p10.state.discardPile.length);

    const set = new SetEngine(3, 'You');
    const setFull = snapshotOf(set);
    const setPub = HIDDEN_INFO_POLICIES.set!.redact(setFull);
    expect((setPub.state as any).deck.length).toBe(set.state.deck.length);
    expect((setPub.state as any).deck.every((c: any) => c.hidden)).toBe(true);
    expect((setPub.state as any).tableCards).toEqual(JSON.parse(JSON.stringify(set.state.tableCards)));
    expect(HIDDEN_INFO_POLICIES.set!.secretsFor(setFull, 'p1')).toEqual({});
  });

  it('Avalon: hides roles and open votes until the game is settled', () => {
    const avalon = new AvalonEngine('Percival', 5);
    const policy = HIDDEN_INFO_POLICIES.avalon!;
    const full = snapshotOf(avalon);
    const pub = policy.redact(full);
    expect((pub.state as any).players.every((p: any) => p.role === HIDDEN_TEXT && p.alignment === HIDDEN_TEXT)).toBe(true);
    expect((pub.seats as any[]).filter(s => s.extraData?.role).every(s => s.extraData.role === HIDDEN_TEXT)).toBe(true);

    const secrets = policy.secretsFor(full, 'p2');
    expect(secrets).toEqual({ role: avalon.state.players[1]!.role, alignment: avalon.state.players[1]!.alignment });
    const view = policy.reveal(pub, 'p2', secrets);
    expect((view.state as any).players[1].role).toBe(avalon.state.players[1]!.role);
    expect((view.state as any).players[0].role).toBe(HIDDEN_TEXT);

    const team = avalon.state.players.slice(0, avalon.getCurrentQuest().teamSize).map(p => p.id);
    avalon.proposeTeam(team);
    avalon.castVote('p1', false);
    const voting = policy.redact(snapshotOf(avalon));
    expect((voting.state as any).quests[0].votes).toEqual({ p1: null });

    avalon.state.stage = 'settled';
    const settled = snapshotOf(avalon);
    expect(policy.redact(settled)).toEqual(settled);
  });

  it('Poker: hides hole cards and the shoe until showdown', () => {
    const poker = new CathedralPokerEngine(PokerVariantEnum.TexasHoldem, 4, 10, 20);
    poker.populateBotOpponents();
    poker.startHand();
    const full = snapshotOf(poker, poker.exportShoe());
    const policy = HIDDEN_INFO_POLICIES.poker!;
    const pub = policy.redact(full);
    const seats = pub.seats as any[];
    expect(seats.every(s => !s.extraData?.holeCards?.length || s.extraData.holeCards.every((c: any) => c.hidden))).toBe(true);
    expect((pub.extras as any).game).toBeNull();
    expect((pub.extras as any).owners).toEqual({});

    const seat1 = (full.seats as any[]).find(s => s.seatNumber === 1);
    const secrets = policy.secretsFor(full, '1');
    expect(secrets).toEqual({ holeCards: seat1.extraData.holeCards });
    const view = policy.reveal(pub, '1', secrets);
    expect((view.seats as any[]).find(s => s.seatNumber === 1).extraData.holeCards).toEqual(seat1.extraData.holeCards);
    expect(policy.reveal(pub, '1', {}).seats).toBeDefined();
    expect(policy.secretsFor(full, '99')).toEqual({});

    (full.state as any).stage = 'showdown';
    expect(policy.redact(full)).toEqual(full);
  });

  it('Blackjack: hides the shoe and the dealer hole card, keeps face-up cards public', () => {
    const single = new BlackjackEngine(500, 'micro-neural', 'balanced');
    const multi = new BlackjackMultiSeatEngine(3, 10, 500);
    multi.seatManager.claimSeat(1, 'p1', 'Host');
    multi.populateBotOpponents();
    multi.startRound();
    const engine: SnapshotableEngine = {
      state: { single: single.state, multi: multi.state },
      seatManager: multi.seatManager
    };
    const full = snapshotOf(engine);
    const pub = HIDDEN_INFO_POLICIES.blackjack!.redact(full);
    const dealer = (pub.state as any).multi.dealerHand;
    const realDealer = multi.state.dealerHand;
    expect(dealer[0]).toEqual(JSON.parse(JSON.stringify(realDealer[0])));
    expect(dealer[1]).toEqual(HIDDEN_CARD);
    expect((pub.state as any).multi.shoe.every((c: any) => c.hidden)).toBe(true);
    expect(JSON.stringify(pub)).not.toContain(cardKey(realDealer[1]));
    expect(HIDDEN_INFO_POLICIES.blackjack!.secretsFor(full, '1')).toEqual({});
  });

  it('tolerates snapshots without players or seats', () => {
    const empty: ArcadeTableSnapshot = { version: 1, state: {}, seats: 'none', extras: null };
    const policy = playerListPolicy({ privateFields: ['hand'] });
    expect(policy.redact(empty).state).toEqual({});
    expect(policy.reveal(empty, 'p1', { hand: [] }).state).toEqual({});
    expect(HIDDEN_INFO_POLICIES.poker!.redact({ ...empty, extras: null }).extras).toBeNull();
    expect(HIDDEN_INFO_POLICIES.blackjack!.redact(empty).state).toEqual({});
  });
});
