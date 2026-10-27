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
  Poker = 'poker',
  SkipBo = 'skipbo',
  Set = 'set'
}

export enum GameCodePrefixEnum {
  Sanctuary = 'SANCT-',
  Blackjack = 'BJK-',
  Avalon = 'AVALON-',
  Uno = 'UNO-',
  Phase10 = 'P10-',
  Poker = 'POKER-',
  SkipBo = 'SKIP-',
  Set = 'SET-'
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

// ============================================================================
// SKIP-BO ENUMS & CONSTANTS
// ============================================================================

export enum SkipBoCardTypeEnum {
  Number = 'number',
  Wild = 'wild'
}

export enum SkipBoSourcePileEnum {
  Stockpile = 'stockpile',
  Hand = 'hand',
  Discard = 'discard'
}

// ============================================================================
// PHASE 10 ENUMS & CONSTANTS
// ============================================================================

export enum Phase10ColorEnum {
  Red = 'red',
  Blue = 'blue',
  Green = 'green',
  Yellow = 'yellow'
}

export enum Phase10SpecialEnum {
  Standard = 'standard',
  Wild = 'wild',
  Skip = 'skip'
}

export interface Phase10Requirement {
  phaseNumber: number;
  description: string;
  shortLabel: string;
}

export const PHASE_10_REQUIREMENTS: readonly Phase10Requirement[] = [
  { phaseNumber: 1, description: '2 sets of 3', shortLabel: '2 Sets of 3' },
  { phaseNumber: 2, description: '1 set of 3 + 1 run of 4', shortLabel: 'Set of 3 & Run of 4' },
  { phaseNumber: 3, description: '1 set of 4 + 1 run of 4', shortLabel: 'Set of 4 & Run of 4' },
  { phaseNumber: 4, description: '1 run of 7', shortLabel: 'Run of 7' },
  { phaseNumber: 5, description: '1 run of 8', shortLabel: 'Run of 8' },
  { phaseNumber: 6, description: '1 run of 9', shortLabel: 'Run of 9' },
  { phaseNumber: 7, description: '2 sets of 4', shortLabel: '2 Sets of 4' },
  { phaseNumber: 8, description: '7 cards of one color', shortLabel: '7 of One Color' },
  { phaseNumber: 9, description: '1 set of 5 + 1 set of 2', shortLabel: 'Set of 5 & Set of 2' },
  { phaseNumber: 10, description: '1 set of 5 + 1 set of 3', shortLabel: 'Set of 5 & Set of 3' }
];

// ============================================================================
// SET (FINITE GEOMETRY GF(3)^4 CARD GAME) ENUMS & CONSTANTS
// ============================================================================

export enum SetCountEnum {
  One = 1,
  Two = 2,
  Three = 3
}

export enum SetShapeEnum {
  Diamond = 'diamond',
  Squiggle = 'squiggle',
  Oval = 'oval'
}

export enum SetShadingEnum {
  Solid = 'solid',
  Striped = 'striped',
  Open = 'open'
}

export enum SetColorEnum {
  Red = 'red',
  Green = 'green',
  Purple = 'purple'
}

export const SET_COUNTS: readonly SetCountEnum[] = [
  SetCountEnum.One,
  SetCountEnum.Two,
  SetCountEnum.Three
];

export const SET_SHAPES: readonly SetShapeEnum[] = [
  SetShapeEnum.Diamond,
  SetShapeEnum.Squiggle,
  SetShapeEnum.Oval
];

export const SET_SHADINGS: readonly SetShadingEnum[] = [
  SetShadingEnum.Solid,
  SetShadingEnum.Striped,
  SetShadingEnum.Open
];

export const SET_COLORS: readonly SetColorEnum[] = [
  SetColorEnum.Red,
  SetColorEnum.Green,
  SetColorEnum.Purple
];

// ============================================================================
// REAL-LIFE GAME CAPACITIES & TABLE LIMITS
// ============================================================================

export interface GameCapacityConfig {
  game: ArcadeGameEnum;
  minPlayers: number;
  maxPlayers: number;
  standardTableSeats: number;
  description: string;
}

export const REAL_LIFE_GAME_CAPACITIES: Record<ArcadeGameEnum, GameCapacityConfig> = {
  [ArcadeGameEnum.Chess]: {
    game: ArcadeGameEnum.Chess,
    minPlayers: 2,
    maxPlayers: 2,
    standardTableSeats: 2,
    description: '2 Players (White vs Black) + Unlimited Spectators'
  },
  [ArcadeGameEnum.Blackjack]: {
    game: ArcadeGameEnum.Blackjack,
    minPlayers: 1,
    maxPlayers: 7,
    standardTableSeats: 7,
    description: '1 to 7 Players vs Dealer (Standard Casino Shoe Table)'
  },
  [ArcadeGameEnum.Poker]: {
    game: ArcadeGameEnum.Poker,
    minPlayers: 2,
    maxPlayers: 10,
    standardTableSeats: 10,
    description: '2 to 10 Players (Standard Full-Ring Poker Table)'
  },
  [ArcadeGameEnum.Phase10]: {
    game: ArcadeGameEnum.Phase10,
    minPlayers: 2,
    maxPlayers: 6,
    standardTableSeats: 6,
    description: '2 to 6 Players (Official Mattel/Ravensburger Tournament Rules)'
  },
  [ArcadeGameEnum.SkipBo]: {
    game: ArcadeGameEnum.SkipBo,
    minPlayers: 2,
    maxPlayers: 6,
    standardTableSeats: 6,
    description: '2 to 6 Players (Official Mattel Skip-Bo Rules)'
  },
  [ArcadeGameEnum.Avalon]: {
    game: ArcadeGameEnum.Avalon,
    minPlayers: 5,
    maxPlayers: 10,
    standardTableSeats: 10,
    description: '5 to 10 Players (Official Don Eskridge / Indie Boards Rules)'
  },
  [ArcadeGameEnum.Uno]: {
    game: ArcadeGameEnum.Uno,
    minPlayers: 2,
    maxPlayers: 10,
    standardTableSeats: 10,
    description: '2 to 10 Players (Official Mattel Uno Rules)'
  },
  [ArcadeGameEnum.Set]: {
    game: ArcadeGameEnum.Set,
    minPlayers: 1,
    maxPlayers: 20,
    standardTableSeats: 4,
    description: '1 to 20 Players (Official Set Enterprises / Marsha Falco GF(3)^4 Finite Geometry Rules)'
  }
};

