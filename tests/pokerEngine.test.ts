import { describe, expect, it } from 'bun:test';
import {
  evaluatePokerHand,
  CathedralPokerEngine as PokerEngine
} from '../src/games/poker/pokerEngine';
import {
  CardSuitEnum,
  CardValueEnum,
  PokerVariantEnum,
  PokerStageEnum,
  PokerActionEnum,
  PokerHandRankEnum
} from '../src/constants/gameEnums';
import type { PlayingCard } from '../src/games/blackjack/blackjackEngine';

describe('Cathedral Poker Engine - Hand Evaluator, Variants & Multi-Seat Table', () => {
  it('correctly evaluates all 10 canonical Poker hand ranks', () => {
    // 1. Royal Flush
    const royalFlush: PlayingCard[] = [
      { suit: CardSuitEnum.Spades, value: CardValueEnum.Ace, faceUp: true },
      { suit: CardSuitEnum.Spades, value: CardValueEnum.King, faceUp: true },
      { suit: CardSuitEnum.Spades, value: CardValueEnum.Queen, faceUp: true },
      { suit: CardSuitEnum.Spades, value: CardValueEnum.Jack, faceUp: true },
      { suit: CardSuitEnum.Spades, value: CardValueEnum.Ten, faceUp: true }
    ];
    expect(evaluatePokerHand(royalFlush).rank).toBe(PokerHandRankEnum.RoyalFlush);

    // 2. Straight Flush (9 high)
    const straightFlush: PlayingCard[] = [
      { suit: CardSuitEnum.Hearts, value: CardValueEnum.Nine, faceUp: true },
      { suit: CardSuitEnum.Hearts, value: CardValueEnum.Eight, faceUp: true },
      { suit: CardSuitEnum.Hearts, value: CardValueEnum.Seven, faceUp: true },
      { suit: CardSuitEnum.Hearts, value: CardValueEnum.Six, faceUp: true },
      { suit: CardSuitEnum.Hearts, value: CardValueEnum.Five, faceUp: true }
    ];
    expect(evaluatePokerHand(straightFlush).rank).toBe(PokerHandRankEnum.StraightFlush);

    // 3. Four of a Kind
    const fourOfAKind: PlayingCard[] = [
      { suit: CardSuitEnum.Hearts, value: CardValueEnum.King, faceUp: true },
      { suit: CardSuitEnum.Diamonds, value: CardValueEnum.King, faceUp: true },
      { suit: CardSuitEnum.Clubs, value: CardValueEnum.King, faceUp: true },
      { suit: CardSuitEnum.Spades, value: CardValueEnum.King, faceUp: true },
      { suit: CardSuitEnum.Hearts, value: CardValueEnum.Two, faceUp: true }
    ];
    expect(evaluatePokerHand(fourOfAKind).rank).toBe(PokerHandRankEnum.FourOfAKind);

    // 4. Full House (Aces full of Kings)
    const fullHouse: PlayingCard[] = [
      { suit: CardSuitEnum.Hearts, value: CardValueEnum.Ace, faceUp: true },
      { suit: CardSuitEnum.Diamonds, value: CardValueEnum.Ace, faceUp: true },
      { suit: CardSuitEnum.Clubs, value: CardValueEnum.Ace, faceUp: true },
      { suit: CardSuitEnum.Spades, value: CardValueEnum.King, faceUp: true },
      { suit: CardSuitEnum.Hearts, value: CardValueEnum.King, faceUp: true }
    ];
    expect(evaluatePokerHand(fullHouse).rank).toBe(PokerHandRankEnum.FullHouse);

    // 5. Flush
    const flush: PlayingCard[] = [
      { suit: CardSuitEnum.Clubs, value: CardValueEnum.Ace, faceUp: true },
      { suit: CardSuitEnum.Clubs, value: CardValueEnum.Ten, faceUp: true },
      { suit: CardSuitEnum.Clubs, value: CardValueEnum.Eight, faceUp: true },
      { suit: CardSuitEnum.Clubs, value: CardValueEnum.Six, faceUp: true },
      { suit: CardSuitEnum.Clubs, value: CardValueEnum.Three, faceUp: true }
    ];
    expect(evaluatePokerHand(flush).rank).toBe(PokerHandRankEnum.Flush);

    // 6. Straight (Standard)
    const straight: PlayingCard[] = [
      { suit: CardSuitEnum.Clubs, value: CardValueEnum.Eight, faceUp: true },
      { suit: CardSuitEnum.Diamonds, value: CardValueEnum.Seven, faceUp: true },
      { suit: CardSuitEnum.Hearts, value: CardValueEnum.Six, faceUp: true },
      { suit: CardSuitEnum.Spades, value: CardValueEnum.Five, faceUp: true },
      { suit: CardSuitEnum.Clubs, value: CardValueEnum.Four, faceUp: true }
    ];
    expect(evaluatePokerHand(straight).rank).toBe(PokerHandRankEnum.Straight);

    // 7. Straight (Wheel A-2-3-4-5)
    const wheelStraight: PlayingCard[] = [
      { suit: CardSuitEnum.Clubs, value: CardValueEnum.Ace, faceUp: true },
      { suit: CardSuitEnum.Diamonds, value: CardValueEnum.Five, faceUp: true },
      { suit: CardSuitEnum.Hearts, value: CardValueEnum.Four, faceUp: true },
      { suit: CardSuitEnum.Spades, value: CardValueEnum.Three, faceUp: true },
      { suit: CardSuitEnum.Clubs, value: CardValueEnum.Two, faceUp: true }
    ];
    expect(evaluatePokerHand(wheelStraight).rank).toBe(PokerHandRankEnum.Straight);

    // 8. Three of a Kind
    const threeOfAKind: PlayingCard[] = [
      { suit: CardSuitEnum.Clubs, value: CardValueEnum.Queen, faceUp: true },
      { suit: CardSuitEnum.Diamonds, value: CardValueEnum.Queen, faceUp: true },
      { suit: CardSuitEnum.Hearts, value: CardValueEnum.Queen, faceUp: true },
      { suit: CardSuitEnum.Spades, value: CardValueEnum.Nine, faceUp: true },
      { suit: CardSuitEnum.Clubs, value: CardValueEnum.Four, faceUp: true }
    ];
    expect(evaluatePokerHand(threeOfAKind).rank).toBe(PokerHandRankEnum.ThreeOfAKind);

    // 9. Two Pair
    const twoPair: PlayingCard[] = [
      { suit: CardSuitEnum.Clubs, value: CardValueEnum.Jack, faceUp: true },
      { suit: CardSuitEnum.Diamonds, value: CardValueEnum.Jack, faceUp: true },
      { suit: CardSuitEnum.Hearts, value: CardValueEnum.Ten, faceUp: true },
      { suit: CardSuitEnum.Spades, value: CardValueEnum.Ten, faceUp: true },
      { suit: CardSuitEnum.Clubs, value: CardValueEnum.Two, faceUp: true }
    ];
    expect(evaluatePokerHand(twoPair).rank).toBe(PokerHandRankEnum.TwoPair);

    // 10. One Pair
    const onePair: PlayingCard[] = [
      { suit: CardSuitEnum.Clubs, value: CardValueEnum.Nine, faceUp: true },
      { suit: CardSuitEnum.Diamonds, value: CardValueEnum.Nine, faceUp: true },
      { suit: CardSuitEnum.Hearts, value: CardValueEnum.King, faceUp: true },
      { suit: CardSuitEnum.Spades, value: CardValueEnum.Seven, faceUp: true },
      { suit: CardSuitEnum.Clubs, value: CardValueEnum.Three, faceUp: true }
    ];
    expect(evaluatePokerHand(onePair).rank).toBe(PokerHandRankEnum.OnePair);

    // 11. High Card
    const highCard: PlayingCard[] = [
      { suit: CardSuitEnum.Clubs, value: CardValueEnum.Ace, faceUp: true },
      { suit: CardSuitEnum.Diamonds, value: CardValueEnum.King, faceUp: true },
      { suit: CardSuitEnum.Hearts, value: CardValueEnum.Nine, faceUp: true },
      { suit: CardSuitEnum.Spades, value: CardValueEnum.Five, faceUp: true },
      { suit: CardSuitEnum.Clubs, value: CardValueEnum.Two, faceUp: true }
    ];
    expect(evaluatePokerHand(highCard).rank).toBe(PokerHandRankEnum.HighCard);

    // Incomplete hand fallback
    expect(evaluatePokerHand(highCard.slice(0, 3)).description).toBe('Incomplete hand');
  });

  it('initializes multi-seat poker table and posts blinds', () => {
    const engine = new PokerEngine(PokerVariantEnum.TexasHoldem, 6, 10, 20);
    // Requires at least 2 players to start
    expect(engine.startHand().isFailure()).toBe(true);

    // Fill table with 2 humans and 4 bots
    engine.seatManager.claimSeat(1, 'h1', 'Alice');
    engine.seatManager.claimSeat(2, 'h2', 'Bob');
    engine.populateBotOpponents();

    expect(engine.seatManager.getTotalOccupants()).toBe(6);

    const startRes = engine.startHand();
    expect(startRes.isSuccess()).toBe(true);
    expect(engine.state.stage).toBe(PokerStageEnum.PreFlop);
    expect(engine.state.pot).toBe(30); // 10 SB + 20 BB

    // Each active player was dealt 2 hole cards
    engine.seatManager.getOccupiedSeats().forEach(s => {
      expect(s.extraData.holeCards.length).toBe(2);
    });
  });

  it('supports Omaha variant dealing 4 hole cards', () => {
    const engine = new PokerEngine(PokerVariantEnum.Omaha, 4, 15, 30);
    engine.seatManager.claimSeat(1, 'h1', 'OmahaPlayer1');
    engine.seatManager.claimSeat(2, 'h2', 'OmahaPlayer2');

    const startRes = engine.startHand();
    expect(startRes.isSuccess()).toBe(true);

    const p1 = engine.seatManager.getSeat(1).getOrThrow();
    expect(p1.extraData.holeCards.length).toBe(4);
  });

  it('deals the Flop and processes player actions (fold, call, check, raise)', () => {
    const engine = new PokerEngine(PokerVariantEnum.TexasHoldem, 3, 10, 20);
    engine.seatManager.claimSeat(1, 'h1', 'Alice');
    engine.seatManager.claimSeat(2, 'h2', 'Bob');
    engine.seatManager.claimSeat(3, 'h3', 'Charlie');
    engine.startHand();

    // Player 3 calls the $20 big blind
    const callRes = engine.playerAction(3, PokerActionEnum.Call);
    expect(callRes.isSuccess()).toBe(true);
    expect(engine.seatManager.getSeat(3).getOrThrow().extraData.currentBet).toBe(20);

    // Player 1 folds
    const foldRes = engine.playerAction(1, PokerActionEnum.Fold);
    expect(foldRes.isSuccess()).toBe(true);
    expect(engine.seatManager.getSeat(1).getOrThrow().extraData.folded).toBe(true);

    // Cannot act again if folded
    expect(engine.playerAction(1, PokerActionEnum.Check).isFailure()).toBe(true);

    // Deal Flop
    const flopRes = engine.dealFlop();
    expect(flopRes.isSuccess()).toBe(true);
    expect(engine.state.communityCards.length).toBe(3);
    expect(engine.state.stage).toBe(PokerStageEnum.Flop);

    // Cannot deal flop twice
    expect(engine.dealFlop().isFailure()).toBe(true);

    // Player 2 raises to 50
    const raiseRes = engine.playerAction(2, PokerActionEnum.Raise, 50);
    expect(raiseRes.isSuccess()).toBe(true);
    expect(engine.state.currentBet).toBe(50);

    // Player 3 tries to check when bet is 50 -> error
    expect(engine.playerAction(3, PokerActionEnum.Check).isFailure()).toBe(true);

    // Player 3 raises with insufficient chips -> error
    const p3 = engine.seatManager.getSeat(3).getOrThrow();
    p3.extraData.chipBank = 5;
    expect(engine.playerAction(3, PokerActionEnum.Raise, 100).isFailure()).toBe(true);
    p3.extraData.chipBank = 1000;

    // Player 3 raises below current bet -> error
    expect(engine.playerAction(3, PokerActionEnum.Raise, 30).isFailure()).toBe(true);

    // Non-existent seat action
    expect(engine.playerAction(99, PokerActionEnum.Fold).isFailure()).toBe(true);
  });

  it('resolves Showdown and awards pot to the highest ranking hand', () => {
    const engine = new PokerEngine(PokerVariantEnum.TexasHoldem, 2, 10, 20);
    engine.seatManager.claimSeat(1, 'h1', 'Winner');
    engine.seatManager.claimSeat(2, 'h2', 'RunnerUp');
    engine.startHand();

    // Stack community cards: Ace, King, Queen
    engine.state.communityCards = [
      { suit: CardSuitEnum.Hearts, value: CardValueEnum.Ace, faceUp: true },
      { suit: CardSuitEnum.Diamonds, value: CardValueEnum.King, faceUp: true },
      { suit: CardSuitEnum.Clubs, value: CardValueEnum.Queen, faceUp: true }
    ];

    // Winner gets Ace + King -> Two Pair (Aces and Kings)
    const winnerSeat = engine.seatManager.getSeat(1).getOrThrow();
    winnerSeat.extraData.holeCards = [
      { suit: CardSuitEnum.Spades, value: CardValueEnum.Ace, faceUp: true },
      { suit: CardSuitEnum.Hearts, value: CardValueEnum.King, faceUp: true }
    ];

    // RunnerUp gets Two + Three -> High Card
    const runnerSeat = engine.seatManager.getSeat(2).getOrThrow();
    runnerSeat.extraData.holeCards = [
      { suit: CardSuitEnum.Spades, value: CardValueEnum.Two, faceUp: true },
      { suit: CardSuitEnum.Hearts, value: CardValueEnum.Three, faceUp: true }
    ];

    const initialPot = engine.state.pot;
    const initialBank = winnerSeat.extraData.chipBank;

    const showdownRes = engine.resolveShowdown();
    expect(showdownRes.isSuccess()).toBe(true);
    expect(showdownRes.getOrThrow().playerName).toBe('Winner');
    expect(winnerSeat.extraData.chipBank).toBe(initialBank + initialPot);
    expect(engine.state.stage).toBe(PokerStageEnum.Settled);

    // Showdown with no active players returns failure
    winnerSeat.extraData.folded = true;
    runnerSeat.extraData.folded = true;
    expect(engine.resolveShowdown().isFailure()).toBe(true);
  });

  it('handles Turn, River, and Seven-Card Stud & Five-Card Draw variants', () => {
    // Test Turn & River
    const holdem = new PokerEngine(PokerVariantEnum.TexasHoldem, 2, 10, 20);
    holdem.seatManager.claimSeat(1, 'h1', 'Alice');
    holdem.seatManager.claimSeat(2, 'h2', 'Bob');
    holdem.startHand();
    holdem.dealFlop();

    const turnRes = holdem.dealTurn();
    expect(turnRes.isSuccess()).toBe(true);
    expect(holdem.state.communityCards.length).toBe(4);
    expect(holdem.state.stage).toBe(PokerStageEnum.Turn);

    const riverRes = holdem.dealRiver();
    expect(riverRes.isSuccess()).toBe(true);
    expect(holdem.state.communityCards.length).toBe(5);
    expect(holdem.state.stage).toBe(PokerStageEnum.River);

    // Test Seven-Card Stud
    const stud = new PokerEngine(PokerVariantEnum.SevenCardStud, 2, 5, 10);
    stud.seatManager.claimSeat(1, 's1', 'StudPlayer1');
    stud.seatManager.claimSeat(2, 's2', 'StudPlayer2');
    stud.startHand();
    expect(stud.seatManager.getSeat(1).getOrThrow().extraData.holeCards.length).toBe(3);

    // Test Five-Card Draw & Card Exchange
    const draw = new PokerEngine(PokerVariantEnum.FiveCardDraw, 2, 10, 20);
    draw.seatManager.claimSeat(1, 'd1', 'DrawPlayer1');
    draw.seatManager.claimSeat(2, 'd2', 'DrawPlayer2');
    draw.startHand();
    const d1Seat = draw.seatManager.getSeat(1).getOrThrow();
    expect(d1Seat.extraData.holeCards.length).toBe(5);

    // Discard 2 cards and draw 2 replacements
    const exchangeRes = draw.drawCardsFiveCardDraw(1, [0, 1]);
    expect(exchangeRes.isSuccess()).toBe(true);
    expect(exchangeRes.getOrThrow().length).toBe(2);
    expect(d1Seat.extraData.holeCards.length).toBe(5);

    // Five-Card Draw Showdown
    const drawShowdown = draw.resolveShowdown();
    expect(drawShowdown.isSuccess()).toBe(true);
  });

  it('validates Omaha Showdown with strict 2-hole and 3-community cards', () => {
    const omaha = new PokerEngine(PokerVariantEnum.Omaha, 2, 10, 20);
    omaha.seatManager.claimSeat(1, 'o1', 'OmahaWinner');
    omaha.seatManager.claimSeat(2, 'o2', 'OmahaChallenger');
    omaha.startHand();

    omaha.state.communityCards = [
      { suit: CardSuitEnum.Spades, value: CardValueEnum.Ace, faceUp: true },
      { suit: CardSuitEnum.Spades, value: CardValueEnum.King, faceUp: true },
      { suit: CardSuitEnum.Spades, value: CardValueEnum.Queen, faceUp: true },
      { suit: CardSuitEnum.Hearts, value: CardValueEnum.Two, faceUp: true },
      { suit: CardSuitEnum.Diamonds, value: CardValueEnum.Three, faceUp: true }
    ];

    const seat1 = omaha.seatManager.getSeat(1).getOrThrow();
    // 2 Spades (Jack, 10) + 2 Hearts -> Makes Royal Flush in Spades with Ace, King, Queen community!
    seat1.extraData.holeCards = [
      { suit: CardSuitEnum.Spades, value: CardValueEnum.Jack, faceUp: true },
      { suit: CardSuitEnum.Spades, value: CardValueEnum.Ten, faceUp: true },
      { suit: CardSuitEnum.Hearts, value: CardValueEnum.Nine, faceUp: true },
      { suit: CardSuitEnum.Hearts, value: CardValueEnum.Eight, faceUp: true }
    ];

    const seat2 = omaha.seatManager.getSeat(2).getOrThrow();
    seat2.extraData.holeCards = [
      { suit: CardSuitEnum.Clubs, value: CardValueEnum.Four, faceUp: true },
      { suit: CardSuitEnum.Clubs, value: CardValueEnum.Five, faceUp: true },
      { suit: CardSuitEnum.Clubs, value: CardValueEnum.Six, faceUp: true },
      { suit: CardSuitEnum.Clubs, value: CardValueEnum.Seven, faceUp: true }
    ];

    const showdownRes = omaha.resolveShowdown();
    expect(showdownRes.isSuccess()).toBe(true);
    expect(showdownRes.getOrThrow().playerName).toBe('OmahaWinner');
    expect(seat1.extraData.handRank?.rank).toBe(PokerHandRankEnum.RoyalFlush);
  });

  it('handles edge case errors for streets, draws, and numeric cards', () => {
    const holdem = new PokerEngine(PokerVariantEnum.TexasHoldem, 2, 10, 20);
    holdem.seatManager.claimSeat(1, 'h1', 'Alice');
    holdem.seatManager.claimSeat(2, 'h2', 'Bob');

    // Turn before flop -> failure
    expect(holdem.dealTurn().isFailure()).toBe(true);
    // River before turn -> failure
    expect(holdem.dealRiver().isFailure()).toBe(true);

    // Flop in stud or draw -> failure
    const stud = new PokerEngine(PokerVariantEnum.SevenCardStud, 2, 5, 10);
    expect(stud.dealFlop().isFailure()).toBe(true);

    // Draw cards in non-draw variant -> failure
    expect(holdem.drawCardsFiveCardDraw(1, [0]).isFailure()).toBe(true);

    // Discarding > 3 cards in Five-Card Draw -> failure
    const draw = new PokerEngine(PokerVariantEnum.FiveCardDraw, 2, 10, 20);
    draw.seatManager.claimSeat(1, 'd1', 'David');
    expect(draw.drawCardsFiveCardDraw(1, [0, 1, 2, 3]).isFailure()).toBe(true);

    // Discard in non-existent seat -> failure
    expect(draw.drawCardsFiveCardDraw(99, [0]).isFailure()).toBe(true);

    // Start hand with fewer than 2 players -> failure
    const single = new PokerEngine(PokerVariantEnum.TexasHoldem, 2, 10, 20);
    single.seatManager.claimSeat(1, 'alone', 'Alone');
    expect(single.startHand().isFailure()).toBe(true);

    // Incomplete hand evaluation
    expect(evaluatePokerHand([]).description).toBe('Incomplete hand');

    // Unknown card value evaluates with fallback 0
    expect(
      evaluatePokerHand([
        { suit: CardSuitEnum.Hearts, value: 'Unknown' as any, faceUp: true },
        { suit: CardSuitEnum.Diamonds, value: '2' as any, faceUp: true },
        { suit: CardSuitEnum.Clubs, value: '3' as any, faceUp: true },
        { suit: CardSuitEnum.Spades, value: '4' as any, faceUp: true },
        { suit: CardSuitEnum.Hearts, value: '7' as any, faceUp: true }
      ]).rank
    ).toBe(PokerHandRankEnum.HighCard);

    // All-In action
    expect(holdem.playerAction(1, PokerActionEnum.AllIn).isSuccess()).toBe(true);

    // Dynamically add human and AI players via addPlayer
    const pokerAdd = new PokerEngine(PokerVariantEnum.TexasHoldem, 2, 10, 20);
    expect(pokerAdd.addPlayer('HumanPoker', false).isSuccess()).toBe(true);
    expect(pokerAdd.addPlayer('BotPoker', true).isSuccess()).toBe(true);
    expect(pokerAdd.addPlayer('OverflowBot', true).isFailure()).toBe(true);

    // Initial empty and bot seats have valid extraData without throwing undefined errors
    const freshlyOpened = new PokerEngine(PokerVariantEnum.TexasHoldem, 6, 10, 20);
    freshlyOpened.populateBotOpponents();
    for (let s = 1; s <= 6; s++) {
      const seat = freshlyOpened.seatManager.getSeat(s).getOrThrow();
      expect(Array.isArray(seat.extraData.holeCards)).toBe(true);
      expect(seat.extraData.holeCards.length).toBe(0);
      expect(seat.extraData.chipBank).toBe(1000);
      expect(seat.extraData.currentBet).toBe(0);
      expect(seat.extraData.folded).toBe(false);
      expect(seat.extraData.isAllIn).toBe(false);
    }
  });
});
