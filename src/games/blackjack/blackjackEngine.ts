import { match } from '../../utils/fp';
import { DeviceTierEnum } from '../../types';

export type CardSuit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
export type CardValue = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface PlayingCard {
  suit: CardSuit;
  value: CardValue;
  faceUp: boolean;
}

export type BlackjackAIModel = 'minimax' | 'micro-neural' | 'gemini-nano';
export type BlackjackDifficulty = 'cautious' | 'balanced' | 'ruthless';

export interface BlackjackHandEvaluation {
  total: number;
  isSoft: boolean;
  isBlackjack: boolean;
  isBusted: boolean;
}

export interface BlackjackGameState {
  shoe: PlayingCard[];
  playerHand: PlayingCard[];
  dealerHand: PlayingCard[];
  chipBank: number;
  currentBet: number;
  stage: 'betting' | 'player-turn' | 'dealer-turn' | 'round-over';
  outcome: 'in-progress' | 'player-won' | 'player-blackjack' | 'dealer-won' | 'push' | 'player-busted' | 'dealer-busted';
  aiModel: BlackjackAIModel;
  difficulty: BlackjackDifficulty;
  historyText: string[];
}

const SUIT_SYMBOLS: Record<CardSuit, string> = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠'
};

/**
 * Creates a standard shuffled deck shoe of playing cards.
 */
export function createShoe(deckCount: number = 2): PlayingCard[] {
  const suits: CardSuit[] = ['hearts', 'diamonds', 'clubs', 'spades'];
  const values: CardValue[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const shoe: PlayingCard[] = [];

  for (let d = 0; d < deckCount; d++) {
    for (const suit of suits) {
      for (const value of values) {
        shoe.push({ suit, value, faceUp: true });
      }
    }
  }

  // Fisher-Yates shuffle
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = shoe[i]!;
    shoe[i] = shoe[j]!;
    shoe[j] = temp;
  }

  return shoe;
}

/**
 * Evaluates the numerical total, soft status, and bust status of a hand.
 */
export function evaluateHand(cards: PlayingCard[], considerOnlyFaceUp: boolean = false): BlackjackHandEvaluation {
  const visibleCards = considerOnlyFaceUp ? cards.filter(c => c.faceUp) : cards;
  let total = 0;
  let aces = 0;

  for (const card of visibleCards) {
    if (card.value === 'A') {
      aces++;
      total += 11;
    } else if (['K', 'Q', 'J', '10'].includes(card.value)) {
      total += 10;
    } else {
      total += parseInt(card.value, 10);
    }
  }

  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }

  const isSoft = aces > 0;
  const isBlackjack = visibleCards.length === 2 && total === 21;
  const isBusted = total > 21;

  return { total, isSoft, isBlackjack, isBusted };
}

/**
 * Formats a card to displayable string (e.g. "K♠", "A♥", or "🂠 [Hidden]").
 */
export function formatCard(card: PlayingCard): string {
  if (!card.faceUp) return '🂠 Hidden';
  return `${card.value}${SUIT_SYMBOLS[card.suit]}`;
}

/**
 * Returns available AI models for the given device tier.
 */
export function getAvailableBlackjackAI(deviceTier: DeviceTierEnum): BlackjackAIModel[] {
  if (deviceTier === DeviceTierEnum.MobileLite) {
    return ['micro-neural', 'minimax'];
  }
  return ['gemini-nano', 'micro-neural', 'minimax'];
}

export class BlackjackEngine {
  public state: BlackjackGameState;

  constructor(
    initialBank: number = 500,
    aiModel: BlackjackAIModel = 'minimax',
    difficulty: BlackjackDifficulty = 'balanced'
  ) {
    this.state = {
      shoe: createShoe(2),
      playerHand: [],
      dealerHand: [],
      chipBank: initialBank,
      currentBet: 25,
      stage: 'betting',
      outcome: 'in-progress',
      aiModel,
      difficulty,
      historyText: ['Welcome to the High Gothic Blackjack Table. Place your bet.']
    };
  }

  public setAIModel(model: BlackjackAIModel): void {
    this.state.aiModel = model;
    this.state.historyText.push(`Cathedral Dealer AI calibrated to: ${model.toUpperCase()}.`);
  }

  public setDifficulty(difficulty: BlackjackDifficulty): void {
    this.state.difficulty = difficulty;
    this.state.historyText.push(`Opponent difficulty set to: ${difficulty.toUpperCase()}.`);
  }

  public placeBet(amount: number): boolean {
    if (amount <= 0 || amount > this.state.chipBank) return false;
    this.state.currentBet = amount;
    return true;
  }

  public startRound(): boolean {
    if (this.state.currentBet > this.state.chipBank) return false;
    if (this.state.shoe.length < 15) {
      this.state.shoe = createShoe(2);
      this.state.historyText.push('Shoe reshuffled with fresh consecrated decks.');
    }

    this.state.chipBank -= this.state.currentBet;
    this.state.playerHand = [this.state.shoe.pop()!, this.state.shoe.pop()!];
    const dealerFirst = this.state.shoe.pop()!;
    const dealerHole = this.state.shoe.pop()!;
    dealerHole.faceUp = false;
    this.state.dealerHand = [dealerFirst, dealerHole];

    const playerEval = evaluateHand(this.state.playerHand);
    const dealerEval = evaluateHand(this.state.dealerHand);

    if (playerEval.isBlackjack) {
      dealerHole.faceUp = true;
      if (dealerEval.isBlackjack) {
        this.state.stage = 'round-over';
        this.state.outcome = 'push';
        this.state.chipBank += this.state.currentBet;
        this.state.historyText.push('Mutual Natural Blackjack! A divine push.');
      } else {
        this.state.stage = 'round-over';
        this.state.outcome = 'player-blackjack';
        const winnings = Math.floor(this.state.currentBet * 2.5);
        this.state.chipBank += winnings;
        this.state.historyText.push(`Sanctuary Natural 21! Payout 3:2 (+${winnings - this.state.currentBet} Relics).`);
      }
    } else {
      this.state.stage = 'player-turn';
      this.state.outcome = 'in-progress';
      this.state.historyText.push(`Cards dealt. Player total: ${playerEval.total}. Dealer shows: ${formatCard(dealerFirst)}.`);
    }

    return true;
  }

  public hit(): BlackjackHandEvaluation {
    if (this.state.stage !== 'player-turn') return evaluateHand(this.state.playerHand);
    const card = this.state.shoe.pop()!;
    this.state.playerHand.push(card);
    const playerEval = evaluateHand(this.state.playerHand);

    if (playerEval.isBusted) {
      this.state.dealerHand.forEach(c => (c.faceUp = true));
      this.state.stage = 'round-over';
      this.state.outcome = 'player-busted';
      this.state.historyText.push(`Player draws ${formatCard(card)} and busts with ${playerEval.total}!`);
    } else if (playerEval.total === 21) {
      this.state.historyText.push(`Player hits 21 on ${formatCard(card)}! Standing automatically.`);
      this.stand();
    } else {
      this.state.historyText.push(`Player draws ${formatCard(card)}. Total: ${playerEval.total}.`);
    }

    return playerEval;
  }

  public doubleDown(): boolean {
    if (this.state.stage !== 'player-turn' || this.state.playerHand.length !== 2) return false;
    if (this.state.chipBank < this.state.currentBet) return false;

    this.state.chipBank -= this.state.currentBet;
    this.state.currentBet *= 2;
    const card = this.state.shoe.pop()!;
    this.state.playerHand.push(card);
    const playerEval = evaluateHand(this.state.playerHand);

    this.state.historyText.push(`Doubled down for ${this.state.currentBet} Relics! Received: ${formatCard(card)}.`);
    if (playerEval.isBusted) {
      this.state.dealerHand.forEach(c => (c.faceUp = true));
      this.state.stage = 'round-over';
      this.state.outcome = 'player-busted';
      this.state.historyText.push(`Busted on double down with ${playerEval.total}!`);
    } else {
      this.stand();
    }
    return true;
  }

  public stand(): void {
    if (this.state.stage !== 'player-turn') return;
    this.state.stage = 'dealer-turn';
    this.state.dealerHand.forEach(c => (c.faceUp = true));

    // Dealer AI decision threshold based on model & difficulty
    const standThreshold = match(this.state.difficulty, {
      cautious: () => 16,
      balanced: () => 17,
      ruthless: () => 18
    });

    let dealerEval = evaluateHand(this.state.dealerHand);
    this.state.historyText.push(`Dealer reveals hole card. Dealer total: ${dealerEval.total}.`);

    while (dealerEval.total < standThreshold) {
      const card = this.state.shoe.pop()!;
      this.state.dealerHand.push(card);
      dealerEval = evaluateHand(this.state.dealerHand);
      this.state.historyText.push(`Dealer draws ${formatCard(card)}. Dealer total: ${dealerEval.total}.`);
    }

    const playerEval = evaluateHand(this.state.playerHand);
    this.state.stage = 'round-over';

    if (dealerEval.isBusted) {
      this.state.outcome = 'dealer-busted';
      this.state.chipBank += this.state.currentBet * 2;
      this.state.historyText.push(`Dealer busts with ${dealerEval.total}! Player wins (+${this.state.currentBet} Relics).`);
    } else if (dealerEval.total > playerEval.total) {
      this.state.outcome = 'dealer-won';
      this.state.historyText.push(`Dealer wins (${dealerEval.total} vs ${playerEval.total}).`);
    } else if (playerEval.total > dealerEval.total) {
      this.state.outcome = 'player-won';
      this.state.chipBank += this.state.currentBet * 2;
      this.state.historyText.push(`Player triumphs (${playerEval.total} vs ${dealerEval.total}, +${this.state.currentBet} Relics)!`);
    } else {
      this.state.outcome = 'push';
      this.state.chipBank += this.state.currentBet;
      this.state.historyText.push(`Push (${playerEval.total} each). Bets returned.`);
    }
  }
}
