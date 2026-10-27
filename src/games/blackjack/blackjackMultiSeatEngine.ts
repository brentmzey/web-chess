import { Option, Result, none, some, success, failure } from '../../utils/fp';
import {
  PlayingCard,
  createShoe,
  evaluateHand,
  BlackjackHandEvaluation,
  BlackjackAIModel
} from './blackjackEngine';
import { TableSeatManager, TableSeat } from '../multiplayer/tableSeatManager';
import { logger } from '../../utils/logger';
import {
  SeatHandStatusEnum,
  BlackjackOutcomeEnum,
  BlackjackStageEnum,
  AIModelEnum
} from '../../constants/gameEnums';

export interface MultiSeatPlayerData {
  chipBank: number;
  currentBet: number;
  cards: PlayingCard[];
  evaluation: BlackjackHandEvaluation;
  status: SeatHandStatusEnum | 'waiting' | 'betting' | 'playing' | 'stood' | 'busted' | 'blackjack' | 'settled';
  outcome: BlackjackOutcomeEnum | 'in-progress' | 'won' | 'lost' | 'push' | 'blackjack';
}

export interface MultiSeatBlackjackState {
  shoe: PlayingCard[];
  dealerHand: PlayingCard[];
  dealerEvaluation: BlackjackHandEvaluation;
  activeSeatTurn: Option<number>;
  stage: BlackjackStageEnum | 'betting' | 'dealing' | 'player-turns' | 'dealer-turn' | 'round-settled';
  roundNumber: number;
  historyText: string[];
}

export class BlackjackMultiSeatEngine {
  public seatManager: TableSeatManager<MultiSeatPlayerData>;
  public state: MultiSeatBlackjackState;
  private minBet: number;
  private maxBet: number;

  constructor(
    maxSeats: number = 5,
    minBet: number = 10,
    maxBet: number = 500,
    defaultBotModel: BlackjackAIModel = AIModelEnum.MicroNeural
  ) {
    this.minBet = minBet;
    this.maxBet = maxBet;
    this.seatManager = new TableSeatManager<MultiSeatPlayerData>(maxSeats, 2, defaultBotModel);

    // Initialize initial player data on seats
    for (let i = 1; i <= maxSeats; i++) {
      this.seatManager.updateSeatData(i, () => ({
        chipBank: 500,
        currentBet: 25,
        cards: [],
        evaluation: { total: 0, isSoft: false, isBlackjack: false, isBusted: false },
        status: 'waiting',
        outcome: 'in-progress'
      }));
    }

    this.state = {
      shoe: createShoe(6),
      dealerHand: [],
      dealerEvaluation: { total: 0, isSoft: false, isBlackjack: false, isBusted: false },
      activeSeatTurn: none(),
      stage: 'betting',
      roundNumber: 0,
      historyText: ['Gothic Multi-Seat Velvet Table opened. Place bets or join seats.']
    };
  }

  public getSeatManager(): TableSeatManager<MultiSeatPlayerData> {
    return this.seatManager;
  }

  /**
   * Automatically fills all vacant seats with bots so the multiplayer game can be played immediately.
   */
  public populateBotOpponents(
    botModel: BlackjackAIModel = 'micro-neural',
    namePrefix: string = 'Abbot'
  ): number {
    return this.seatManager.fillEmptySeatsWithBots(botModel, namePrefix);
  }

  /**
   * Sets bet for a given seat.
   */
  public placeBet(seatNumber: number, betAmount: number): Result<number, string> {
    if (this.state.stage !== 'betting') {
      return failure(`Cannot change bets during stage ${this.state.stage}`);
    }
    if (betAmount < this.minBet || betAmount > this.maxBet) {
      return failure(`Bet ${betAmount} outside table limits (${this.minBet}-${this.maxBet})`);
    }

    const seatOpt = this.seatManager.getSeat(seatNumber);
    return seatOpt.match({
      Some: seat => {
        if (!seat.isOccupied) return failure(`Seat ${seatNumber} is unoccupied.`);
        if (seat.extraData.chipBank < betAmount) {
          return failure(`Insufficient chips for Seat ${seatNumber}. Bank: ${seat.extraData.chipBank}`);
        }
        seat.extraData.currentBet = betAmount;
        return success(betAmount);
      },
      None: () => failure(`Invalid seat ${seatNumber}`)
    });
  }

  /**
   * Starts a new round: deals 2 cards to each occupied seat and 2 to the dealer.
   */
  public startRound(): Result<number, string> {
    const occupiedSeats = this.seatManager.getOccupiedSeats();
    if (occupiedSeats.length === 0) {
      return failure('Cannot start round with 0 players at table.');
    }

    // Reshuffle shoe if running low
    if (this.state.shoe.length < 25) {
      this.state.shoe = createShoe(6);
      this.state.historyText.push('Consecrated 6-deck shoe reshuffled with fresh cards.');
      logger.info('[BJK_MULTI] Shoe reshuffled with 6 decks');
    }

    this.state.roundNumber++;
    this.state.historyText.push(`--- Round ${this.state.roundNumber} Begun ---`);

    // Deduct bets from all occupied seats and reset hands
    occupiedSeats.forEach(seat => {
      const data = seat.extraData;
      // Auto-adjust bet if bank is lower than current bet
      if (data.chipBank < data.currentBet) {
        data.currentBet = Math.max(this.minBet, data.chipBank);
      }
      data.chipBank -= data.currentBet;
      data.cards = [];
      data.status = 'playing';
      data.outcome = 'in-progress';
    });

    // Deal 2 cards to each seat
    for (let c = 0; c < 2; c++) {
      occupiedSeats.forEach(seat => {
        const card = this.state.shoe.pop()!;
        card.faceUp = true;
        seat.extraData.cards.push(card);
      });
    }

    // Deal 2 cards to dealer (one face-up, one hole card face-down)
    const dealerUp = this.state.shoe.pop()!;
    dealerUp.faceUp = true;
    const dealerHole = this.state.shoe.pop()!;
    dealerHole.faceUp = false;
    this.state.dealerHand = [dealerUp, dealerHole];
    this.state.dealerEvaluation = evaluateHand(this.state.dealerHand, true);

    // Evaluate initial player hands for natural blackjacks
    occupiedSeats.forEach(seat => {
      const ev = evaluateHand(seat.extraData.cards);
      seat.extraData.evaluation = ev;
      if (ev.isBlackjack) {
        seat.extraData.status = 'blackjack';
        this.state.historyText.push(`${seat.playerName} (Seat ${seat.seatNumber}) dealt Natural 21!`);
      }
    });

    // Advance to first player turn who does not have blackjack
    this.state.stage = 'player-turns';
    this.advanceToNextTurn();

    return success(occupiedSeats.length);
  }

  /**
   * Advances the turn pointer to the next seat that needs to make decisions.
   */
  public advanceToNextTurn(): Option<number> {
    const occupiedSeats = this.seatManager.getOccupiedSeats();
    const currentTurn = this.state.activeSeatTurn.getOrElse(0);

    const nextSeat = occupiedSeats.find(
      s => s.seatNumber > currentTurn && s.extraData.status === 'playing'
    );

    if (nextSeat) {
      this.state.activeSeatTurn = some(nextSeat.seatNumber);
      this.state.historyText.push(`Seat ${nextSeat.seatNumber} (${nextSeat.playerName}) to act.`);

      // If it's a bot seat, auto-play its turn immediately!
      if (nextSeat.isBot) {
        this.autoPlayBotSeat(nextSeat);
      }
      return some(nextSeat.seatNumber);
    }

    // No more player turns remain -> advance to dealer turn
    this.state.activeSeatTurn = none();
    this.state.stage = 'dealer-turn';
    this.playDealerTurn();
    return none();
  }

  /**
   * AI Bot decision engine for a seat.
   */
  private autoPlayBotSeat(seat: TableSeat<MultiSeatPlayerData>): void {
    const data = seat.extraData;
    const botModel = seat.botModel.getOrElse('micro-neural');

    // Threshold based on bot model & risk profile
    const standAt = botModel === 'minimax' ? 17 : botModel === 'gemini-nano' ? 18 : 16;

    while (data.status === 'playing') {
      const currentTotal = data.evaluation.total;
      if (currentTotal < standAt) {
        // Draw card
        const card = this.state.shoe.pop()!;
        card.faceUp = true;
        data.cards.push(card);
        data.evaluation = evaluateHand(data.cards);
        if (data.evaluation.isBusted) {
          data.status = 'busted';
          this.state.historyText.push(`${seat.playerName} draws and busts with ${data.evaluation.total}!`);
        } else if (data.evaluation.total >= 21) {
          data.status = 'stood';
          this.state.historyText.push(`${seat.playerName} reaches ${data.evaluation.total} and stands.`);
        }
      } else {
        data.status = 'stood';
        this.state.historyText.push(`${seat.playerName} stands on ${currentTotal}.`);
      }
    }

    // Proceed to next turn
    this.advanceToNextTurn();
  }

  /**
   * Human player action: Hit.
   */
  public playerHit(seatNumber: number): Result<BlackjackHandEvaluation, string> {
    if (this.state.stage !== 'player-turns') {
      return failure(`Cannot hit outside player turns stage (${this.state.stage})`);
    }
    const active = this.state.activeSeatTurn.getOrElse(-1);
    if (active !== seatNumber) {
      return failure(`Not Seat ${seatNumber}'s turn. Active seat is ${active}`);
    }

    const seatOpt = this.seatManager.getSeat(seatNumber);
    return seatOpt.match({
      Some: seat => {
        const data = seat.extraData;
        const card = this.state.shoe.pop()!;
        card.faceUp = true;
        data.cards.push(card);
        data.evaluation = evaluateHand(data.cards);

        if (data.evaluation.isBusted) {
          data.status = 'busted';
          this.state.historyText.push(`${seat.playerName} hits and busts with ${data.evaluation.total}!`);
          this.advanceToNextTurn();
        } else if (data.evaluation.total === 21) {
          data.status = 'stood';
          this.state.historyText.push(`${seat.playerName} hits 21! Standing automatically.`);
          this.advanceToNextTurn();
        } else {
          this.state.historyText.push(`${seat.playerName} hits. Total: ${data.evaluation.total}.`);
        }

        return success(data.evaluation);
      },
      None: () => failure(`Seat ${seatNumber} not found`)
    });
  }

  /**
   * Human player action: Stand.
   */
  public playerStand(seatNumber: number): Result<boolean, string> {
    if (this.state.stage !== 'player-turns') {
      return failure(`Cannot stand outside player turns stage (${this.state.stage})`);
    }
    const active = this.state.activeSeatTurn.getOrElse(-1);
    if (active !== seatNumber) {
      return failure(`Not Seat ${seatNumber}'s turn. Active seat is ${active}`);
    }

    const seatOpt = this.seatManager.getSeat(seatNumber);
    return seatOpt.match({
      Some: seat => {
        seat.extraData.status = 'stood';
        this.state.historyText.push(`${seat.playerName} stands on ${seat.extraData.evaluation.total}.`);
        this.advanceToNextTurn();
        return success(true);
      },
      None: () => failure(`Seat ${seatNumber} not found`)
    });
  }

  /**
   * Human player action: Double Down.
   */
  public playerDoubleDown(seatNumber: number): Result<boolean, string> {
    if (this.state.stage !== 'player-turns') return failure('Cannot double down outside player turn.');
    const active = this.state.activeSeatTurn.getOrElse(-1);
    if (active !== seatNumber) return failure('Not your turn.');

    const seatOpt = this.seatManager.getSeat(seatNumber);
    return seatOpt.match({
      Some: seat => {
        const data = seat.extraData;
        if (data.cards.length !== 2) return failure('Double down only permitted on initial two cards.');
        if (data.chipBank < data.currentBet) return failure('Insufficient chips to double bet.');

        data.chipBank -= data.currentBet;
        data.currentBet *= 2;
        const card = this.state.shoe.pop()!;
        card.faceUp = true;
        data.cards.push(card);
        data.evaluation = evaluateHand(data.cards);

        if (data.evaluation.isBusted) {
          data.status = 'busted';
          this.state.historyText.push(`${seat.playerName} doubled down and busted with ${data.evaluation.total}!`);
        } else {
          data.status = 'stood';
          this.state.historyText.push(`${seat.playerName} doubled down to ${data.evaluation.total}.`);
        }

        this.advanceToNextTurn();
        return success(true);
      },
      None: () => failure(`Seat ${seatNumber} not found`)
    });
  }

  /**
   * Plays dealer turn according to standard casino S17 rules (stands on soft 17+).
   */
  private playDealerTurn(): void {
    // Reveal dealer hole card
    this.state.dealerHand.forEach(c => (c.faceUp = true));
    let dealerEval = evaluateHand(this.state.dealerHand);
    this.state.historyText.push(`Dealer reveals hole card. Dealer total: ${dealerEval.total}.`);

    // Check if all players busted; if so, dealer doesn't need to draw
    const allPlayersBusted = this.seatManager
      .getOccupiedSeats()
      .every(s => s.extraData.status === 'busted');

    if (!allPlayersBusted) {
      while (dealerEval.total < 17) {
        const card = this.state.shoe.pop()!;
        card.faceUp = true;
        this.state.dealerHand.push(card);
        dealerEval = evaluateHand(this.state.dealerHand);
        this.state.historyText.push(`Dealer draws. Dealer total: ${dealerEval.total}.`);
      }
    }

    this.state.dealerEvaluation = dealerEval;
    this.settleRound();
  }

  /**
   * Settles bets and determines payouts for all seats.
   */
  private settleRound(): void {
    this.state.stage = 'round-settled';
    const dealerEval = this.state.dealerEvaluation;

    this.seatManager.getOccupiedSeats().forEach(seat => {
      const data = seat.extraData;
      const playerEval = data.evaluation;

      if (data.status === 'busted') {
        data.outcome = 'lost';
        data.status = 'settled';
        this.state.historyText.push(`${seat.playerName} lost (busted).`);
      } else if (playerEval.isBlackjack) {
        if (dealerEval.isBlackjack) {
          data.outcome = 'push';
          data.chipBank += data.currentBet;
          this.state.historyText.push(`${seat.playerName} pushed (mutual Blackjack).`);
        } else {
          data.outcome = 'blackjack';
          const payout = Math.floor(data.currentBet * 2.5); // 3:2 payout + original bet returned
          data.chipBank += payout;
          this.state.historyText.push(`${seat.playerName} won with Natural 21 (+${payout - data.currentBet} Relics)!`);
        }
        data.status = 'settled';
      } else if (dealerEval.isBusted) {
        data.outcome = 'won';
        data.chipBank += data.currentBet * 2;
        data.status = 'settled';
        this.state.historyText.push(`${seat.playerName} won (dealer busted, +${data.currentBet} Relics)!`);
      } else if (playerEval.total > dealerEval.total) {
        data.outcome = 'won';
        data.chipBank += data.currentBet * 2;
        data.status = 'settled';
        this.state.historyText.push(`${seat.playerName} won (${playerEval.total} vs ${dealerEval.total}, +${data.currentBet} Relics)!`);
      } else if (playerEval.total < dealerEval.total) {
        data.outcome = 'lost';
        data.status = 'settled';
        this.state.historyText.push(`${seat.playerName} lost (${playerEval.total} vs ${dealerEval.total}).`);
      } else {
        data.outcome = 'push';
        data.chipBank += data.currentBet;
        data.status = 'settled';
        this.state.historyText.push(`${seat.playerName} pushed (${playerEval.total} each).`);
      }
    });

    this.state.historyText.push('--- Round Settled --- Place bets for next hand.');
  }

  /**
   * Resets table state for the next betting round.
   */
  public prepareNextHand(): void {
    this.state.stage = 'betting';
    this.state.dealerHand = [];
    this.state.dealerEvaluation = { total: 0, isSoft: false, isBlackjack: false, isBusted: false };
    this.state.activeSeatTurn = none();
    this.seatManager.getOccupiedSeats().forEach(s => {
      s.extraData.cards = [];
      s.extraData.status = 'waiting';
      s.extraData.outcome = 'in-progress';
    });
  }
}
