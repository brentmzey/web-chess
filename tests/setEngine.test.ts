import { describe, expect, it } from 'bun:test';
import {
  computeCompletingCardVector,
  createSetDeck,
  explainSetFailure,
  findAllSetsOnTable,
  isValidSet,
  SetEngine
} from '../src/games/set/setEngine';

describe('Sacred Geometry SET Engine (GF(3)^4 Finite Geometry Rules)', () => {
  it('generates the exact 81 unique cards of AG(4, 3)', () => {
    const deck = createSetDeck();
    expect(deck.length).toBe(81);

    const uniqueIds = new Set(deck.map(c => c.id));
    expect(uniqueIds.size).toBe(81);

    const uniqueVectors = new Set(deck.map(c => c.vector.join(',')));
    expect(uniqueVectors.size).toBe(81);
  });

  it('verifies GF(3)^4 collinearity and unique third-card completion across the deck', () => {
    const deck = createSetDeck();
    const byVec = new Map(deck.map(c => [c.vector.join(','), c]));

    // Pick several pairs of distinct cards and verify unique 3rd card forms a valid SET
    for (let i = 0; i < 15; i++) {
      const cardA = deck[i]!;
      const cardB = deck[80 - i]!;
      const targetVec = computeCompletingCardVector(cardA, cardB);
      const cardC = byVec.get(targetVec.join(','))!;

      expect(cardC).toBeDefined();
      expect(isValidSet(cardA, cardB, cardC)).toBe(true);
      expect(explainSetFailure(cardA, cardB, cardC).isNone()).toBe(true);

      // Duplicate card is never a valid set
      expect(isValidSet(cardA, cardA, cardB)).toBe(false);
      expect(explainSetFailure(cardA, cardA, cardB).getOrElse('')).toContain('3 distinct cards');
    }

    // Verify an invalid triple is rejected with a clear explanation
    const c0 = deck[0]!; // [0,0,0,0]
    const c1 = deck[1]!; // [0,0,0,1]
    const c3 = deck[3]!; // [0,0,1,0] -> sum mod 3 = [0, 0, 1, 1] != 0
    expect(isValidSet(c0, c1, c3)).toBe(false);
    const reason = explainSetFailure(c0, c1, c3).getOrThrow();
    expect(reason).toContain('Shading');
    expect(reason).toContain('Color');
  });

  it('initializes with 12 table cards, 69 deck cards, and supports up to 20 players', () => {
    const engine = new SetEngine(6, 'Euclid');
    expect(engine.state.players.length).toBe(6);
    expect(engine.state.players[0]!.name).toBe('Euclid');
    expect(engine.state.players[0]!.isBot).toBe(false);
    expect(engine.state.players[1]!.isBot).toBe(true);
    expect(engine.state.tableCards.length).toBe(12);
    expect(engine.state.deck.length).toBe(69);

    // Clamp to max 20 players
    const largeEngine = new SetEngine(35, 'Host');
    expect(largeEngine.state.players.length).toBe(20);
  });

  it('allows claiming valid SETs, penalizes invalid SETs, and replenishes table to 12 cards', () => {
    const engine = new SetEngine(2, 'Hypatia');
    const deck = createSetDeck();

    // Force a known valid SET at indices 0, 1, 2: [0,0,0,0], [0,0,0,1], [0,0,0,2]
    engine.state.tableCards[0] = deck[0]!;
    engine.state.tableCards[1] = deck[1]!;
    engine.state.tableCards[2] = deck[2]!;
    engine.state.tableCards[3] = deck[3]!;

    expect(engine.getAvailableSets().length).toBeGreaterThanOrEqual(1);
    expect(engine.getHintCardIndex().isSome()).toBe(true);

    // Invalid player ID
    expect(engine.claimSet('unknown', [0, 1, 2]).isFailure()).toBe(true);

    // Invalid card indices
    expect(engine.claimSet('p1', [0, 0, 2]).isFailure()).toBe(true);
    expect(engine.claimSet('p1', [-1, 1, 2]).isFailure()).toBe(true);

    // False SET call -> penalty
    const badRes = engine.claimSet('p1', [0, 1, 3]);
    expect(badRes.isFailure()).toBe(true);
    expect(engine.state.players[0]!.penalties).toBe(1);

    // Valid SET call -> +1 score and replenished back to 12 cards
    const goodRes = engine.claimSet('p1', [0, 1, 2]);
    expect(goodRes.isSuccess()).toBe(true);
    expect(engine.state.players[0]!.score).toBe(1);
    expect(engine.state.players[0]!.setsFound).toBe(1);
    expect(engine.state.claimedSetsCount).toBe(1);
    expect(engine.state.tableCards.length).toBe(12);
    expect(engine.state.deck.length).toBe(66);
  });

  it('deals 3 more cards up to the 21-card Cap Set Theorem limit and runs AI turns to completion', () => {
    const engine = new SetEngine(2, 'Galois');

    // Deal 3 more cards 3 times: 12 -> 15 -> 18 -> 21
    expect(engine.dealThreeMoreCards().isSuccess()).toBe(true);
    expect(engine.state.tableCards.length).toBe(15);
    expect(engine.dealThreeMoreCards().isSuccess()).toBe(true);
    expect(engine.state.tableCards.length).toBe(18);
    expect(engine.dealThreeMoreCards().isSuccess()).toBe(true);
    expect(engine.state.tableCards.length).toBe(21);

    // At 21 cards, dealing more is blocked because a SET is mathematically guaranteed
    expect(engine.dealThreeMoreCards().isFailure()).toBe(true);

    // AI Bot turn claims a SET from the 21 cards (guaranteed by Cap Set Theorem!)
    const aiRes = engine.executeAiTurn('p2');
    expect(aiRes.isSuccess()).toBe(true);
    expect(engine.state.players[1]!.setsFound).toBe(1);
    expect(engine.state.tableCards.length).toBe(18);

    // Now test end-of-game detection when deck is empty and no sets exist on table
    const fullDeck = createSetDeck();
    engine.state.deck = [];
    // Place only 2 cards on table so no 3-card SET can exist
    engine.state.tableCards = [fullDeck[0]!, fullDeck[1]!];

    expect(findAllSetsOnTable(engine.state.tableCards).length).toBe(0);
    const endDeal = engine.dealThreeMoreCards();
    expect(endDeal.isFailure()).toBe(true);
    expect(engine.state.isGameOver).toBe(true);
    expect(engine.state.winner.isSome()).toBe(true);

    // Further actions after game over return failure
    expect(engine.claimSet('p1', [0, 1, 2]).isFailure()).toBe(true);
    expect(engine.dealThreeMoreCards().isFailure()).toBe(true);
    expect(engine.executeAiTurn().isFailure()).toBe(true);
  });

  it('handles AI turn when no SET is currently on the 12-card table by dealing 3 more cards', () => {
    const engine = new SetEngine(2, 'Fano');
    const fullDeck = createSetDeck();
    // Place only 2 cards on table so 0 sets exist, while deck still has cards
    engine.state.tableCards = [fullDeck[0]!, fullDeck[1]!];
    const aiDealRes = engine.executeAiTurn();
    expect(aiDealRes.isSuccess()).toBe(true);
    expect(engine.state.tableCards.length).toBe(5);

    // When deck is empty and no sets on table, executeAiTurn concludes the game
    engine.state.deck = [];
    engine.state.tableCards = [fullDeck[0]!, fullDeck[1]!];
    const aiEndRes = engine.executeAiTurn();
    expect(aiEndRes.isFailure()).toBe(true);
    expect(engine.state.isGameOver).toBe(true);
  });

  it('adds, claims, and vacates up to 20 players in Sacred Geometry SET', () => {
    const engine = new SetEngine(18, 'Euclid');
    expect(engine.state.players.length).toBe(18);

    expect(engine.addPlayer('Noether', false).isSuccess()).toBe(true);
    expect(engine.addPlayer('Hilbert Bot', true).isSuccess()).toBe(true);
    expect(engine.state.players.length).toBe(20);
    expect(engine.addPlayer('Overflow 21', false).isFailure()).toBe(true);

    engine.state.players[1]!.score = 4;
    engine.state.players[1]!.setsFound = 4;
    expect(engine.claimSeatForHuman(1, 'Riemann').isSuccess()).toBe(true);
    expect(engine.state.players[1]!.isBot).toBe(false);
    expect(engine.state.players[1]!.score).toBe(0);
    expect(engine.state.players[1]!.setsFound).toBe(0);
    // Re-claiming a human seat (e.g. after a reload) keeps the earned score
    engine.state.players[1]!.score = 2;
    expect(engine.claimSeatForHuman(1, 'Riemann').isSuccess()).toBe(true);
    expect(engine.state.players[1]!.score).toBe(2);
    expect(engine.claimSeatForHuman(99, 'Invalid').isFailure()).toBe(true);

    expect(engine.vacatePlayerSeat('p2', 'Geometer Bot').isSuccess()).toBe(true);
    expect(engine.state.players[1]!.isBot).toBe(true);
    expect(engine.vacatePlayerSeat('unknown').isFailure()).toBe(true);
  });
});
