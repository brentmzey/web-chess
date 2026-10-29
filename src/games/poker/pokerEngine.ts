import {
  Option,
  some,
  none,
  Result,
  success,
  failure
} from '../../utils/fp';
import {
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

export interface EvaluatedHand {
  rank: PokerHandRankEnum;
  score: number;
  description: string;
}

export interface PokerPlayerData {
  holeCards: PlayingCard[];
  currentBet: number;
  chipBank: number;
  folded: boolean;
  isAllIn: boolean;
  handRank?: EvaluatedHand;
}

export interface PokerGameState {
  variant: PokerVariantEnum;
  stage: PokerStageEnum;
  pot: number;
  currentBet: number;
  smallBlind: number;
  bigBlind: number;
  communityCards: PlayingCard[];
  activeSeatTurn: Option<number>;
  historyText: string[];
}

/**
 * Converts a PlayingCard value string into numeric ranking (2=2 ... 10=10, J=11, Q=12, K=13, A=14).
 */
export function getCardNumericValue(card: PlayingCard): number {
  switch (card.value) {
    case '2':
      return 2;
    case '3':
      return 3;
    case '4':
      return 4;
    case '5':
      return 5;
    case '6':
      return 6;
    case '7':
      return 7;
    case '8':
      return 8;
    case '9':
      return 9;
    case '10':
      return 10;
    case 'J':
      return 11;
    case 'Q':
      return 12;
    case 'K':
      return 13;
    case 'A':
      return 14;
    default:
      return 0;
  }
}

/**
 * Evaluates any 5-card poker hand and assigns a canonical rank and score.
 */
export function evaluate5CardPokerHand(cards: PlayingCard[]): EvaluatedHand {
  if (cards.length !== 5) {
    return {
      rank: PokerHandRankEnum.HighCard,
      score: 0,
      description: 'Incomplete hand'
    };
  }

  const numericValues = cards.map(getCardNumericValue).sort((a, b) => b - a);

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
      score: POKER_HAND_VALUES[PokerHandRankEnum.StraightFlush] * 1000 + (isWheelStraight ? 5 : numericValues[0]),
      description: `Straight Flush (${isWheelStraight ? 5 : numericValues[0]} high)`
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
    const highCard = isWheelStraight ? 5 : numericValues[0];
    return {
      rank: PokerHandRankEnum.Straight,
      score: POKER_HAND_VALUES[PokerHandRankEnum.Straight] * 1000 + highCard,
      description: `Straight (${highCard} high)`
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
    const higherPair = Math.max(countEntries[0]?.value || 0, countEntries[1]?.value || 0);
    const lowerPair = Math.min(countEntries[0]?.value || 0, countEntries[1]?.value || 0);
    return {
      rank: PokerHandRankEnum.TwoPair,
      score: POKER_HAND_VALUES[PokerHandRankEnum.TwoPair] * 1000 + higherPair * 10 + lowerPair,
      description: `Two Pair (${higherPair}s and ${lowerPair}s)`
    };
  }

  // 8. One Pair
  if (countEntries[0]?.count === 2) {
    return {
      rank: PokerHandRankEnum.OnePair,
      score: POKER_HAND_VALUES[PokerHandRankEnum.OnePair] * 1000 + (countEntries[0]?.value || 0),
      description: `One Pair of ${countEntries[0]?.value}s`
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
 * Generates all combinations of k elements from array.
 */
function getCombinations<T>(array: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (array.length === 0) return [];
  const head = array[0]!;
  const tail = array.slice(1);
  const withHead = getCombinations(tail, k - 1).map(comb => [head, ...comb]);
  const withoutHead = getCombinations(tail, k);
  return [...withHead, ...withoutHead];
}

/**
 * Evaluates the best possible 5-card poker hand from available cards based on variant.
 */
export function evaluatePokerHand(
  cards: PlayingCard[],
  variant: PokerVariantEnum = PokerVariantEnum.TexasHoldem,
  holeCards?: PlayingCard[]
): EvaluatedHand {
  if (variant === PokerVariantEnum.Omaha && holeCards && holeCards.length === 4 && cards.length >= 3) {
    // Omaha rule: MUST pick exactly 2 hole cards and exactly 3 community cards
    const holePairs = getCombinations(holeCards, 2);
    const communityTriplets = getCombinations(cards, 3);
    let bestHand: EvaluatedHand = {
      rank: PokerHandRankEnum.HighCard,
      score: 0,
      description: 'High Card'
    };

    holePairs.forEach(hPair => {
      communityTriplets.forEach(cTrip => {
        const candidate5 = [...hPair, ...cTrip];
        const evaluated = evaluate5CardPokerHand(candidate5);
        if (evaluated.score > bestHand.score) {
          bestHand = evaluated;
        }
      });
    });
    return bestHand;
  }

  if (cards.length === 5) {
    return evaluate5CardPokerHand(cards);
  }

  if (cards.length > 5) {
    const combs = getCombinations(cards, 5);
    let bestHand: EvaluatedHand = {
      rank: PokerHandRankEnum.HighCard,
      score: 0,
      description: 'High Card'
    };
    combs.forEach(fiveCards => {
      const eval5 = evaluate5CardPokerHand(fiveCards);
      if (eval5.score > bestHand.score) {
        bestHand = eval5;
      }
    });
    return bestHand;
  }

  return evaluate5CardPokerHand(cards);
}

export function createDefaultPokerPlayerData(): PokerPlayerData {
  return {
    holeCards: [],
    currentBet: 0,
    chipBank: 1000,
    folded: false,
    isAllIn: false,
    handRank: undefined
  };
}

export class CathedralPokerEngine {
  public state: PokerGameState;
  public seatManager: TableSeatManager<PokerPlayerData>;
  private shoe: PlayingCard[] = [];

  constructor(variant: PokerVariantEnum = PokerVariantEnum.TexasHoldem,
              maxSeats: number = 10,
              smallBlind: number = 10,
              bigBlind: number = 20) {
    this.seatManager = new TableSeatManager<PokerPlayerData>(maxSeats,
                                                            2,
                                                            AIModelEnum.MicroNeural,
                                                            () => createDefaultPokerPlayerData());

    this.state = {
      variant,
      stage: PokerStageEnum.Lobby,
      pot: 0,
      currentBet: bigBlind,
      smallBlind,
      bigBlind,
      communityCards: [],
      activeSeatTurn: none(),
      historyText: [`Cathedral Poker Table opened (${variant}).`]
    };
  }

  public populateBotOpponents(botModel: AIModelEnum = AIModelEnum.MicroNeural, prefix: string = 'PokerBot'): number {
    return this.seatManager.fillEmptySeatsWithBots(botModel, prefix);
  }

  /**
   * Dynamically adds a human or AI player to the next available Poker seat (or hot-swaps a bot seat for a human).
   */
  public addPlayer(playerName: string,
                   isBot: boolean = false): Result<TableSeat<PokerPlayerData>, string> {
    const defaultData: PokerPlayerData = {
      holeCards: [],
      currentBet: 0,
      chipBank: 1000,
      folded: false,
      isAllIn: false
    };
    if (!isBot) {
      return this.seatManager.claimAnyAvailableSeat(
        `usr_${this.seatManager.getHumanCount() + 1}`,
        playerName,
        defaultData
      );
    }
    const emptySeat = this.seatManager.getAllSeats().find(s => !s.isOccupied);
    if (!emptySeat) {
      return failure(`All ${this.seatManager.getMaxSeats()} Poker seats are already occupied.`);
    }
    const res = this.seatManager.claimSeat(emptySeat.seatNumber, `bot_${emptySeat.seatNumber}`, playerName, defaultData);
    this.seatManager.vacateSeat(emptySeat.seatNumber, AIModelEnum.MicroNeural, playerName);
    return res;
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
      seat.extraData = {
        holeCards: [],
        currentBet: 0,
        chipBank: typeof seat.extraData?.chipBank === 'number' ? seat.extraData.chipBank : 1000,
        folded: false,
        isAllIn: false,
        handRank: undefined
      };
    });

    // Deal hole cards based on variant
    let cardsPerPlayer = 2;
    if (this.state.variant === PokerVariantEnum.Omaha) cardsPerPlayer = 4;
    else if (this.state.variant === PokerVariantEnum.FiveCardDraw) cardsPerPlayer = 5;
    else if (this.state.variant === PokerVariantEnum.SevenCardStud) cardsPerPlayer = 3; // 2 down, 1 up initially

    for (let i = 0; i < cardsPerPlayer; i++) {
      activeSeats.forEach(seat => {
        const card = this.shoe.pop()!;
        if (this.state.variant === PokerVariantEnum.SevenCardStud) {
          card.faceUp = i === 2 || !seat.isBot; // 3rd card face up in Stud
        } else {
          card.faceUp = !seat.isBot;
        }
        seat.extraData.holeCards.push(card);
      });
    }

    // Deduct Small & Big Blinds (or Antes)
    const sbSeat = activeSeats[0]!;
    const bbSeat = activeSeats[1]!;

    const sbDeduct = Math.min(this.state.smallBlind, sbSeat.extraData.chipBank);
    sbSeat.extraData.chipBank -= sbDeduct;
    sbSeat.extraData.currentBet = sbDeduct;

    const bbDeduct = Math.min(this.state.bigBlind, bbSeat.extraData.chipBank);
    bbSeat.extraData.chipBank -= bbDeduct;
    bbSeat.extraData.currentBet = bbDeduct;

    this.state.pot = sbDeduct + bbDeduct;
    this.state.currentBet = bbDeduct;
    this.state.activeSeatTurn = some(activeSeats[activeSeats.length > 2 ? 2 : 0]!.seatNumber);

    this.state.historyText.push(
      `Hand started (${this.state.variant}). Blinds posted: ${sbSeat.playerName} ($${sbDeduct}), ${bbSeat.playerName} ($${bbDeduct}). Pot: $${this.state.pot}`
    );
    logger.info(`[SERVER_SIDE] [POKER_TRACE] Hand dealt (${this.state.variant}). Active pot: $${this.state.pot}`);

    return success(this.state.pot);
  }

  /**
   * Deals the Flop (3 community cards).
   */
  public dealFlop(): Result<PlayingCard[], string> {
    if (this.state.variant === PokerVariantEnum.FiveCardDraw || this.state.variant === PokerVariantEnum.SevenCardStud) {
      return failure(`Flop not used in ${this.state.variant}`);
    }

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
   * Deals the Turn (4th community card).
   */
  public dealTurn(): Result<PlayingCard, string> {
    if (this.state.stage !== PokerStageEnum.Flop) {
      return failure(`Cannot deal turn during stage ${this.state.stage}`);
    }
    this.shoe.pop(); // Burn
    const turnCard = this.shoe.pop()!;
    turnCard.faceUp = true;
    this.state.communityCards.push(turnCard);
    this.state.stage = PokerStageEnum.Turn;
    this.state.historyText.push('The Turn is dealt.');
    return success(turnCard);
  }

  /**
   * Deals the River (5th community card).
   */
  public dealRiver(): Result<PlayingCard, string> {
    if (this.state.stage !== PokerStageEnum.Turn) {
      return failure(`Cannot deal river during stage ${this.state.stage}`);
    }
    this.shoe.pop(); // Burn
    const riverCard = this.shoe.pop()!;
    riverCard.faceUp = true;
    this.state.communityCards.push(riverCard);
    this.state.stage = PokerStageEnum.River;
    this.state.historyText.push('The River is dealt.');
    return success(riverCard);
  }

  /**
   * Draw phase for Five-Card Draw: player can discard up to 3 cards and draw replacements.
   */
  public drawCardsFiveCardDraw(seatNumber: number, discardIndices: number[]): Result<PlayingCard[], string> {
    if (this.state.variant !== PokerVariantEnum.FiveCardDraw) {
      return failure('Draw phase is only valid in Five-Card Draw.');
    }

    const seatOpt = this.seatManager.getSeat(seatNumber);
    return seatOpt.match({
      None: () => failure(`Seat ${seatNumber} not found.`),
      Some: seat => {
        if (discardIndices.length > 3) {
          return failure('May only discard up to 3 cards.');
        }

        // Remove discards
        const sorted = [...discardIndices].sort((a, b) => b - a);
        sorted.forEach(idx => {
          if (idx >= 0 && idx < seat.extraData.holeCards.length) {
            seat.extraData.holeCards.splice(idx, 1);
          }
        });

        // Draw replacements
        const drawn: PlayingCard[] = [];
        for (let i = 0; i < sorted.length; i++) {
          const card = this.shoe.pop()!;
          card.faceUp = !seat.isBot;
          seat.extraData.holeCards.push(card);
          drawn.push(card);
        }

        this.state.historyText.push(`${seat.playerName} exchanged ${sorted.length} cards.`);
        return success(drawn);
      }
    });
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
      if (this.state.variant === PokerVariantEnum.Omaha) {
        seat.extraData.handRank = evaluatePokerHand(
          this.state.communityCards,
          PokerVariantEnum.Omaha,
          seat.extraData.holeCards
        );
      } else if (this.state.variant === PokerVariantEnum.FiveCardDraw) {
        seat.extraData.handRank = evaluatePokerHand(seat.extraData.holeCards);
      } else {
        const combined = [...seat.extraData.holeCards, ...this.state.communityCards];
        seat.extraData.handRank = evaluatePokerHand(combined);
      }
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
