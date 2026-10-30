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
  totalHandBet: number;
  chipBank: number;
  folded: boolean;
  isAllIn: boolean;
  hasActedThisStreet: boolean;
  handRank?: EvaluatedHand;
}

export interface PokerGameState {
  variant: PokerVariantEnum;
  stage: PokerStageEnum;
  pot: number;
  currentBet: number;
  minRaise: number;
  smallBlind: number;
  bigBlind: number;
  dealerSeat: number;
  communityCards: PlayingCard[];
  activeSeatTurn: Option<number>;
  historyText: string[];
  winners?: TableSeat<PokerPlayerData>[];
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
export function evaluatePokerHand(cards: PlayingCard[],
                                  variant: PokerVariantEnum = PokerVariantEnum.TexasHoldem,
                                  holeCards?: PlayingCard[]): EvaluatedHand {
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
    totalHandBet: 0,
    chipBank: 1000,
    folded: false,
    isAllIn: false,
    hasActedThisStreet: false,
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
      minRaise: bigBlind,
      smallBlind,
      bigBlind,
      dealerSeat: 1,
      communityCards: [],
      activeSeatTurn: none(),
      historyText: [`Cathedral Poker Table opened (${variant}).`]
    };
  }

  public populateBotOpponents(botModel: AIModelEnum = AIModelEnum.MicroNeural,
                              prefix: string = 'PokerBot'): number {
    return this.seatManager.fillEmptySeatsWithBots(botModel, prefix);
  }

  /**
   * Dynamically adds a human or AI player to the next available Poker seat.
   */
  public addPlayer(playerName: string,
                   isBot: boolean = false): Result<TableSeat<PokerPlayerData>, string> {
    const defaultData = createDefaultPokerPlayerData();
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
    const activeSeats = this.seatManager.getOccupiedSeats().filter(s => s.extraData.chipBank > 0);
    if (activeSeats.length < 2) {
      return failure('Need at least 2 players with chips to start a poker hand.');
    }

    this.shoe = createShoe(1);
    this.state.pot = 0;
    this.state.communityCards = [];
    this.state.stage = PokerStageEnum.PreFlop;
    this.state.winners = undefined;

    // Reset each player's hand state
    activeSeats.forEach(seat => {
      seat.extraData.holeCards = [];
      seat.extraData.currentBet = 0;
      seat.extraData.totalHandBet = 0;
      seat.extraData.folded = false;
      seat.extraData.isAllIn = false;
      seat.extraData.hasActedThisStreet = false;
      seat.extraData.handRank = undefined;
    });

    // Advance Dealer button clockwise among active occupied seats
    const currentDealerIdx = activeSeats.findIndex(s => s.seatNumber === this.state.dealerSeat);
    const newDealerIdx = currentDealerIdx >= 0 ? (currentDealerIdx + 1) % activeSeats.length : 0;
    this.state.dealerSeat = activeSeats[newDealerIdx]!.seatNumber;

    // Deal hole cards based on variant
    let cardsPerPlayer = 2;
    if (this.state.variant === PokerVariantEnum.Omaha) cardsPerPlayer = 4;
    else if (this.state.variant === PokerVariantEnum.FiveCardDraw) cardsPerPlayer = 5;
    else if (this.state.variant === PokerVariantEnum.SevenCardStud) cardsPerPlayer = 3;

    for (let i = 0; i < cardsPerPlayer; i++) {
      activeSeats.forEach(seat => {
        const card = this.shoe.pop()!;
        if (this.state.variant === PokerVariantEnum.SevenCardStud) {
          card.faceUp = i === 2 || !seat.isBot;
        } else {
          card.faceUp = !seat.isBot;
        }
        seat.extraData.holeCards.push(card);
      });
    }

    // Determine Small Blind and Big Blind positions
    let sbSeat: TableSeat<PokerPlayerData>;
    let bbSeat: TableSeat<PokerPlayerData>;
    let firstToAct: TableSeat<PokerPlayerData>;

    if (activeSeats.length === 2) {
      // Heads-up rule: Dealer is Small Blind and acts first pre-flop; non-dealer is Big Blind
      sbSeat = activeSeats[newDealerIdx]!;
      bbSeat = activeSeats[(newDealerIdx + 1) % 2]!;
      firstToAct = sbSeat;
    } else {
      const sbIdx = (newDealerIdx + 1) % activeSeats.length;
      const bbIdx = (newDealerIdx + 2) % activeSeats.length;
      const utgIdx = (newDealerIdx + 3) % activeSeats.length;
      sbSeat = activeSeats[sbIdx]!;
      bbSeat = activeSeats[bbIdx]!;
      firstToAct = activeSeats[utgIdx]!;
    }

    // Deduct Small Blind
    const sbDeduct = Math.min(this.state.smallBlind, sbSeat.extraData.chipBank);
    sbSeat.extraData.chipBank -= sbDeduct;
    sbSeat.extraData.currentBet = sbDeduct;
    sbSeat.extraData.totalHandBet = sbDeduct;
    if (sbSeat.extraData.chipBank === 0) sbSeat.extraData.isAllIn = true;

    // Deduct Big Blind
    const bbDeduct = Math.min(this.state.bigBlind, bbSeat.extraData.chipBank);
    bbSeat.extraData.chipBank -= bbDeduct;
    bbSeat.extraData.currentBet = bbDeduct;
    bbSeat.extraData.totalHandBet = bbDeduct;
    if (bbSeat.extraData.chipBank === 0) bbSeat.extraData.isAllIn = true;

    this.state.pot = sbDeduct + bbDeduct;
    this.state.currentBet = Math.max(sbDeduct, bbDeduct);
    this.state.minRaise = this.state.bigBlind;
    this.state.activeSeatTurn = some(firstToAct.seatNumber);

    this.state.historyText.push(
      `Hand started (${this.state.variant}). Dealer: S${this.state.dealerSeat}. Blinds: ${sbSeat.playerName} ($${sbDeduct}), ${bbSeat.playerName} ($${bbDeduct}). Pot: $${this.state.pot}`
    );
    logger.info(`[SERVER_SIDE] [POKER_TRACE] Hand dealt (${this.state.variant}). Active pot: $${this.state.pot}`);

    return success(this.state.pot);
  }

  /**
   * Helper to check whether the current betting street has reached conclusion.
   */
  public isStreetComplete(): boolean {
    const active = this.seatManager.getOccupiedSeats().filter(s => !s.extraData.folded);
    if (active.length <= 1) return true;

    const nonAllIn = active.filter(s => !s.extraData.isAllIn);
    // If all remaining players are all-in (or only 1 non-all-in remains who has matched current bet)
    if (nonAllIn.length === 0) return true;
    if (nonAllIn.length === 1 && nonAllIn[0]!.extraData.hasActedThisStreet && nonAllIn[0]!.extraData.currentBet === this.state.currentBet) {
      return true;
    }

    return nonAllIn.every(s => s.extraData.hasActedThisStreet && s.extraData.currentBet === this.state.currentBet);
  }

  /**
   * Advance turn clockwise to the next active player who is not folded and not all-in.
   */
  private advanceToNextTurn(actingSeatNumber: number): void {
    const occupied = this.seatManager.getOccupiedSeats();
    const activeEligible = occupied.filter(s => !s.extraData.folded && !s.extraData.isAllIn);

    if (activeEligible.length === 0) {
      this.state.activeSeatTurn = none();
      return;
    }

    const currentIdx = occupied.findIndex(s => s.seatNumber === actingSeatNumber);
    for (let step = 1; step <= occupied.length; step++) {
      const nextSeat = occupied[(currentIdx + step) % occupied.length]!;
      if (!nextSeat.extraData.folded && !nextSeat.extraData.isAllIn) {
        this.state.activeSeatTurn = some(nextSeat.seatNumber);
        return;
      }
    }

    this.state.activeSeatTurn = none();
  }

  /**
   * Advances game stage to the next betting street.
   */
  public advanceStreet(): void {
    // Reset round bets
    this.seatManager.getOccupiedSeats().forEach(s => {
      s.extraData.currentBet = 0;
      s.extraData.hasActedThisStreet = false;
    });
    this.state.currentBet = 0;
    this.state.minRaise = this.state.bigBlind;

    const stage = this.state.stage;
    if (stage === PokerStageEnum.PreFlop) {
      if (this.state.variant === PokerVariantEnum.FiveCardDraw) {
        this.state.stage = PokerStageEnum.Turn;
      } else {
        this.dealFlop();
      }
    } else if (stage === PokerStageEnum.Flop) {
      this.dealTurn();
    } else if (stage === PokerStageEnum.Turn) {
      this.dealRiver();
    } else if (stage === PokerStageEnum.River) {
      this.resolveShowdown();
      return;
    }

    // Set first turn post-flop: first active seat clockwise after Dealer
    if (this.state.stage !== PokerStageEnum.Settled) {
      const occupied = this.seatManager.getOccupiedSeats();
      const dealerIdx = occupied.findIndex(s => s.seatNumber === this.state.dealerSeat);
      let foundTurn = false;

      for (let step = 1; step <= occupied.length; step++) {
        const nextSeat = occupied[(dealerIdx + step) % occupied.length]!;
        if (!nextSeat.extraData.folded && !nextSeat.extraData.isAllIn) {
          this.state.activeSeatTurn = some(nextSeat.seatNumber);
          foundTurn = true;
          break;
        }
      }

      if (!foundTurn) {
        // All active players are all-in; automatically run out the remaining community cards!
        this.state.activeSeatTurn = none();
        this.autoRunOutShowdown();
        return;
      }

      this.executeBotTurns();
    }
  }

  /**
   * Automatically deals out remaining streets when all active players are all-in.
   */
  private autoRunOutShowdown(): void {
    while (this.state.stage !== PokerStageEnum.Settled) {
      if (this.state.stage === PokerStageEnum.PreFlop) {
        this.dealFlop();
      } else if (this.state.stage === PokerStageEnum.Flop) {
        this.dealTurn();
      } else if (this.state.stage === PokerStageEnum.Turn) {
        this.dealRiver();
      } else if (this.state.stage === PokerStageEnum.River) {
        this.resolveShowdown();
        break;
      }
    }
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

    this.shoe.pop(); // Burn 1 card
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
  public drawCardsFiveCardDraw(seatNumber: number,
                               discardIndices: number[]): Result<PlayingCard[], string> {
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

        const sorted = [...discardIndices].sort((a, b) => b - a);
        sorted.forEach(idx => {
          if (idx >= 0 && idx < seat.extraData.holeCards.length) {
            seat.extraData.holeCards.splice(idx, 1);
          }
        });

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
  public playerAction(seatNumber: number,
                      action: PokerActionEnum,
                      amount: number = 0): Result<boolean, string> {
    const seatOpt = this.seatManager.getSeat(seatNumber);
    return seatOpt.match({
      Some: seat => {
        const data = seat.extraData;
        if (data.folded) return failure(`Seat ${seatNumber} has already folded.`);

        // Handle Fold
        if (action === PokerActionEnum.Fold) {
          data.folded = true;
          data.hasActedThisStreet = true;
          this.state.historyText.push(`${seat.playerName} folds.`);

          // Immediate win check if only 1 unfolded player remains
          const activeUnfolded = this.seatManager.getOccupiedSeats().filter(s => !s.extraData.folded);
          if (activeUnfolded.length === 1) {
            const winner = activeUnfolded[0]!;
            winner.extraData.chipBank += this.state.pot;
            this.state.stage = PokerStageEnum.Settled;
            this.state.activeSeatTurn = none();
            this.state.winners = [winner];
            this.state.historyText.push(
              `${winner.playerName} wins pot of $${this.state.pot} (all opponents folded)!`
            );
            return success(true);
          }

          if (this.isStreetComplete()) {
            this.advanceStreet();
          } else {
            this.advanceToNextTurn(seatNumber);
            this.executeBotTurns();
          }
          return success(true);
        }

        // Handle Check
        if (action === PokerActionEnum.Check) {
          if (data.currentBet < this.state.currentBet) {
            return failure(`Cannot check when there is a bet of $${this.state.currentBet}. Must call or fold.`);
          }
          data.hasActedThisStreet = true;
          this.state.historyText.push(`${seat.playerName} checks.`);

          if (this.isStreetComplete()) {
            this.advanceStreet();
          } else {
            this.advanceToNextTurn(seatNumber);
            this.executeBotTurns();
          }
          return success(true);
        }

        // Handle Call
        if (action === PokerActionEnum.Call) {
          const callAmount = this.state.currentBet - data.currentBet;
          const actualCall = Math.min(callAmount, data.chipBank);
          data.chipBank -= actualCall;
          data.currentBet += actualCall;
          data.totalHandBet += actualCall;
          this.state.pot += actualCall;
          if (data.chipBank === 0) data.isAllIn = true;
          data.hasActedThisStreet = true;
          this.state.historyText.push(`${seat.playerName} calls $${actualCall}.`);

          if (this.isStreetComplete()) {
            this.advanceStreet();
          } else {
            this.advanceToNextTurn(seatNumber);
            this.executeBotTurns();
          }
          return success(true);
        }

        // Handle Bet / Raise
        if (action === PokerActionEnum.Bet || action === PokerActionEnum.Raise) {
          if (amount <= this.state.currentBet) {
            return failure(`Bet/raise amount ($${amount}) must exceed current bet ($${this.state.currentBet}).`);
          }
          const added = amount - data.currentBet;
          if (data.chipBank < added) return failure('Insufficient chips for raise.');

          const raiseInc = amount - this.state.currentBet;
          this.state.minRaise = Math.max(this.state.minRaise, raiseInc);

          data.chipBank -= added;
          data.currentBet = amount;
          data.totalHandBet += added;
          this.state.currentBet = amount;
          this.state.pot += added;
          if (data.chipBank === 0) data.isAllIn = true;
          data.hasActedThisStreet = true;

          // Reset hasActedThisStreet for all other active, non-all-in players
          this.seatManager.getOccupiedSeats().forEach(s => {
            if (s.seatNumber !== seatNumber && !s.extraData.folded && !s.extraData.isAllIn) {
              s.extraData.hasActedThisStreet = false;
            }
          });

          this.state.historyText.push(`${seat.playerName} raises to $${amount}.`);

          if (this.isStreetComplete()) {
            this.advanceStreet();
          } else {
            this.advanceToNextTurn(seatNumber);
            this.executeBotTurns();
          }
          return success(true);
        }

        // Handle All-In
        if (action === PokerActionEnum.AllIn) {
          const allInAmount = data.chipBank;
          const totalNewBet = data.currentBet + allInAmount;
          data.chipBank = 0;
          data.isAllIn = true;
          data.currentBet = totalNewBet;
          data.totalHandBet += allInAmount;
          this.state.pot += allInAmount;
          data.hasActedThisStreet = true;

          if (totalNewBet > this.state.currentBet) {
            this.state.currentBet = totalNewBet;
            // Other players must respond to new high bet
            this.seatManager.getOccupiedSeats().forEach(s => {
              if (s.seatNumber !== seatNumber && !s.extraData.folded && !s.extraData.isAllIn) {
                s.extraData.hasActedThisStreet = false;
              }
            });
          }

          this.state.historyText.push(`${seat.playerName} goes ALL-IN for $${totalNewBet}!`);

          if (this.isStreetComplete()) {
            this.advanceStreet();
          } else {
            this.advanceToNextTurn(seatNumber);
            this.executeBotTurns();
          }
          return success(true);
        }

        return success(true);
      },
      None: () => failure(`Seat ${seatNumber} not found`)
    });
  }

  /**
   * Autonomous AI decision cycle for bot opponents.
   */
  public executeBotTurns(): void {
    let loopGuard = 0;
    while (
      this.state.activeSeatTurn.isSome() &&
      this.state.stage !== PokerStageEnum.Settled &&
      this.state.stage !== PokerStageEnum.Lobby &&
      loopGuard < 20
    ) {
      loopGuard++;
      const currentSeatNum = this.state.activeSeatTurn.getOrThrow();
      const seatOpt = this.seatManager.getSeat(currentSeatNum);
      if (!seatOpt.isSome()) break;

      const seat = seatOpt.getOrThrow();
      // If it's a human player's turn, pause autonomous loop to await human action
      if (!seat.isBot) break;

      if (seat.extraData.folded || seat.extraData.isAllIn) {
        this.advanceToNextTurn(currentSeatNum);
        continue;
      }

      // Compute Bot Action
      const toCall = this.state.currentBet - seat.extraData.currentBet;
      const hole = seat.extraData.holeCards;
      const community = this.state.communityCards;

      if (this.state.stage === PokerStageEnum.PreFlop) {
        // Pre-flop basic evaluation
        const card1 = hole[0] ? getCardNumericValue(hole[0]) : 0;
        const card2 = hole[1] ? getCardNumericValue(hole[1]) : 0;
        const isPair = card1 === card2;
        const highCard = Math.max(card1, card2);

        if (toCall === 0) {
          this.playerAction(currentSeatNum, PokerActionEnum.Check);
        } else if (isPair || highCard >= 11 || toCall <= this.state.bigBlind) {
          this.playerAction(currentSeatNum, PokerActionEnum.Call);
        } else if (toCall <= this.state.bigBlind * 2) {
          this.playerAction(currentSeatNum, PokerActionEnum.Call);
        } else {
          this.playerAction(currentSeatNum, PokerActionEnum.Fold);
        }
      } else {
        // Post-flop evaluation
        const evalHand = evaluatePokerHand([...hole, ...community], this.state.variant, hole);
        if (toCall === 0) {
          if (evalHand.rank >= PokerHandRankEnum.TwoPair) {
            const raiseAmt = this.state.currentBet + this.state.bigBlind;
            if (seat.extraData.chipBank >= raiseAmt) {
              this.playerAction(currentSeatNum, PokerActionEnum.Raise, raiseAmt);
            } else {
              this.playerAction(currentSeatNum, PokerActionEnum.Check);
            }
          } else {
            this.playerAction(currentSeatNum, PokerActionEnum.Check);
          }
        } else {
          if (evalHand.rank >= PokerHandRankEnum.OnePair || toCall <= this.state.bigBlind) {
            this.playerAction(currentSeatNum, PokerActionEnum.Call);
          } else {
            this.playerAction(currentSeatNum, PokerActionEnum.Fold);
          }
        }
      }
    }
  }

  /**
   * Evaluates hands at Showdown and awards pot to highest ranking player(s).
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

    // Handle potential tie / split pot
    const highestScore = active[0]!.extraData.handRank?.score || 0;
    const tiedWinners = active.filter(s => (s.extraData.handRank?.score || 0) === highestScore);

    const share = Math.floor(this.state.pot / tiedWinners.length);
    tiedWinners.forEach((w, idx) => {
      w.extraData.chipBank += share + (idx === 0 ? this.state.pot % tiedWinners.length : 0);
    });

    this.state.stage = PokerStageEnum.Settled;
    this.state.activeSeatTurn = none();
    this.state.winners = tiedWinners;

    if (tiedWinners.length > 1) {
      this.state.historyText.push(
        `Split Pot! ${tiedWinners.map(w => w.playerName).join(' and ')} split $${this.state.pot} with ${tiedWinners[0]!.extraData.handRank?.description}!`
      );
    } else {
      const winner = tiedWinners[0]!;
      this.state.historyText.push(
        `${winner.playerName} wins pot of $${this.state.pot} with ${winner.extraData.handRank?.description}!`
      );
    }

    return success(tiedWinners[0]!);
  }

  /**
   * Returns the undealt cards so a synchronized table deals the same next cards on every client.
   */
  public exportShoe(): readonly PlayingCard[] {
    return [...this.shoe];
  }

  public importShoe(shoe: readonly PlayingCard[]): void {
    this.shoe = [...shoe];
  }
}
