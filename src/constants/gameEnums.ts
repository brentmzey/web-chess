/**
 * Centralized Game Enums & Constants
 * Replaces ad-hoc string literals with type-safe enums and constant values.
 */

export enum CardSuitEnum {
  Hearts = 'hearts',
  Diamonds = 'diamonds',
  Clubs = 'clubs',
  Spades = 'spades'
}

export enum CardValueEnum {
  Two = '2',
  Three = '3',
  Four = '4',
  Five = '5',
  Six = '6',
  Seven = '7',
  Eight = '8',
  Nine = '9',
  Ten = '10',
  Jack = 'J',
  Queen = 'Q',
  King = 'K',
  Ace = 'A'
}

export const CARD_SUITS: readonly CardSuitEnum[] = [
  CardSuitEnum.Hearts,
  CardSuitEnum.Diamonds,
  CardSuitEnum.Clubs,
  CardSuitEnum.Spades
];

export const CARD_VALUES: readonly CardValueEnum[] = [
  CardValueEnum.Two,
  CardValueEnum.Three,
  CardValueEnum.Four,
  CardValueEnum.Five,
  CardValueEnum.Six,
  CardValueEnum.Seven,
  CardValueEnum.Eight,
  CardValueEnum.Nine,
  CardValueEnum.Ten,
  CardValueEnum.Jack,
  CardValueEnum.Queen,
  CardValueEnum.King,
  CardValueEnum.Ace
];

export enum ArcadeGameEnum {
  Chess = 'chess',
  Blackjack = 'blackjack',
  Avalon = 'avalon',
  Uno = 'uno',
  Phase10 = 'phase10',
  Poker = 'poker'
}

export enum GameCodePrefixEnum {
  Sanctuary = 'SANCT-',
  Blackjack = 'BJK-',
  Avalon = 'AVALON-',
  Uno = 'UNO-',
  Phase10 = 'P10-',
  Poker = 'POKER-'
}

export enum AIModelEnum {
  Minimax = 'minimax',
  MicroNeural = 'micro-neural',
  GeminiNano = 'gemini-nano'
}

export enum DifficultyEnum {
  Cautious = 'cautious',
  Balanced = 'balanced',
  Ruthless = 'ruthless',
  Aggressive = 'aggressive'
}

export enum BlackjackActionEnum {
  Bet = 'bet',
  Hit = 'hit',
  Stand = 'stand',
  Double = 'double',
  Split = 'split',
  Surrender = 'surrender'
}

export enum BlackjackStageEnum {
  Betting = 'betting',
  Dealing = 'dealing',
  PlayerTurns = 'player-turns',
  PlayerTurn = 'player-turn',
  DealerTurn = 'dealer-turn',
  RoundSettled = 'round-settled',
  RoundOver = 'round-over'
}

export enum BlackjackOutcomeEnum {
  InProgress = 'in-progress',
  Won = 'won',
  Lost = 'lost',
  Push = 'push',
  Blackjack = 'blackjack',
  PlayerBlackjack = 'player-blackjack',
  PlayerWon = 'player-won',
  DealerWon = 'dealer-won',
  PlayerBusted = 'player-busted',
  DealerBusted = 'dealer-busted'
}

export enum HotSwapActionEnum {
  BotFilled = 'bot_filled',
  HumanClaimed = 'human_claimed',
  HumanVacatedBotRestored = 'human_vacated_bot_restored'
}

export enum SeatHandStatusEnum {
  Waiting = 'waiting',
  Betting = 'betting',
  Playing = 'playing',
  Stood = 'stood',
  Busted = 'busted',
  Blackjack = 'blackjack',
  Settled = 'settled'
}

export enum LiveRoleEnum {
  White = 'white',
  Black = 'black',
  Spectator = 'spectator'
}

// ============================================================================
// POKER ENUMS & CONSTANTS
// ============================================================================

export enum PokerVariantEnum {
  TexasHoldem = 'texas-holdem',
  Omaha = 'omaha',
  SevenCardStud = 'seven-card-stud',
  FiveCardDraw = 'five-card-draw'
}

export enum PokerStageEnum {
  Lobby = 'lobby',
  PreFlop = 'pre-flop',
  Flop = 'flop',
  Turn = 'turn',
  River = 'river',
  Showdown = 'showdown',
  Settled = 'settled'
}

export enum PokerActionEnum {
  Fold = 'fold',
  Check = 'check',
  Call = 'call',
  Bet = 'bet',
  Raise = 'raise',
  AllIn = 'all-in'
}

export enum PokerHandRankEnum {
  HighCard = 'high-card',
  OnePair = 'one-pair',
  TwoPair = 'two-pair',
  ThreeOfAKind = 'three-of-a-kind',
  Straight = 'straight',
  Flush = 'flush',
  FullHouse = 'full-house',
  FourOfAKind = 'four-of-a-kind',
  StraightFlush = 'straight-flush',
  RoyalFlush = 'royal-flush'
}

export const POKER_HAND_VALUES: Record<PokerHandRankEnum, number> = {
  [PokerHandRankEnum.HighCard]: 1,
  [PokerHandRankEnum.OnePair]: 2,
  [PokerHandRankEnum.TwoPair]: 3,
  [PokerHandRankEnum.ThreeOfAKind]: 4,
  [PokerHandRankEnum.Straight]: 5,
  [PokerHandRankEnum.Flush]: 6,
  [PokerHandRankEnum.FullHouse]: 7,
  [PokerHandRankEnum.FourOfAKind]: 8,
  [PokerHandRankEnum.StraightFlush]: 9,
  [PokerHandRankEnum.RoyalFlush]: 10
};
