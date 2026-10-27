import { Option, Result, none, some, success, failure } from '../../utils/fp';
import {
  CardValueEnum,
  PokerVariantEnum,
  PokerStageEnum,
  PokerActionEnum,
  PokerHandRankEnum,
  POKER_HAND_VALUES,
  AIModelEnum
} from '../../constants/gameEnums';
import { PlayingCard, createShoe } from '../blackjack/blackjackEngine';
import { TableSeatManager, TableSeat } from '../multiplayer/tableSeatManager';
import { logger } from '../../utils/logger';

export interface PokerPlayerData {
  chipBank: number;
  currentBet: number;
  holeCards: PlayingCard[];
  folded: boolean;
  isAllIn: boolean;
  handRank?: PokerHandEvaluation;
}

export interface PokerHandEvaluation {
  rank: PokerHandRankEnum;
  score: number;
  description: string;
}

export interface PokerGameState {
  variant: PokerVariantEnum;
  stage: PokerStageEnum;
  pot: number;
  currentBet: number;
  smallBlind: number;
  bigBlind: number;
  dealerSeat: number;
  communityCards: PlayingCard[];
  activeSeatTurn: Option<number>;
  historyText: string[];
}

const CARD_NUMERIC_VALUES: Record<CardValueEnum | string, number> = {
  [CardValueEnum.Two]: 2,
  [CardValueEnum.Three]: 3,
  [CardValueEnum.Four]: 4,
  [CardValueEnum.Five]: 5,
  [CardValueEnum.Six]: 6,
  [CardValueEnum.Seven]: 7,
  [CardValueEnum.Eight]: 8,
  [CardValueEnum.Nine]: 9,
  [CardValueEnum.Ten]: 10,
  [CardValueEnum.Jack]: 11,
  [CardValueEnum.Queen]: 12,
  [CardValueEnum.King]: 13,
  [CardValueEnum.Ace]: 14
};

/**
 * Pure functional 5-card Poker hand evaluator.
 */
export function evaluatePokerHand(cards: PlayingCard[]): PokerHandEvaluation {
  if (cards.length < 5) {
    return {
      rank: PokerHandRankEnum.HighCard,
      score: 1,
      description: 'Incomplete hand'
    };
  }

  // Sort values descending
  const numericValues = cards
    .map(c => CARD_NUMERIC_VALUES[c.value] || 0)
    .sort((a, b) => b - a);

  // Group by value count
  const counts: Record<number, number> = {};
  numericValues.forEach(v => {
    counts[v] = (counts[v] || 0) + 1;
  });

  const countEntries = Object.entries(counts)
    .map(([val, cnt]) => ({ value: Number(val), count: cnt }))
    .sort((a, b) => b.count - a.count || b.value - a.value);

  // Check flush (all 5 cards share the same suit)
  const isFlush = cards.every(c => c.suit === cards[0]?.suit);

  // Check straight (5 sequential values, handling A-2-3-4-5 wheel)
  const isStandardStraight =
    numericValues.length >= 5 &&
    numericValues[0] - numericValues[4] === 4 &&
    new Set(numericValues).size === 5;

  const isWheelStraight =
    numericValues[0] === 14 &&
    numericValues[1] === 5 &&
    numericValues[2] === 4 &&
    numericValues[3] === 3 &&
    numericValues[4] === 2;

  const isStraight = isStandardStraight || isWheelStraight;

  // 1. Royal Flush & Straight Flush
  if (isFlush && isStraight) {
    if (numericValues[0] === 14 && numericValues[1] === 13) {
      return {
        rank: PokerHandRankEnum.RoyalFlush,
        score: POKER_HAND_VALUES[PokerHandRankEnum.RoyalFlush] * 1000 + numericValues[0],
        description: 'Royal Flush'
      };
    }
    return {
      rank: PokerHandRankEnum.StraightFlush,
      score: POKER_HAND_VALUES[PokerHandRankEnum.StraightFlush] * 1000 + numericValues[0],
      description: `Straight Flush (${numericValues[0]} high)`
    };
  }

  // 2. Four of a Kind
  if (countEntries[0]?.count === 4) {
    return {
      rank: PokerHandRankEnum.FourOfAKind,
      score: POKER_HAND_VALUES[PokerHandRankEnum.FourOfAKind] * 1000 + (countEntries[0]?.value || 0),
      description: `Four of a Kind (${countEntries[0]?.value}s)`
    };
  }

  // 3. Full House
  if (countEntries[0]?.count === 3 && countEntries[1]?.count >= 2) {
    return {
      rank: PokerHandRankEnum.FullHouse,
      score: POKER_HAND_VALUES[PokerHandRankEnum.FullHouse] * 1000 + (countEntries[0]?.value || 0),
      description: `Full House (${countEntries[0]?.value}s full of ${countEntries[1]?.value}s)`
    };
  }

  // 4. Flush
  if (isFlush) {
    return {
      rank: PokerHandRankEnum.Flush,
      score: POKER_HAND_VALUES[PokerHandRankEnum.Flush] * 1000 + numericValues[0],
      description: `Flush (${numericValues[0]} high)`
    };
  }

  // 5. Straight
  if (isStraight) {
    const high = isWheelStraight ? 5 : numericValues[0];
    return {
      rank: PokerHandRankEnum.Straight,
      score: POKER_HAND_VALUES[PokerHandRankEnum.Straight] * 1000 + high,
      description: `Straight (${high} high)`
    };
  }

  // 6. Three of a Kind
  if (countEntries[0]?.count === 3) {
    return {
      rank: PokerHandRankEnum.ThreeOfAKind,
      score: POKER_HAND_VALUES[PokerHandRankEnum.ThreeOfAKind] * 1000 + (countEntries[0]?.value || 0),
      description: `Three of a Kind (${countEntries[0]?.value}s)`
    };
  }

  // 7. Two Pair
  if (countEntries[0]?.count === 2 && countEntries[1]?.count === 2) {
    return {
      rank: PokerHandRankEnum.TwoPair,
      score:
        POKER_HAND_VALUES[PokerHandRankEnum.TwoPair] * 1000 +
        (countEntries[0]?.value || 0) * 10 +
        (countEntries[1]?.value || 0),
      description: `Two Pair (${countEntries[0]?.value}s and ${countEntries[1]?.value}s)`
    };
  }

  // 8. One Pair
  if (countEntries[0]?.count === 2) {
    return {
      rank: PokerHandRankEnum.OnePair,
      score: POKER_HAND_VALUES[PokerHandRankEnum.OnePair] * 1000 + (countEntries[0]?.value || 0),
      description: `One Pair (${countEntries[0]?.value}s)`
    };
  }

  // 9. High Card
  return {
    rank: PokerHandRankEnum.HighCard,
    score: POKER_HAND_VALUES[PokerHandRankEnum.HighCard] * 1000 + numericValues[0],
    description: `High Card (${numericValues[0]})`
  };
}

/**
 * Cathedral Poker Multi-Seat Engine.
 */
export class PokerEngine {
  public seatManager: TableSeatManager<PokerPlayerData>;
  public state: PokerGameState;
  private shoe: PlayingCard[];

  constructor(
    variant: PokerVariantEnum = PokerVariantEnum.TexasHoldem,
    maxSeats: number = 6,
    smallBlind: number = 10,
    bigBlind: number = 20
  ) {
    this.seatManager = new TableSeatManager<PokerPlayerData>(maxSeats, 2, AIModelEnum.MicroNeural);
    this.shoe = createShoe(1);

    for (let i = 1; i <= maxSeats; i++) {
      this.seatManager.updateSeatData(i, () => ({
        chipBank: 1000,
        currentBet: 0,
        holeCards: [],
        folded: false,
        isAllIn: false
      }));
    }

    this.state = {
      variant,
      stage: PokerStageEnum.Lobby,
      pot: 0,
      currentBet: 0,
      smallBlind,
      bigBlind,
      dealerSeat: 1,
      communityCards: [],
      activeSeatTurn: none(),
      historyText: [`Cathedral Poker Table opened (${variant}).`]
    };
  }

  public populateBotOpponents(botModel: AIModelEnum = AIModelEnum.MicroNeural, prefix: string = 'PokerBot'): number {
    return this.seatManager.fillEmptySeatsWithBots(botModel, prefix);
  }

  /**
   * Starts a hand by collecting blinds, dealing hole cards, and advancing to Pre-Flop.
   */
  public startHand(): Result<number, string> {
    const activeSeats = this.seatManager.getOccupiedSeats();
    if (activeSeats.length < 2) {
      return failure('Need at least 2 players to start a poker hand.');
    }

    this.shoe = createShoe(1);
    this.state.pot = 0;
    this.state.communityCards = [];
    this.state.stage = PokerStageEnum.PreFlop;

    // Reset seat hand states
    activeSeats.forEach(seat => {
      seat.extraData.holeCards = [];
      seat.extraData.currentBet = 0;
      seat.extraData.folded = false;
      seat.extraData.isAllIn = false;
    });

    // Deal hole cards based on variant
    const cardsPerPlayer = this.state.variant === PokerVariantEnum.Omaha ? 4 : 2;
    for (let i = 0; i < cardsPerPlayer; i++) {
      activeSeats.forEach(seat => {
        const card = this.shoe.pop()!;
        card.faceUp = !seat.isBot; // Human cards face-up to user, bot cards private
        seat.extraData.holeCards.push(card);
      });
    }

    // Deduct Small & Big Blinds
    const sbSeat = activeSeats[0]!;
    const bbSeat = activeSeats[1]!;

    sbSeat.extraData.chipBank -= this.state.smallBlind;
    sbSeat.extraData.currentBet = this.state.smallBlind;
    bbSeat.extraData.chipBank -= this.state.bigBlind;
    bbSeat.extraData.currentBet = this.state.bigBlind;

    this.state.pot = this.state.smallBlind + this.state.bigBlind;
    this.state.currentBet = this.state.bigBlind;
    this.state.activeSeatTurn = some(activeSeats[activeSeats.length > 2 ? 2 : 0]!.seatNumber);

    this.state.historyText.push(
      `Hand started. Blinds posted: ${sbSeat.playerName} ($${this.state.smallBlind}), ${bbSeat.playerName} ($${this.state.bigBlind}). Pot: $${this.state.pot}`
    );
    logger.info(`[SERVER_SIDE] [POKER_TRACE] Hand dealt (${this.state.variant}). Active pot: $${this.state.pot}`);

    return success(this.state.pot);
  }

  /**
   * Deals the Flop (3 community cards).
   */
  public dealFlop(): Result<PlayingCard[], string> {
    if (this.state.stage !== PokerStageEnum.PreFlop) {
      return failure(`Cannot deal flop during stage ${this.state.stage}`);
    }

    // Burn 1 card
    this.shoe.pop();
    const flop = [this.shoe.pop()!, this.shoe.pop()!, this.shoe.pop()!];
    flop.forEach(c => (c.faceUp = true));
    this.state.communityCards.push(...flop);
    this.state.stage = PokerStageEnum.Flop;
    this.state.historyText.push('The Flop is dealt.');

    return success(flop);
  }

  /**
   * Player action: Fold, Check, Call, Bet, Raise, All-In.
   */
  public playerAction(seatNumber: number, action: PokerActionEnum, amount: number = 0): Result<boolean, string> {
    const seatOpt = this.seatManager.getSeat(seatNumber);
    return seatOpt.match({
      Some: seat => {
        const data = seat.extraData;
        if (data.folded) return failure(`Seat ${seatNumber} has already folded.`);

        if (action === PokerActionEnum.Fold) {
          data.folded = true;
          this.state.historyText.push(`${seat.playerName} folds.`);
          return success(true);
        }

        if (action === PokerActionEnum.Call) {
          const callAmount = this.state.currentBet - data.currentBet;
          const actualCall = Math.min(callAmount, data.chipBank);
          data.chipBank -= actualCall;
          data.currentBet += actualCall;
          this.state.pot += actualCall;
          this.state.historyText.push(`${seat.playerName} calls $${actualCall}.`);
          return success(true);
        }

        if (action === PokerActionEnum.Check) {
          if (data.currentBet < this.state.currentBet) {
            return failure(`Cannot check when there is a bet of $${this.state.currentBet}. Must call or fold.`);
          }
          this.state.historyText.push(`${seat.playerName} checks.`);
          return success(true);
        }

        if (action === PokerActionEnum.Bet || action === PokerActionEnum.Raise) {
          if (amount <= this.state.currentBet) {
            return failure(`Bet/raise amount ($${amount}) must exceed current bet ($${this.state.currentBet}).`);
          }
          const added = amount - data.currentBet;
          if (data.chipBank < added) return failure('Insufficient chips for raise.');
          data.chipBank -= added;
          data.currentBet = amount;
          this.state.currentBet = amount;
          this.state.pot += added;
          this.state.historyText.push(`${seat.playerName} raises to $${amount}.`);
          return success(true);
        }

        return success(true);
      },
      None: () => failure(`Seat ${seatNumber} not found`)
    });
  }

  /**
   * Evaluates hands at Showdown and awards pot to highest ranking player.
   */
  public resolveShowdown(): Result<TableSeat<PokerPlayerData>, string> {
    const active = this.seatManager.getOccupiedSeats().filter(s => !s.extraData.folded);
    if (active.length === 0) return failure('No active players remaining.');

    active.forEach(seat => {
      const combined = [...seat.extraData.holeCards, ...this.state.communityCards];
      seat.extraData.handRank = evaluatePokerHand(combined.slice(0, 5));
    });

    active.sort((a, b) => (b.extraData.handRank?.score || 0) - (a.extraData.handRank?.score || 0));
    const winner = active[0]!;
    winner.extraData.chipBank += this.state.pot;
    this.state.stage = PokerStageEnum.Settled;
    this.state.historyText.push(
      `${winner.playerName} wins pot of $${this.state.pot} with ${winner.extraData.handRank?.description}!`
    );

    return success(winner);
  }
}
