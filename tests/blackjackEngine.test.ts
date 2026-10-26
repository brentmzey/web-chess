import { describe, expect, it } from 'bun:test';
import {
  BlackjackEngine,
  createShoe,
  evaluateHand,
  formatCard,
  getAvailableBlackjackAI,
  type PlayingCard
} from '../src/games/blackjack/blackjackEngine';
import { DeviceTierEnum } from '../src/types';

describe('Gothic Blackjack Engine & Dealer AI Opponent Logic', () => {
  it('creates and shuffles multi-deck shoe correctly', () => {
    const shoe1 = createShoe(1);
    expect(shoe1.length).toBe(52);

    const shoe2 = createShoe(2);
    expect(shoe2.length).toBe(104);

    const aces = shoe2.filter(c => c.value === 'A');
    expect(aces.length).toBe(8);
  });

  it('evaluates hand totals, soft aces, blackjack, and bust states', () => {
    // Natural Blackjack: Ace + King
    const bjCards: PlayingCard[] = [
      { suit: 'spades', value: 'A', faceUp: true },
      { suit: 'clubs', value: 'K', faceUp: true }
    ];
    const bjEval = evaluateHand(bjCards);
    expect(bjEval.total).toBe(21);
    expect(bjEval.isBlackjack).toBe(true);
    expect(bjEval.isBusted).toBe(false);

    // Soft 17: Ace + 6
    const softCards: PlayingCard[] = [
      { suit: 'hearts', value: 'A', faceUp: true },
      { suit: 'diamonds', value: '6', faceUp: true }
    ];
    const softEval = evaluateHand(softCards);
    expect(softEval.total).toBe(17);
    expect(softEval.isSoft).toBe(true);

    // Hard 17 with converted Ace: Ace + 6 + 10 = 17
    const hardCards: PlayingCard[] = [
      { suit: 'hearts', value: 'A', faceUp: true },
      { suit: 'diamonds', value: '6', faceUp: true },
      { suit: 'spades', value: '10', faceUp: true }
    ];
    const hardEval = evaluateHand(hardCards);
    expect(hardEval.total).toBe(17);
    expect(hardEval.isSoft).toBe(false);

    // Bust: 10 + 8 + 5 = 23
    const bustCards: PlayingCard[] = [
      { suit: 'spades', value: '10', faceUp: true },
      { suit: 'hearts', value: '8', faceUp: true },
      { suit: 'clubs', value: '5', faceUp: true }
    ];
    const bustEval = evaluateHand(bustCards);
    expect(bustEval.total).toBe(23);
    expect(bustEval.isBusted).toBe(true);

    // Ignore face down cards when requested
    const hiddenCards: PlayingCard[] = [
      { suit: 'hearts', value: '10', faceUp: true },
      { suit: 'spades', value: '9', faceUp: false }
    ];
    expect(evaluateHand(hiddenCards, true).total).toBe(10);
  });

  it('formats playing cards for cathedral UI', () => {
    expect(formatCard({ suit: 'spades', value: 'A', faceUp: true })).toBe('A♠');
    expect(formatCard({ suit: 'hearts', value: 'K', faceUp: true })).toBe('K♥');
    expect(formatCard({ suit: 'diamonds', value: '10', faceUp: true })).toBe('10♦');
    expect(formatCard({ suit: 'clubs', value: '7', faceUp: true })).toBe('7♣');
    expect(formatCard({ suit: 'spades', value: 'Q', faceUp: false })).toBe('🂠 Hidden');
  });

  it('filters available AI models by device tier', () => {
    const desktopAI = getAvailableBlackjackAI(DeviceTierEnum.Desktop);
    expect(desktopAI).toContain('gemini-nano');
    expect(desktopAI).toContain('micro-neural');
    expect(desktopAI).toContain('minimax');

    const mobileAI = getAvailableBlackjackAI(DeviceTierEnum.MobileLite);
    expect(mobileAI).not.toContain('gemini-nano');
    expect(mobileAI).toContain('micro-neural');
    expect(mobileAI).toContain('minimax');
  });

  it('executes complete Blackjack betting and hand lifecycle', () => {
    const engine = new BlackjackEngine(500, 'micro-neural', 'balanced');
    expect(engine.state.chipBank).toBe(500);

    // Place valid bet
    expect(engine.placeBet(50)).toBe(true);
    expect(engine.state.currentBet).toBe(50);

    // Invalid bet rejects
    expect(engine.placeBet(-10)).toBe(false);
    expect(engine.placeBet(9999)).toBe(false);

    // Calibrate AI and difficulty
    engine.setAIModel('minimax');
    expect(engine.state.aiModel).toBe('minimax');
    engine.setDifficulty('ruthless');
    expect(engine.state.difficulty).toBe('ruthless');

    // Start round
    expect(engine.startRound()).toBe(true);
    expect(engine.state.playerHand.length).toBe(2);
    expect(engine.state.dealerHand.length).toBe(2);
    expect(engine.state.dealerHand[1]?.faceUp).toBe(false);

    // If game didn't end in natural blackjack, test hit & stand
    if (engine.state.stage === 'player-turn') {
      const initialTotal = evaluateHand(engine.state.playerHand).total;
      if (initialTotal < 12) {
        engine.hit();
        expect(engine.state.playerHand.length).toBe(3);
      }
      engine.stand();
      expect(engine.state.stage as string).toBe('round-over');
      expect(engine.state.dealerHand.every(c => c.faceUp)).toBe(true);
    }
  });

  it('handles double down rules and chip deductions', () => {
    const engine = new BlackjackEngine(500, 'minimax', 'cautious');
    engine.placeBet(25);
    engine.startRound();

    if (engine.state.stage === 'player-turn') {
      const ddResult = engine.doubleDown();
      expect(ddResult).toBe(true);
      expect(engine.state.currentBet).toBe(50);
      expect(engine.state.playerHand.length).toBe(3);
      expect(engine.state.stage as string).toBe('round-over');
    }
  });

  it('reshuffles shoe when remaining cards drops below 15', () => {
    const engine = new BlackjackEngine(500, 'minimax', 'balanced');
    engine.placeBet(50);
    engine.state.shoe = [
      { suit: 'hearts', value: '10', faceUp: true },
      { suit: 'diamonds', value: '9', faceUp: true },
      { suit: 'spades', value: '8', faceUp: true }
    ];
    expect(engine.state.shoe.length).toBe(3);
    const started = engine.startRound();
    expect(started).toBe(true);
    expect(engine.state.shoe.length).toBeGreaterThan(50);
    expect(engine.state.historyText).toContain('Shoe reshuffled with fresh consecrated decks.');
  });

  const makeShoeWithCards = (dealOrder: {
    player1: PlayingCard;
    player2: PlayingCard;
    dealerFirst: PlayingCard;
    dealerHole: PlayingCard;
    nextCards?: PlayingCard[];
  }): PlayingCard[] => {
    const base: PlayingCard[] = Array.from({ length: 20 }, () => ({
      suit: 'clubs',
      value: '2',
      faceUp: true
    }));
    const reversedNext = (dealOrder.nextCards ?? []).slice().reverse();
    return [
      ...base,
      ...reversedNext,
      dealOrder.dealerHole,
      dealOrder.dealerFirst,
      dealOrder.player2,
      dealOrder.player1
    ];
  };

  it('evaluates Natural Blackjack payouts and mutual pushes accurately', () => {
    // Solo Player Natural Blackjack (3:2 payout)
    const soloBJ = new BlackjackEngine(500, 'minimax', 'balanced');
    soloBJ.placeBet(100);
    soloBJ.state.shoe = makeShoeWithCards({
      player1: { suit: 'spades', value: 'A', faceUp: true },
      player2: { suit: 'diamonds', value: '10', faceUp: true },
      dealerFirst: { suit: 'hearts', value: '10', faceUp: true },
      dealerHole: { suit: 'spades', value: '5', faceUp: true }
    });
    soloBJ.startRound();
    expect(soloBJ.state.outcome).toBe('player-blackjack');
    expect(soloBJ.state.stage).toBe('round-over');
    expect(soloBJ.state.chipBank).toBe(650); // 500 - 100 + 250
    expect(soloBJ.state.historyText.some(t => t.includes('Sanctuary Natural 21'))).toBe(true);

    // Mutual Natural Blackjack Push
    const mutualBJ = new BlackjackEngine(500, 'minimax', 'balanced');
    mutualBJ.placeBet(100);
    mutualBJ.state.shoe = makeShoeWithCards({
      player1: { suit: 'hearts', value: 'A', faceUp: true },
      player2: { suit: 'hearts', value: 'Q', faceUp: true },
      dealerFirst: { suit: 'clubs', value: 'A', faceUp: true },
      dealerHole: { suit: 'clubs', value: 'K', faceUp: true }
    });
    mutualBJ.startRound();
    expect(mutualBJ.state.outcome).toBe('push');
    expect(mutualBJ.state.stage).toBe('round-over');
    expect(mutualBJ.state.chipBank).toBe(500); // 500 - 100 + 100 refund
    expect(mutualBJ.state.historyText).toContain('Mutual Natural Blackjack! A divine push.');
  });

  it('handles player hits: normal draw, hitting 21, bust, and non-turn guards', () => {
    const engine = new BlackjackEngine(500, 'minimax', 'balanced');
    engine.placeBet(50);
    // Draw 9 and 7 (= 16), then hit 5 (= 21)
    engine.state.shoe = makeShoeWithCards({
      player1: { suit: 'clubs', value: '9', faceUp: true },
      player2: { suit: 'clubs', value: '7', faceUp: true },
      dealerFirst: { suit: 'hearts', value: '10', faceUp: true },
      dealerHole: { suit: 'spades', value: '5', faceUp: true },
      nextCards: [{ suit: 'diamonds', value: '5', faceUp: true }]
    });
    engine.startRound();
    expect(engine.state.stage).toBe('player-turn');

    const eval21 = engine.hit();
    expect(eval21.total).toBe(21);
    expect(engine.state.stage).toBe('round-over'); // auto-stands on 21

    // Hitting when stage is round-over returns player hand without changes
    const lenBefore = engine.state.playerHand.length;
    const noOpEval = engine.hit();
    expect(engine.state.playerHand.length).toBe(lenBefore);
    expect(noOpEval.total).toBe(21);

    // Busting on hit
    const bustEngine = new BlackjackEngine(500, 'minimax', 'balanced');
    bustEngine.placeBet(50);
    bustEngine.state.shoe = makeShoeWithCards({
      player1: { suit: 'clubs', value: '10', faceUp: true },
      player2: { suit: 'clubs', value: '6', faceUp: true },
      dealerFirst: { suit: 'hearts', value: '10', faceUp: true },
      dealerHole: { suit: 'spades', value: '2', faceUp: true },
      nextCards: [{ suit: 'diamonds', value: '10', faceUp: true }]
    });
    bustEngine.startRound();
    const bustEval = bustEngine.hit();
    expect(bustEval.isBusted).toBe(true);
    expect(bustEngine.state.stage).toBe('round-over');
    expect(bustEngine.state.outcome).toBe('player-busted');
  });

  it('handles double down validations and double down bust', () => {
    const engine = new BlackjackEngine(100, 'minimax', 'balanced');
    engine.placeBet(80); // Bank has 20 left

    // Cannot double down if bank < currentBet
    engine.state.shoe = makeShoeWithCards({
      player1: { suit: 'clubs', value: '5', faceUp: true },
      player2: { suit: 'clubs', value: '5', faceUp: true },
      dealerFirst: { suit: 'hearts', value: '10', faceUp: true },
      dealerHole: { suit: 'spades', value: '2', faceUp: true }
    });
    engine.startRound();
    expect(engine.doubleDown()).toBe(false);

    // Cannot double down if hand length !== 2
    const engine3Cards = new BlackjackEngine(500, 'minimax', 'balanced');
    engine3Cards.placeBet(50);
    engine3Cards.state.shoe = makeShoeWithCards({
      player1: { suit: 'clubs', value: '3', faceUp: true },
      player2: { suit: 'clubs', value: '3', faceUp: true },
      dealerFirst: { suit: 'hearts', value: '10', faceUp: true },
      dealerHole: { suit: 'spades', value: '2', faceUp: true },
      nextCards: [{ suit: 'diamonds', value: '2', faceUp: true }]
    });
    engine3Cards.startRound();
    engine3Cards.hit();
    expect(engine3Cards.state.playerHand.length).toBe(3);
    expect(engine3Cards.doubleDown()).toBe(false);

    // Busting on double down
    const bustDouble = new BlackjackEngine(500, 'minimax', 'balanced');
    bustDouble.placeBet(50);
    bustDouble.state.shoe = makeShoeWithCards({
      player1: { suit: 'clubs', value: '10', faceUp: true },
      player2: { suit: 'clubs', value: '6', faceUp: true },
      dealerFirst: { suit: 'hearts', value: '10', faceUp: true },
      dealerHole: { suit: 'spades', value: '2', faceUp: true },
      nextCards: [{ suit: 'diamonds', value: '10', faceUp: true }]
    });
    bustDouble.startRound();
    expect(bustDouble.doubleDown()).toBe(true);
    expect(bustDouble.state.outcome).toBe('player-busted');
    expect(bustDouble.state.stage).toBe('round-over');
  });

  it('tests dealer AI thresholds and round outcomes: dealer bust, player win, dealer win, and push', () => {
    // Cannot start round if bet > chipBank
    const brokeEngine = new BlackjackEngine(10, 'minimax', 'balanced');
    brokeEngine.placeBet(10);
    brokeEngine.state.chipBank = 5;
    expect(brokeEngine.startRound()).toBe(false);

    // Dealer busts: dealer has 16 (cautious AI stops at 16, ruthless draws to 18 and busts)
    const dealerBustEngine = new BlackjackEngine(500, 'minimax', 'ruthless');
    dealerBustEngine.placeBet(50);
    dealerBustEngine.state.shoe = makeShoeWithCards({
      player1: { suit: 'clubs', value: '10', faceUp: true },
      player2: { suit: 'clubs', value: '9', faceUp: true },
      dealerFirst: { suit: 'hearts', value: '10', faceUp: true },
      dealerHole: { suit: 'spades', value: '6', faceUp: true },
      nextCards: [{ suit: 'diamonds', value: '10', faceUp: true }]
    });
    dealerBustEngine.startRound();
    dealerBustEngine.stand();
    expect(dealerBustEngine.state.outcome).toBe('dealer-busted');
    expect(dealerBustEngine.state.chipBank).toBe(550);

    // Player wins: Player 20 vs Dealer 17 (cautious stops at 16, so 17 stands)
    const playerWinEngine = new BlackjackEngine(500, 'minimax', 'cautious');
    playerWinEngine.placeBet(50);
    playerWinEngine.state.shoe = makeShoeWithCards({
      player1: { suit: 'clubs', value: '10', faceUp: true },
      player2: { suit: 'clubs', value: '10', faceUp: true },
      dealerFirst: { suit: 'hearts', value: '10', faceUp: true },
      dealerHole: { suit: 'spades', value: '7', faceUp: true }
    });
    playerWinEngine.startRound();
    playerWinEngine.stand();
    expect(playerWinEngine.state.outcome).toBe('player-won');
    expect(playerWinEngine.state.chipBank).toBe(550);

    // Push: Player 18 vs Dealer 18
    const pushEngine = new BlackjackEngine(500, 'minimax', 'balanced');
    pushEngine.placeBet(50);
    pushEngine.state.shoe = makeShoeWithCards({
      player1: { suit: 'clubs', value: '10', faceUp: true },
      player2: { suit: 'clubs', value: '8', faceUp: true },
      dealerFirst: { suit: 'hearts', value: '10', faceUp: true },
      dealerHole: { suit: 'spades', value: '8', faceUp: true }
    });
    pushEngine.startRound();
    pushEngine.stand();
    expect(pushEngine.state.outcome).toBe('push');
    expect(pushEngine.state.chipBank).toBe(500);

    // Calling stand when not in player turn is a safe no-op
    pushEngine.stand();
    expect(pushEngine.state.stage).toBe('round-over');
  });
});
