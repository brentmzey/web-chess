import { describe, expect, it } from 'bun:test';
import { BlackjackMultiSeatEngine } from '../src/games/blackjack/blackjackMultiSeatEngine';

describe('BlackjackMultiSeatEngine - Multi-Player (>2) Table Dynamics & Bot Fill', () => {
  const createDeterministicShoe = (topCards: any[]): any[] => {
    const dummy = Array.from({ length: 35 }, () => ({
      suit: 'clubs',
      value: '2',
      faceUp: true
    }));
    return [...dummy, ...topCards];
  };

  it('initializes 5-seat table and fills with AI bots', () => {
    const engine = new BlackjackMultiSeatEngine(5, 10, 500, 'micro-neural');
    expect(engine.seatManager.getMaxSeats()).toBe(5);

    const filled = engine.populateBotOpponents('micro-neural', 'Abbot');
    expect(filled).toBe(5);
    expect(engine.seatManager.getBotCount()).toBe(5);
    expect(engine.seatManager.getHumanCount()).toBe(0);
  });

  it('automatically plays full round for AI bot seats across all AI models', () => {
    const engine = new BlackjackMultiSeatEngine(3, 10, 500);
    engine.seatManager.fillEmptySeatsWithBots('minimax', 'BotMinimax');
    engine.seatManager.getSeat(2).map(s => {
      s.botModel = s.botModel.map(() => 'gemini-nano');
    });
    engine.seatManager.getSeat(3).map(s => {
      s.botModel = s.botModel.map(() => 'micro-neural');
    });

    const startRes = engine.startRound();
    expect(startRes.isSuccess()).toBe(true);
    // Since all 3 seats are bots, all 3 seats auto-play and advance to dealer automatically!
    expect(engine.state.stage).toBe('round-settled');
    expect(engine.seatManager.getOccupiedSeats().every(s => s.extraData.status === 'settled')).toBe(true);
  });

  it('allows multiple human players (>2) to sit alongside bots', () => {
    const engine = new BlackjackMultiSeatEngine(5, 10, 500);
    engine.populateBotOpponents('minimax');

    // 3 Human players claim seats 1, 3, and 5
    const p1 = engine.seatManager.claimSeat(1, 'h1', 'Alice');
    const p2 = engine.seatManager.claimSeat(3, 'h2', 'Bob');
    const p3 = engine.seatManager.claimSeat(5, 'h3', 'Charlie');

    expect(p1.isSuccess()).toBe(true);
    expect(p2.isSuccess()).toBe(true);
    expect(p3.isSuccess()).toBe(true);

    expect(engine.seatManager.getHumanCount()).toBe(3);
    expect(engine.seatManager.getBotCount()).toBe(2);
    expect(engine.seatManager.getTotalOccupants()).toBe(5);
  });

  it('validates bets and enforces table limits across seats', () => {
    const engine = new BlackjackMultiSeatEngine(5, 10, 500);
    engine.seatManager.claimSeat(1, 'h1', 'Alice');

    // Under minimum
    expect(engine.placeBet(1, 5).isFailure()).toBe(true);
    // Over maximum
    expect(engine.placeBet(1, 1000).isFailure()).toBe(true);
    // Valid bet
    const valid = engine.placeBet(1, 50);
    expect(valid.isSuccess()).toBe(true);
    expect(valid.getOrElse(0)).toBe(50);
    expect(engine.seatManager.getSeat(1).getOrThrow().extraData.currentBet).toBe(50);

    // Unoccupied seat rejects bet
    expect(engine.placeBet(2, 50).isFailure()).toBe(true);
  });

  it('executes complete multi-player round with human hits, stands, and bot auto-play', () => {
    const engine = new BlackjackMultiSeatEngine(3, 10, 500);
    // Seat 1: Human, Seat 2: Bot, Seat 3: Human
    engine.seatManager.claimSeat(1, 'h1', 'Alice');
    engine.seatManager.claimSeat(3, 'h2', 'Bob');
    engine.populateBotOpponents('micro-neural', 'Bot');

    expect(engine.seatManager.getHumanCount()).toBe(2);
    expect(engine.seatManager.getBotCount()).toBe(1);

    // Start round
    const startRes = engine.startRound();
    expect(startRes.isSuccess()).toBe(true);
    expect(startRes.getOrElse(0)).toBe(3);
    expect(engine.state.dealerHand.length).toBe(2);

    // If seat 1 is playing, test human actions
    const seat1 = engine.seatManager.getSeat(1).getOrThrow();
    if (seat1.extraData.status === 'playing') {
      const activeTurn = engine.state.activeSeatTurn.getOrElse(-1);
      expect(activeTurn).toBe(1);

      // Hit or Stand
      if (seat1.extraData.evaluation.total < 12) {
        const hitRes = engine.playerHit(1);
        expect(hitRes.isSuccess()).toBe(true);
      }
      if (seat1.extraData.status === 'playing') {
        const standRes = engine.playerStand(1);
        expect(standRes.isSuccess()).toBe(true);
      }
    }

    // After Seat 1 finishes, Bot on Seat 2 auto-plays immediately and turn advances to Seat 3!
    const seat3 = engine.seatManager.getSeat(3).getOrThrow();
    if (seat3.extraData.status === 'playing') {
      const activeTurn = engine.state.activeSeatTurn.getOrElse(-1);
      expect(activeTurn).toBe(3);
      engine.playerStand(3);
    }

    // Once all players stand or bust, dealer plays and round settles
    expect(engine.state.stage).toBe('round-settled');
    expect(engine.state.dealerHand.every(c => c.faceUp)).toBe(true);

    // Check that all 3 seats have settled outcomes
    engine.seatManager.getOccupiedSeats().forEach(s => {
      expect(s.extraData.status).toBe('settled');
      expect(['won', 'lost', 'push', 'blackjack']).toContain(s.extraData.outcome);
    });

    // Prepare next hand resets for betting
    engine.prepareNextHand();
    expect(engine.state.stage).toBe('betting');
  });

  it('handles human player double down and shoe reshuffle', () => {
    const engine = new BlackjackMultiSeatEngine(2, 10, 500);
    engine.seatManager.claimSeat(1, 'h1', 'DoubleMaster');
    engine.seatManager.claimSeat(2, 'h2', 'StandMaster');

    // Force small shoe to test reshuffle trigger
    engine.state.shoe = engine.state.shoe.slice(0, 10);
    expect(engine.state.shoe.length).toBe(10);

    engine.startRound();
    expect(engine.state.shoe.length).toBeGreaterThan(100); // 6 decks reshuffled!

    const seat1 = engine.seatManager.getSeat(1).getOrThrow();
    if (seat1.extraData.status === 'playing') {
      const ddRes = engine.playerDoubleDown(1);
      expect(ddRes.isSuccess()).toBe(true);
      expect(seat1.extraData.cards.length).toBe(3);
    }
  });

  it('hot-swaps seat to AI bot if human disconnects during the match', () => {
    const engine = new BlackjackMultiSeatEngine(3, 10, 500);
    engine.seatManager.claimSeat(1, 'h1', 'Alice');
    engine.seatManager.claimSeat(2, 'h2', 'Bob');
    engine.populateBotOpponents();

    expect(engine.seatManager.getHumanCount()).toBe(2);

    // Bob disconnects -> vacateSeat hot-swaps him to a Guardian Bot
    const vacateRes = engine.seatManager.vacateSeat(2, 'micro-neural', 'Guardian Bot');
    expect(vacateRes.isSuccess()).toBe(true);

    expect(engine.seatManager.getHumanCount()).toBe(1);
    expect(engine.seatManager.getBotCount()).toBe(2);

    const seat2 = engine.seatManager.getSeat(2).getOrThrow();
    expect(seat2.isBot).toBe(true);
    expect(seat2.playerName).toContain('Guardian Bot #2');

    // Match runs without crashing
    engine.startRound();
    expect(engine.state.roundNumber).toBe(1);
  });

  it('handles edge cases: invalid turn actions, hitting bust, 21 exact, double down errors', () => {
    const engine = new BlackjackMultiSeatEngine(2, 10, 500);
    expect(engine.getSeatManager()).toBe(engine.seatManager);

    // Cannot start with 0 players
    expect(engine.startRound().isFailure()).toBe(true);

    // Setup 1 human player
    engine.seatManager.claimSeat(1, 'h1', 'SoloPlayer');
    // Cannot change bet outside bounds or when not enough chips
    expect(engine.placeBet(1, 9999).isFailure()).toBe(true);
    expect(engine.placeBet(99, 50).isFailure()).toBe(true);

    // Start round with deterministic non-blackjack cards for SoloPlayer
    engine.state.shoe = createDeterministicShoe([
      { suit: 'clubs', value: '7', faceUp: true },
      { suit: 'hearts', value: '10', faceUp: true },
      { suit: 'spades', value: '7', faceUp: true },
      { suit: 'spades', value: '10', faceUp: true }
    ]);
    engine.startRound();
    // Cannot change bet once round starts
    expect(engine.placeBet(1, 50).isFailure()).toBe(true);

    // Cannot hit or stand with wrong seat or wrong stage
    expect(engine.playerHit(2).isFailure()).toBe(true);
    expect(engine.playerStand(2).isFailure()).toBe(true);
    expect(engine.playerDoubleDown(2).isFailure()).toBe(true);

    // Double down guards: simulate 3 cards
    const seat1 = engine.seatManager.getSeat(1).getOrThrow();
    seat1.extraData.cards.push({ suit: 'spades', value: '2', faceUp: true });
    expect(engine.playerDoubleDown(1).isFailure()).toBe(true);
    seat1.extraData.cards.pop();

    // Double down guards: simulate chipBank < currentBet
    seat1.extraData.chipBank = 0;
    expect(engine.playerDoubleDown(1).isFailure()).toBe(true);
    seat1.extraData.chipBank = 500;

    // Simulate hitting until bust
    seat1.extraData.cards = [
      { suit: 'spades', value: '10', faceUp: true },
      { suit: 'spades', value: '9', faceUp: true }
    ];
    seat1.extraData.evaluation = { total: 19, isSoft: false, isBlackjack: false, isBusted: false };
    engine.state.shoe.push({ suit: 'diamonds', value: '10', faceUp: true });
    const bustEval = engine.playerHit(1);
    expect(bustEval.isSuccess()).toBe(true);

    // Round should settle automatically since all players busted
    expect(engine.state.stage).toBe('round-settled');
    expect(seat1.extraData.outcome).toBe('lost');

    // Hitting/standing outside player turns stage returns failure
    expect(engine.playerHit(1).isFailure()).toBe(true);
    expect(engine.playerStand(1).isFailure()).toBe(true);
    expect(engine.playerDoubleDown(1).isFailure()).toBe(true);
  });

  it('evaluates natural blackjack payouts and dealer bust/win/push outcomes', () => {
    // 1. Natural Blackjack solo win
    const engineBJ = new BlackjackMultiSeatEngine(1, 10, 500);
    engineBJ.seatManager.claimSeat(1, 'h1', 'Lucky');
    // Top of shoe (popped last): playerCard1, playerCard2, dealerUp, dealerHole, dealerDraw
    engineBJ.state.shoe = createDeterministicShoe([
      { suit: 'hearts', value: '2', faceUp: true }, // dealer draw
      { suit: 'clubs', value: '6', faceUp: true }, // dealer hole
      { suit: 'hearts', value: '10', faceUp: true }, // dealer up
      { suit: 'spades', value: 'K', faceUp: true }, // player card 2
      { suit: 'spades', value: 'A', faceUp: true } // player card 1
    ]);
    engineBJ.startRound();
    expect(engineBJ.state.stage).toBe('round-settled');
    const seatLucky = engineBJ.seatManager.getSeat(1).getOrThrow();
    expect(seatLucky.extraData.outcome).toBe('blackjack');

    // 2. Mutual Natural Blackjack Push
    const enginePush = new BlackjackMultiSeatEngine(1, 10, 500);
    enginePush.seatManager.claimSeat(1, 'h1', 'Pusher');
    enginePush.state.shoe = createDeterministicShoe([
      { suit: 'clubs', value: 'A', faceUp: true }, // dealer hole
      { suit: 'hearts', value: 'K', faceUp: true }, // dealer up
      { suit: 'spades', value: 'K', faceUp: true },
      { suit: 'spades', value: 'A', faceUp: true }
    ]);
    enginePush.startRound();
    expect(enginePush.state.stage).toBe('round-settled');
    expect(enginePush.seatManager.getSeat(1).getOrThrow().extraData.outcome).toBe('push');

    // 3. Dealer busts vs player standing
    const engineDealerBust = new BlackjackMultiSeatEngine(1, 10, 500);
    engineDealerBust.seatManager.claimSeat(1, 'h1', 'Winner');
    engineDealerBust.state.shoe = createDeterministicShoe([
      { suit: 'diamonds', value: '10', faceUp: true }, // dealer draw -> busts (10 + 6 + 10 = 26)
      { suit: 'clubs', value: '6', faceUp: true },
      { suit: 'hearts', value: '10', faceUp: true },
      { suit: 'spades', value: '9', faceUp: true },
      { suit: 'spades', value: '10', faceUp: true }
    ]);
    engineDealerBust.startRound();
    engineDealerBust.playerStand(1);
    expect(engineDealerBust.seatManager.getSeat(1).getOrThrow().extraData.outcome).toBe('won');

    // 4. Player lower than dealer (Player 18 vs Dealer 19)
    const engineLoss = new BlackjackMultiSeatEngine(1, 10, 500);
    engineLoss.seatManager.claimSeat(1, 'h1', 'Loser');
    engineLoss.state.shoe = createDeterministicShoe([
      { suit: 'clubs', value: '9', faceUp: true },
      { suit: 'hearts', value: '10', faceUp: true },
      { suit: 'spades', value: '8', faceUp: true },
      { suit: 'spades', value: '10', faceUp: true }
    ]);
    engineLoss.startRound();
    engineLoss.playerStand(1);
    expect(engineLoss.seatManager.getSeat(1).getOrThrow().extraData.outcome).toBe('lost');

    // 5. Normal Push (Player 18 vs Dealer 18)
    const engineNormalPush = new BlackjackMultiSeatEngine(1, 10, 500);
    engineNormalPush.seatManager.claimSeat(1, 'h1', 'Pusher2');
    engineNormalPush.state.shoe = createDeterministicShoe([
      { suit: 'clubs', value: '8', faceUp: true },
      { suit: 'hearts', value: '10', faceUp: true },
      { suit: 'spades', value: '8', faceUp: true },
      { suit: 'spades', value: '10', faceUp: true }
    ]);
    engineNormalPush.startRound();
    engineNormalPush.playerStand(1);
    expect(engineNormalPush.seatManager.getSeat(1).getOrThrow().extraData.outcome).toBe('push');

    // 6. Double down bust
    const engineDdBust = new BlackjackMultiSeatEngine(1, 10, 500);
    engineDdBust.seatManager.claimSeat(1, 'h1', 'BustDouble');
    engineDdBust.state.shoe = createDeterministicShoe([
      { suit: 'diamonds', value: '10', faceUp: true }, // drawn on DD -> 10 + 6 + 10 = 26
      { suit: 'clubs', value: '7', faceUp: true },
      { suit: 'hearts', value: '10', faceUp: true },
      { suit: 'spades', value: '6', faceUp: true },
      { suit: 'spades', value: '10', faceUp: true }
    ]);
    engineDdBust.startRound();
    engineDdBust.playerDoubleDown(1);
    expect(engineDdBust.seatManager.getSeat(1).getOrThrow().extraData.outcome).toBe('lost');

    // 7. Dynamically add human and AI players via addPlayer
    const multiAdd = new BlackjackMultiSeatEngine(2, 10, 500);
    expect(multiAdd.addPlayer('Human1', false).isSuccess()).toBe(true);
    expect(multiAdd.addPlayer('Bot2', true).isSuccess()).toBe(true);
    expect(multiAdd.addPlayer('OverflowBot', true).isFailure()).toBe(true);

    // 8. Test insufficient chips on placeBet and auto-adjust bet on round start
    const betEngine = new BlackjackMultiSeatEngine(1, 10, 500);
    betEngine.seatManager.claimSeat(1, 'h1', 'LowRoller');
    betEngine.seatManager.getSeat(1).map(s => { s.extraData.chipBank = 15; });
    expect(betEngine.placeBet(1, 100).isFailure()).toBe(true);
    betEngine.seatManager.getSeat(1).map(s => { s.extraData.currentBet = 20; });
    betEngine.startRound();
    expect(betEngine.seatManager.getSeat(1).getOrThrow().extraData.currentBet).toBe(15);

    // 9. Test hit reaching exactly 21 and hit reaching < 21
    const hitEngine = new BlackjackMultiSeatEngine(1, 10, 500);
    hitEngine.seatManager.claimSeat(1, 'h1', 'Hitter');
    hitEngine.state.shoe = createDeterministicShoe([
      { suit: 'hearts', value: '5', faceUp: true }, // hit 2 -> 16 + 5 = 21!
      { suit: 'diamonds', value: '6', faceUp: true }, // hit 1 -> 10 + 6 = 16
      { suit: 'clubs', value: '2', faceUp: true }, // dealer 2
      { suit: 'spades', value: '10', faceUp: true }, // dealer 1
      { suit: 'clubs', value: '5', faceUp: true }, // p1 c2
      { suit: 'spades', value: '5', faceUp: true } // p1 c1 -> 10 total
    ]);
    hitEngine.startRound();
    const hit1 = hitEngine.playerHit(1);
    expect(hit1.isSuccess()).toBe(true);
    expect(hitEngine.seatManager.getSeat(1).getOrThrow().extraData.status).toBe('playing');
    const hit2 = hitEngine.playerHit(1);
    expect(hit2.isSuccess()).toBe(true);
    expect(hitEngine.seatManager.getSeat(1).getOrThrow().extraData.status).toBe('settled');

    // 10. Test Double Down without busting (success stand)
    const ddWinEngine = new BlackjackMultiSeatEngine(1, 10, 500);
    ddWinEngine.seatManager.claimSeat(1, 'h1', 'DDWinner');
    ddWinEngine.state.shoe = createDeterministicShoe([
      { suit: 'hearts', value: '9', faceUp: true }, // DD card -> 11 + 9 = 20
      { suit: 'clubs', value: '2', faceUp: true },
      { suit: 'spades', value: '10', faceUp: true },
      { suit: 'clubs', value: '6', faceUp: true },
      { suit: 'spades', value: '5', faceUp: true }
    ]);
    ddWinEngine.startRound();
    const ddRes = ddWinEngine.playerDoubleDown(1);
    expect(ddRes.isSuccess()).toBe(true);
    expect(ddWinEngine.seatManager.getSeat(1).getOrThrow().extraData.status).toBe('settled');

    // 11. Test Bot draw and bust, plus bot reaching 21
    const botBustEngine = new BlackjackMultiSeatEngine(1, 10, 500);
    botBustEngine.seatManager.fillEmptySeatsWithBots('minimax', 'BustBot');
    botBustEngine.state.shoe = createDeterministicShoe([
      { suit: 'hearts', value: '10', faceUp: true }, // Bot hit -> 16 + 10 = 26 bust!
      { suit: 'clubs', value: '2', faceUp: true },
      { suit: 'spades', value: '10', faceUp: true },
      { suit: 'clubs', value: '10', faceUp: true },
      { suit: 'spades', value: '6', faceUp: true }
    ]);
    botBustEngine.startRound();
    expect(botBustEngine.seatManager.getSeat(1).getOrThrow().extraData.outcome).toBe('lost');

    const bot21Engine = new BlackjackMultiSeatEngine(1, 10, 500);
    bot21Engine.seatManager.fillEmptySeatsWithBots('minimax', 'Bot21');
    bot21Engine.state.shoe = createDeterministicShoe([
      { suit: 'hearts', value: '5', faceUp: true }, // Bot hit -> 16 + 5 = 21!
      { suit: 'clubs', value: '2', faceUp: true },
      { suit: 'spades', value: '10', faceUp: true },
      { suit: 'clubs', value: '10', faceUp: true },
      { suit: 'spades', value: '6', faceUp: true }
    ]);
    bot21Engine.startRound();
    expect(bot21Engine.seatManager.getSeat(1).getOrThrow().extraData.evaluation.total).toBe(21);
  });
});
