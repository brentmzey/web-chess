import { describe, it, expect } from 'bun:test';
import {
  SkipBoEngine,
  createSkipBoDeck,
  SkipBoCard
} from '../src/games/skipbo/skipboEngine';
import {
  SkipBoCardTypeEnum,
  SkipBoSourcePileEnum
} from '../src/constants/gameEnums';

describe('SkipBoEngine - Rules, Building Piles, and AI Auto-Play', () => {
  it('creates full 162-card standard deck (144 numbers + 18 wilds)', () => {
    const deck = createSkipBoDeck();
    expect(deck.length).toBe(162);

    const wilds = deck.filter(c => c.type === SkipBoCardTypeEnum.Wild);
    const numbers = deck.filter(c => c.type === SkipBoCardTypeEnum.Number);

    expect(wilds.length).toBe(18);
    expect(numbers.length).toBe(144);
  });

  it('initializes game with stockpiles, hands, and building piles', () => {
    const engine = new SkipBoEngine('Alice', 'Bob', 15);
    expect(engine.state.players.length).toBe(2);
    expect(engine.state.players[0]!.stockpile.length).toBe(15);
    expect(engine.state.players[1]!.stockpile.length).toBe(15);
    expect(engine.state.players[0]!.hand.length).toBe(5);
    expect(engine.state.buildingPiles.length).toBe(4);
    expect(engine.state.isGameOver).toBe(false);
  });

  it('validates building rules: only 1 or Wild on empty pile, consecutive ascending order up to 12', () => {
    const engine = new SkipBoEngine('Alice', 'Bob', 10);
    const card1: SkipBoCard = { id: 'c1', type: SkipBoCardTypeEnum.Number, value: 1 };
    const card2: SkipBoCard = { id: 'c2', type: SkipBoCardTypeEnum.Number, value: 2 };
    const card5: SkipBoCard = { id: 'c5', type: SkipBoCardTypeEnum.Number, value: 5 };
    const wild: SkipBoCard = { id: 'cw', type: SkipBoCardTypeEnum.Wild, value: 0 };

    expect(engine.canPlayOnBuilding(card1, 0)).toBe(true);
    expect(engine.canPlayOnBuilding(wild, 0)).toBe(true);
    expect(engine.canPlayOnBuilding(card2, 0)).toBe(false);
    expect(engine.canPlayOnBuilding(card5, 0)).toBe(false);

    // Place card1 on pile 0
    engine.state.buildingPiles[0] = [card1];
    expect(engine.canPlayOnBuilding(card2, 0)).toBe(true);
    expect(engine.canPlayOnBuilding(wild, 0)).toBe(true);
    expect(engine.canPlayOnBuilding(card1, 0)).toBe(false);
  });

  it('plays card to building pile from hand, stockpile, and discard', () => {
    const engine = new SkipBoEngine('Alice', 'Bob', 5);
    const card1: SkipBoCard = { id: 'c1', type: SkipBoCardTypeEnum.Number, value: 1 };
    const p1 = engine.getCurrentPlayer();
    p1.hand = [card1];

    const playRes = engine.playToBuilding(SkipBoSourcePileEnum.Hand, 0, 0);
    expect(playRes.isSuccess()).toBe(true);
    expect(engine.state.buildingPiles[0]?.length).toBe(1);

    // Hand was emptied, so it refilled up to 5!
    expect(p1.hand.length).toBe(5);
  });

  it('discards card to discard pile and passes turn to next player', () => {
    const engine = new SkipBoEngine('Alice', 'Bob', 5);
    const p1 = engine.getCurrentPlayer();
    const initialHandLen = p1.hand.length;

    const res = engine.discardAndEndTurn(0, 0);
    expect(res.isSuccess()).toBe(true);
    expect(p1.discardPiles[0]?.length).toBe(1);
    expect(p1.hand.length).toBe(initialHandLen - 1);

    // Turn transitioned to player 2 (Bob)
    expect(engine.getCurrentPlayer().name).toBe('Bob');
    // Bob should have drawn up to 5 cards
    expect(engine.getCurrentPlayer().hand.length).toBe(5);
  });

  it('triggers game victory when stockpile is exhausted', () => {
    const engine = new SkipBoEngine('Alice', 'Bob', 1);
    const winningCard: SkipBoCard = { id: 'w1', type: SkipBoCardTypeEnum.Number, value: 1 };
    const p1 = engine.getCurrentPlayer();
    p1.stockpile = [winningCard];

    const res = engine.playToBuilding(SkipBoSourcePileEnum.Stockpile, 0, 0);
    expect(res.isSuccess()).toBe(true);
    expect(engine.state.isGameOver).toBe(true);
    expect(engine.state.winner.getOrThrow()).toBe('p1');
  });

  it('clears completed building pile when reaching 12', () => {
    const engine = new SkipBoEngine('Alice', 'Bob', 5);
    // Fill pile 0 with 11 cards
    const pile11: SkipBoCard[] = [];
    for (let i = 1; i <= 11; i++) {
      pile11.push({ id: `c-${i}`, type: SkipBoCardTypeEnum.Number, value: i });
    }
    engine.state.buildingPiles[0] = pile11;

    const card12: SkipBoCard = { id: 'c12', type: SkipBoCardTypeEnum.Number, value: 12 };
    engine.getCurrentPlayer().hand = [card12];

    const res = engine.playToBuilding(SkipBoSourcePileEnum.Hand, 0, 0);
    expect(res.isSuccess()).toBe(true);

    // Building pile 0 should now be cleared
    expect(engine.state.buildingPiles[0]?.length).toBe(0);
    // Recycle pile should have 12 cards
    expect(engine.state.recyclePile.length).toBe(12);
  });

  it('runs autonomous bot turn solver', () => {
    const engine = new SkipBoEngine('Alice', 'Cathedral Bot', 5);
    // Move turn to bot
    engine.state.currentTurnIndex = 1;
    const bot = engine.getCurrentPlayer();
    engine.refillHand(bot);

    const logs = engine.autoPlayBotTurn();
    expect(logs.length).toBeGreaterThan(0);
  });

  it('handles error bounds for playing, discarding, and recycling', () => {
    const engine = new SkipBoEngine('Alice', 'Bob', 5);
    expect(engine.getOpponentPlayer().name).toBe('Bob');

    // Invalid building pile target
    expect(engine.playToBuilding(SkipBoSourcePileEnum.Hand, 0, -1).isFailure()).toBe(true);
    expect(engine.playToBuilding(SkipBoSourcePileEnum.Hand, 0, 5).isFailure()).toBe(true);
    expect(engine.canPlayOnBuilding({ id: 'c1', type: SkipBoCardTypeEnum.Number, value: 1 }, 99)).toBe(false);

    // Invalid hand index
    expect(engine.playToBuilding(SkipBoSourcePileEnum.Hand, 99, 0).isFailure()).toBe(true);

    // Empty discard pile
    expect(engine.playToBuilding(SkipBoSourcePileEnum.Discard, 0, 0).isFailure()).toBe(true);

    // Invalid discard action parameters
    expect(engine.discardAndEndTurn(0, -1).isFailure()).toBe(true);
    expect(engine.discardAndEndTurn(0, 5).isFailure()).toBe(true);
    expect(engine.discardAndEndTurn(99, 0).isFailure()).toBe(true);

    // Play from discard pile after placing card there
    const p1 = engine.getCurrentPlayer();
    p1.discardPiles[0] = [{ id: 'd1', type: SkipBoCardTypeEnum.Number, value: 1 }];
    const playDiscRes = engine.playToBuilding(SkipBoSourcePileEnum.Discard, 0, 0);
    expect(playDiscRes.isSuccess()).toBe(true);
    expect(p1.discardPiles[0].length).toBe(0);

    // Recycle draw pile when empty
    engine.state.drawPile = [];
    engine.state.recyclePile = [
      { id: 'r1', type: SkipBoCardTypeEnum.Number, value: 3 },
      { id: 'r2', type: SkipBoCardTypeEnum.Number, value: 4 }
    ];
    p1.hand = [];
    engine.refillHand(p1);
    expect(engine.state.drawPile.length).toBeGreaterThanOrEqual(0);
    expect(p1.hand.length).toBe(2);

    // Action when game is over returns failure
    engine.state.isGameOver = true;
    expect(engine.playToBuilding(SkipBoSourcePileEnum.Hand, 0, 0).isFailure()).toBe(true);
    expect(engine.discardAndEndTurn(0, 0).isFailure()).toBe(true);
  });

  it('covers bot playing sequentially from stockpile, hand, and discard piles', () => {
    const engine = new SkipBoEngine('Alice', 'Bot', 2);
    const bot = engine.state.players[1]!;
    engine.state.currentTurnIndex = 1;

    // Building pile 0 has 1
    engine.state.buildingPiles[0] = [{ id: 'b1', type: SkipBoCardTypeEnum.Number, value: 1 }];
    // Bot stockpile top has 2 (and 1 more card underneath so game doesn't immediately end)
    bot.stockpile = [
      { id: 'sUnder', type: SkipBoCardTypeEnum.Number, value: 10 },
      { id: 's2', type: SkipBoCardTypeEnum.Number, value: 2 }
    ];
    // Bot hand has 3 and a 9 for discard
    bot.hand = [
      { id: 'h3', type: SkipBoCardTypeEnum.Number, value: 3 },
      { id: 'h9', type: SkipBoCardTypeEnum.Number, value: 9 }
    ];
    // Bot discard pile has 4
    bot.discardPiles[0] = [{ id: 'd4', type: SkipBoCardTypeEnum.Number, value: 4 }];

    const logs = engine.autoPlayBotTurn();
    expect(logs.length).toBeGreaterThan(0);
  });
});
