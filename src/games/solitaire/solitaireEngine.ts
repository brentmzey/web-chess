import {
  CardSuitEnum,
  CardValueEnum,
  CARD_SUITS,
  CARD_VALUES,
  SolitaireStageEnum
} from '../../constants/gameEnums';
import type { PlayingCard } from '../blackjack/blackjackEngine';
import { TableSeatManager } from '../multiplayer/tableSeatManager';
import { currentEpochMs } from '../../utils/dateTime';
import {
  failure,
  matchBool,
  none,
  some,
  success,
  type Option,
  type Result
} from '../../utils/fp';

export interface SolitairePlayerData {
  readonly isSpectator: boolean;
  readonly joinedAt: number;
}

export type FoundationSlot = CardSuitEnum | null;

export const FOUNDATION_SLOT_COUNT = 4;

const EMPTY_FOUNDATION_SLOTS: readonly FoundationSlot[] = Object.freeze([null, null, null, null]);

/**
 * Gives a suit a foundation space when its Ace starts one: the space the player chose if it is free,
 * otherwise the leftmost free space. Any Ace may start any empty foundation, as in real Klondike.
 */
export function claimFoundationSlot(slots: readonly FoundationSlot[],
                                    suit: CardSuitEnum,
                                    preferredSlot?: number): readonly FoundationSlot[] {
  if (slots.includes(suit)) return slots;
  const target = preferredSlot !== undefined && slots[preferredSlot] === null ? preferredSlot : slots.indexOf(null);
  return slots.map((slot, i) => (i === target ? suit : slot));
}

/** Frees a suit's foundation space once its last card (the Ace) has gone back to the tableau. */
export function releaseFoundationSlot(slots: readonly FoundationSlot[],
                                      suit: CardSuitEnum): readonly FoundationSlot[] {
  return slots.map(slot => (slot === suit ? null : slot));
}

/** Rebuilds foundation spaces from piles alone (saves made before spaces were recorded). */
export function deriveFoundationSlots(foundations: Readonly<Record<CardSuitEnum, readonly PlayingCard[]>>,
                                      saved?: unknown): readonly FoundationSlot[] {
  const valid = Array.isArray(saved) &&
    saved.length === FOUNDATION_SLOT_COUNT &&
    saved.every(slot => slot === null || CARD_SUITS.includes(slot as CardSuitEnum)) &&
    CARD_SUITS.every(suit => (foundations[suit].length > 0) === saved.includes(suit));
  return valid
    ? (saved as FoundationSlot[])
    : CARD_SUITS.filter(suit => foundations[suit].length > 0)
      .reduce((slots, suit) => claimFoundationSlot(slots, suit), EMPTY_FOUNDATION_SLOTS);
}

export interface SolitaireGameState {
  readonly stock: readonly PlayingCard[];
  readonly waste: readonly PlayingCard[];
  readonly foundations: Readonly<Record<CardSuitEnum, readonly PlayingCard[]>>;
  /** The four foundation spaces left to right: the suit each one is building, or null while empty. */
  readonly foundationSlots: readonly FoundationSlot[];
  readonly tableau: readonly (readonly PlayingCard[])[];
  readonly stage: SolitaireStageEnum;
  readonly movesCount: number;
  readonly score: number;
  readonly historyText: readonly string[];
}

export interface SolitaireSnapshotPayload {
  readonly stock: readonly PlayingCard[];
  readonly waste: readonly PlayingCard[];
  readonly foundations: Record<string, readonly PlayingCard[]>;
  readonly foundationSlots?: readonly FoundationSlot[];
  readonly tableau: readonly (readonly PlayingCard[])[];
  readonly stage: string;
  readonly movesCount: number;
  readonly score: number;
  readonly historyText: readonly string[];
}

export const CARD_NUMERIC_RANK: Readonly<Record<CardValueEnum, number>> = Object.freeze({
  [CardValueEnum.Ace]: 1,
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
  [CardValueEnum.King]: 13
});

export function getCardColor(suit: CardSuitEnum): 'red' | 'black' {
  return suit === CardSuitEnum.Hearts || suit === CardSuitEnum.Diamonds ? 'red' : 'black';
}

export function isOppositeColor(suit1: CardSuitEnum,
                                suit2: CardSuitEnum): boolean {
  return getCardColor(suit1) !== getCardColor(suit2);
}

export function canStackOnTableau(movingCard: PlayingCard,
                                  targetCard: Option<PlayingCard>): boolean {
  return targetCard.match({
    Some: target =>
      isOppositeColor(movingCard.suit as CardSuitEnum, target.suit as CardSuitEnum) &&
      CARD_NUMERIC_RANK[movingCard.value as CardValueEnum] ===
        CARD_NUMERIC_RANK[target.value as CardValueEnum] - 1,
    None: () => CARD_NUMERIC_RANK[movingCard.value as CardValueEnum] === 13
  });
}

export function canStackOnFoundation(movingCard: PlayingCard,
                                     foundationPile: readonly PlayingCard[]): boolean {
  if (foundationPile.length === 0) {
    return CARD_NUMERIC_RANK[movingCard.value as CardValueEnum] === 1;
  }
  const topCard = foundationPile[foundationPile.length - 1]!;
  return (
    movingCard.suit === topCard.suit &&
    CARD_NUMERIC_RANK[movingCard.value as CardValueEnum] ===
      CARD_NUMERIC_RANK[topCard.value as CardValueEnum] + 1
  );
}

/** Whether cards form a movable tableau run: all face up, each one rank lower and the opposite color. */
export function isTableauRun(cards: readonly PlayingCard[]): boolean {
  return cards.every((card, i) => card.faceUp && (i === 0 || canStackOnTableau(card, some(cards[i - 1]!))));
}

export function generateStandardDeck(): PlayingCard[] {
  const deck: PlayingCard[] = [];
  CARD_SUITS.forEach(suit => {
    CARD_VALUES.forEach(val => {
      deck.push({
        suit,
        value: val,
        faceUp: false
      });
    });
  });
  return deck;
}

export function shuffleDeck<T>(array: readonly T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = result[i]!;
    result[i] = result[j]!;
    result[j] = temp;
  }
  return result;
}

export function createInitialSolitaireState(providedDeck?: readonly PlayingCard[]): SolitaireGameState {
  const deck = providedDeck ? [...providedDeck] : shuffleDeck(generateStandardDeck());

  const tableau: PlayingCard[][] = [[], [], [], [], [], [], []];
  let deckIndex = 0;

  for (let col = 0; col < 7; col++) {
    for (let row = 0; row <= col; row++) {
      const card = deck[deckIndex++];
      if (card) {
        tableau[col]!.push({
          suit: card.suit,
          value: card.value,
          faceUp: row === col
        });
      }
    }
  }

  const stock: PlayingCard[] = [];
  while (deckIndex < deck.length) {
    const card = deck[deckIndex++];
    if (card) {
      stock.push({
        suit: card.suit,
        value: card.value,
        faceUp: false
      });
    }
  }

  const foundations: Record<CardSuitEnum, PlayingCard[]> = {
    [CardSuitEnum.Hearts]: [],
    [CardSuitEnum.Diamonds]: [],
    [CardSuitEnum.Clubs]: [],
    [CardSuitEnum.Spades]: []
  };

  return {
    stock,
    waste: [],
    foundations,
    foundationSlots: EMPTY_FOUNDATION_SLOTS,
    tableau,
    stage: SolitaireStageEnum.Playing,
    movesCount: 0,
    score: 0,
    historyText: ['New Solitaire match consecrated. The cathedral patience begins.']
  };
}

export class CathedralSolitaireEngine {
  public state: SolitaireGameState;
  public readonly seatManager: TableSeatManager<SolitairePlayerData>;
  private undoStack: SolitaireGameState[] = [];

  constructor(seedDeck?: readonly PlayingCard[],
              maxSpectators: number = 20) {
    this.state = createInitialSolitaireState(seedDeck);
    this.seatManager = new TableSeatManager<SolitairePlayerData>(
      maxSpectators + 1,
      1,
      undefined,
      () => ({ isSpectator: true, joinedAt: currentEpochMs() })
    );
    // Claim Seat 1 for the solitary player
    this.seatManager.claimSeat(1, 'player_1', 'Cathedral Pilgrim', {
      isSpectator: false,
      joinedAt: currentEpochMs()
    });
  }

  private saveStateForUndo(): void {
    // Push shallow copy with deep cloned arrays
    this.undoStack.push({
      stock: [...this.state.stock],
      waste: [...this.state.waste],
      foundations: {
        [CardSuitEnum.Hearts]: [...this.state.foundations[CardSuitEnum.Hearts]],
        [CardSuitEnum.Diamonds]: [...this.state.foundations[CardSuitEnum.Diamonds]],
        [CardSuitEnum.Clubs]: [...this.state.foundations[CardSuitEnum.Clubs]],
        [CardSuitEnum.Spades]: [...this.state.foundations[CardSuitEnum.Spades]]
      },
      foundationSlots: [...this.state.foundationSlots],
      tableau: this.state.tableau.map(col => [...col]),
      stage: this.state.stage,
      movesCount: this.state.movesCount,
      score: this.state.score,
      historyText: [...this.state.historyText]
    });
  }

  public undo(): Result<SolitaireGameState, string> {
    const prev = this.undoStack.pop();
    if (!prev) {
      return failure('No prior moves available to undo.');
    }
    this.state = prev;
    return success(this.state);
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public drawFromStock(drawCount: number = 1): Result<SolitaireGameState, string> {
    if (this.state.stock.length === 0 && this.state.waste.length === 0) {
      return failure('Both Stock and Waste piles are empty.');
    }
    this.saveStateForUndo();

    if (this.state.stock.length === 0) {
      // Recycle Waste back into Stock (reversed, faceDown)
      const recycled: PlayingCard[] = [...this.state.waste]
        .reverse()
        .map(c => ({ suit: c.suit, value: c.value, faceUp: false }));

      this.state = {
        ...this.state,
        stock: recycled,
        waste: [],
        movesCount: this.state.movesCount + 1,
        score: Math.max(0, this.state.score - 20),
        historyText: [...this.state.historyText, 'Stock exhausted; Waste recycled back into Stock (-20 pts).']
      };
      return success(this.state);
    }

    const newStock = [...this.state.stock];
    const newWaste = [...this.state.waste];
    const actualDraw = Math.min(drawCount, newStock.length);

    for (let i = 0; i < actualDraw; i++) {
      const drawn = newStock.pop();
      if (drawn) {
        newWaste.push({
          suit: drawn.suit,
          value: drawn.value,
          faceUp: true
        });
      }
    }

    this.state = {
      ...this.state,
      stock: newStock,
      waste: newWaste,
      movesCount: this.state.movesCount + 1,
      historyText: [...this.state.historyText, `Drew ${actualDraw} card(s) from Stock to Waste.`]
    };
    return success(this.state);
  }

  /**
   * Checks that a card may go onto a foundation (optionally a chosen foundation space) and returns the
   * suit pile it joins.
   */
  private checkFoundationMove(card: PlayingCard,
                              targetSuit?: CardSuitEnum,
                              preferredSlot?: number): Result<CardSuitEnum, string> {
    const suit = (targetSuit || card.suit) as CardSuitEnum;
    if (suit !== card.suit) {
      return failure(`Card suit ${card.suit} does not match foundation ${suit}.`);
    }
    const slotSuit = preferredSlot === undefined ? null : this.state.foundationSlots[preferredSlot] ?? null;
    if (slotSuit !== null && slotSuit !== suit) {
      return failure(`That foundation is building ${slotSuit}; ${card.value} of ${card.suit} belongs on ${suit}.`);
    }
    if (preferredSlot !== undefined && slotSuit === null && this.state.foundationSlots.includes(suit)) {
      return failure(`${card.value} of ${card.suit} goes on the ${suit} foundation you already started.`);
    }
    const foundationPile = this.state.foundations[suit];
    if (!canStackOnFoundation(card, foundationPile)) {
      return failure(foundationPile.length === 0
        ? 'Only an Ace can start a foundation.'
        : `Cannot place ${card.value} of ${card.suit} on ${suit} foundation; it needs the next card up.`);
    }
    return success(suit);
  }

  public moveWasteToFoundation(targetSuit?: CardSuitEnum,
                               preferredSlot?: number): Result<SolitaireGameState, string> {
    if (this.state.waste.length === 0) {
      return failure('Waste pile is empty.');
    }
    const card = this.state.waste[this.state.waste.length - 1]!;
    const checked = this.checkFoundationMove(card, targetSuit, preferredSlot);
    if (checked.isFailure()) {
      return checked.map(() => this.state);
    }
    const suit = checked.getOrThrow();
    const foundationPile = this.state.foundations[suit];

    this.saveStateForUndo();

    const newWaste = this.state.waste.slice(0, -1);
    const newFoundations = {
      ...this.state.foundations,
      [suit]: [...foundationPile, card]
    };

    const isWon = this.checkWinCondition(newFoundations);

    this.state = {
      ...this.state,
      waste: newWaste,
      foundations: newFoundations,
      foundationSlots: claimFoundationSlot(this.state.foundationSlots, suit, preferredSlot),
      movesCount: this.state.movesCount + 1,
      score: this.state.score + 10,
      stage: matchBool(isWon, {
        true: () => SolitaireStageEnum.Won,
        false: () => this.state.stage
      }),
      historyText: [
        ...this.state.historyText,
        `Moved ${card.value} of ${card.suit} from Waste to Foundation (+10 pts).`
      ]
    };

    return success(this.state);
  }

  public moveWasteToTableau(colIndex: number): Result<SolitaireGameState, string> {
    if (colIndex < 0 || colIndex > 6) {
      return failure(`Invalid tableau column index: ${colIndex}`);
    }
    if (this.state.waste.length === 0) {
      return failure('Waste pile is empty.');
    }

    const card = this.state.waste[this.state.waste.length - 1]!;
    const targetCol = this.state.tableau[colIndex]!;
    const targetTop = targetCol.length > 0 ? some(targetCol[targetCol.length - 1]!) : none<PlayingCard>();

    if (!canStackOnTableau(card, targetTop)) {
      return failure(`Cannot place ${card.value} of ${card.suit} onto tableau column ${colIndex + 1}.`);
    }

    this.saveStateForUndo();

    const newWaste = this.state.waste.slice(0, -1);
    const newTableau = this.state.tableau.map((col, idx) =>
      idx === colIndex ? [...col, card] : col
    );

    this.state = {
      ...this.state,
      waste: newWaste,
      tableau: newTableau,
      movesCount: this.state.movesCount + 1,
      score: this.state.score + 5,
      historyText: [
        ...this.state.historyText,
        `Moved ${card.value} of ${card.suit} from Waste to Tableau col ${colIndex + 1} (+5 pts).`
      ]
    };

    return success(this.state);
  }

  public moveTableauToFoundation(fromCol: number,
                                targetSuit?: CardSuitEnum,
                                preferredSlot?: number): Result<SolitaireGameState, string> {
    if (fromCol < 0 || fromCol > 6) {
      return failure(`Invalid tableau column index: ${fromCol}`);
    }
    const col = this.state.tableau[fromCol]!;
    if (col.length === 0) {
      return failure(`Tableau column ${fromCol + 1} is empty.`);
    }

    const card = col[col.length - 1]!;
    if (!card.faceUp) {
      return failure('Top card is face down.');
    }

    const checked = this.checkFoundationMove(card, targetSuit, preferredSlot);
    if (checked.isFailure()) {
      return checked.map(() => this.state);
    }
    const suit = checked.getOrThrow();
    const foundationPile = this.state.foundations[suit];

    this.saveStateForUndo();

    const newCol = col.slice(0, -1);
    let scoreBonus = 10;
    // Auto-reveal newly exposed top card in column
    if (newCol.length > 0 && !newCol[newCol.length - 1]!.faceUp) {
      const revealed = { ...newCol[newCol.length - 1]!, faceUp: true };
      newCol[newCol.length - 1] = revealed;
      scoreBonus += 5; // +5 pts for revealing face-down card
    }

    const newTableau = this.state.tableau.map((c, idx) => (idx === fromCol ? newCol : c));
    const newFoundations = {
      ...this.state.foundations,
      [suit]: [...foundationPile, card]
    };

    const isWon = this.checkWinCondition(newFoundations);

    this.state = {
      ...this.state,
      tableau: newTableau,
      foundations: newFoundations,
      foundationSlots: claimFoundationSlot(this.state.foundationSlots, suit, preferredSlot),
      movesCount: this.state.movesCount + 1,
      score: this.state.score + scoreBonus,
      stage: matchBool(isWon, {
        true: () => SolitaireStageEnum.Won,
        false: () => this.state.stage
      }),
      historyText: [
        ...this.state.historyText,
        `Moved ${card.value} of ${card.suit} from Col ${fromCol + 1} to Foundation (+${scoreBonus} pts).`
      ]
    };

    return success(this.state);
  }

  public moveTableauToTableau(fromCol: number,
                              cardIndex: number,
                              toCol: number): Result<SolitaireGameState, string> {
    if (fromCol < 0 || fromCol > 6 || toCol < 0 || toCol > 6) {
      return failure('Invalid tableau column index.');
    }
    if (fromCol === toCol) {
      return failure('Source and destination columns cannot be the same.');
    }

    const sourceCol = this.state.tableau[fromCol]!;
    if (cardIndex < 0 || cardIndex >= sourceCol.length) {
      return failure('Invalid card index in source column.');
    }

    const movingCard = sourceCol[cardIndex]!;
    if (!movingCard.faceUp) {
      return failure('Cannot move face-down cards.');
    }

    const destCol = this.state.tableau[toCol]!;
    const destTop = destCol.length > 0 ? some(destCol[destCol.length - 1]!) : none<PlayingCard>();

    if (!canStackOnTableau(movingCard, destTop)) {
      return failure(`Cannot place ${movingCard.value} of ${movingCard.suit} on column ${toCol + 1}.`);
    }

    const movingStack = sourceCol.slice(cardIndex);
    if (!isTableauRun(movingStack)) {
      return failure('Only a face-up run descending in alternating colors can move together.');
    }

    this.saveStateForUndo();

    const newSource = sourceCol.slice(0, cardIndex);

    let scoreBonus = 0;
    if (newSource.length > 0 && !newSource[newSource.length - 1]!.faceUp) {
      newSource[newSource.length - 1] = {
        ...newSource[newSource.length - 1]!,
        faceUp: true
      };
      scoreBonus += 5;
    }

    const newDest = [...destCol, ...movingStack];
    const newTableau = this.state.tableau.map((col, idx) => {
      if (idx === fromCol) return newSource;
      if (idx === toCol) return newDest;
      return col;
    });

    this.state = {
      ...this.state,
      tableau: newTableau,
      movesCount: this.state.movesCount + 1,
      score: this.state.score + scoreBonus,
      historyText: [
        ...this.state.historyText,
        `Moved ${movingStack.length} card(s) from Col ${fromCol + 1} to Col ${toCol + 1}.`
      ]
    };

    return success(this.state);
  }

  public moveFoundationToTableau(suit: CardSuitEnum,
                                toCol: number): Result<SolitaireGameState, string> {
    if (toCol < 0 || toCol > 6) {
      return failure('Invalid tableau column.');
    }
    const foundationPile = this.state.foundations[suit];
    if (foundationPile.length === 0) {
      return failure(`Foundation pile for ${suit} is empty.`);
    }

    const card = foundationPile[foundationPile.length - 1]!;
    const destCol = this.state.tableau[toCol]!;
    const destTop = destCol.length > 0 ? some(destCol[destCol.length - 1]!) : none<PlayingCard>();

    if (!canStackOnTableau(card, destTop)) {
      return failure(`Cannot place ${card.value} of ${card.suit} onto tableau col ${toCol + 1}.`);
    }

    this.saveStateForUndo();

    const newFoundations = {
      ...this.state.foundations,
      [suit]: foundationPile.slice(0, -1)
    };

    const newTableau = this.state.tableau.map((col, idx) =>
      idx === toCol ? [...col, card] : col
    );

    this.state = {
      ...this.state,
      foundations: newFoundations,
      foundationSlots: foundationPile.length === 1
        ? releaseFoundationSlot(this.state.foundationSlots, suit)
        : this.state.foundationSlots,
      tableau: newTableau,
      movesCount: this.state.movesCount + 1,
      score: Math.max(0, this.state.score - 15),
      historyText: [
        ...this.state.historyText,
        `Moved ${card.value} of ${card.suit} from Foundation back to Col ${toCol + 1} (-15 pts).`
      ]
    };

    return success(this.state);
  }

  public autoMoveToFoundations(): Result<{ movedCount: number; state: SolitaireGameState }, string> {
    let movedTotal = 0;
    let keepScanning = true;

    while (keepScanning) {
      let movedThisPass = false;

      // 1. Check Waste pile
      if (this.state.waste.length > 0) {
        const topWaste = this.state.waste[this.state.waste.length - 1]!;
        const fPile = this.state.foundations[topWaste.suit as CardSuitEnum];
        if (canStackOnFoundation(topWaste, fPile)) {
          const res = this.moveWasteToFoundation(topWaste.suit as CardSuitEnum);
          if (res.isSuccess()) {
            movedTotal++;
            movedThisPass = true;
            continue;
          }
        }
      }

      // 2. Check each Tableau column's top card
      for (let col = 0; col < 7; col++) {
        const column = this.state.tableau[col]!;
        if (column.length > 0) {
          const topCard = column[column.length - 1]!;
          if (topCard.faceUp) {
            const fPile = this.state.foundations[topCard.suit as CardSuitEnum];
            if (canStackOnFoundation(topCard, fPile)) {
              const res = this.moveTableauToFoundation(col, topCard.suit as CardSuitEnum);
              if (res.isSuccess()) {
                movedTotal++;
                movedThisPass = true;
                break;
              }
            }
          }
        }
      }

      if (!movedThisPass) {
        keepScanning = false;
      }
    }

    return success({ movedCount: movedTotal, state: this.state });
  }

  public canAutoComplete(): boolean {
    // True if stock and waste are empty, and all tableau cards are faceUp
    if (this.state.stock.length > 0 || this.state.waste.length > 0) {
      return false;
    }
    return this.state.tableau.every(col => col.every(c => c.faceUp));
  }

  public autoComplete(): Result<{ success: boolean; state: SolitaireGameState }, string> {
    if (!this.canAutoComplete()) {
      return failure('Cannot auto-complete: Stock/Waste not empty or hidden cards remain in Tableau.');
    }

    let iterations = 0;
    while (!this.isGameWon() && iterations < 100) {
      const res = this.autoMoveToFoundations();
      if (!res.isSuccess() || res.getOrThrow().movedCount === 0) {
        break;
      }
      iterations++;
    }

    const won = this.isGameWon();
    if (won) {
      this.state = {
        ...this.state,
        stage: SolitaireStageEnum.Won,
        historyText: [...this.state.historyText, 'Cathedral Solitaire victory consecrated! All 52 cards gathered.']
      };
    }

    return success({ success: won, state: this.state });
  }

  private checkWinCondition(foundations: Record<CardSuitEnum, readonly PlayingCard[]>): boolean {
    return CARD_SUITS.every(suit => foundations[suit].length === 13);
  }

  public isGameWon(): boolean {
    return this.checkWinCondition(this.state.foundations);
  }

  public restartGame(seedDeck?: readonly PlayingCard[]): void {
    this.undoStack = [];
    this.state = createInitialSolitaireState(seedDeck);
  }

  public exportSnapshot(): SolitaireSnapshotPayload {
    return {
      stock: this.state.stock,
      waste: this.state.waste,
      foundations: this.state.foundations,
      foundationSlots: this.state.foundationSlots,
      tableau: this.state.tableau,
      stage: this.state.stage,
      movesCount: this.state.movesCount,
      score: this.state.score,
      historyText: this.state.historyText
    };
  }

  public importSnapshot(payload: unknown): Result<SolitaireGameState, string> {
    if (!payload || typeof payload !== 'object') {
      return failure('Invalid snapshot payload format.');
    }
    const data = payload as Partial<SolitaireSnapshotPayload>;
    if (!Array.isArray(data.tableau) || !data.foundations) {
      return failure('Missing tableau or foundations in snapshot.');
    }

    const foundations: Record<CardSuitEnum, readonly PlayingCard[]> = {
      [CardSuitEnum.Hearts]: Array.isArray(data.foundations[CardSuitEnum.Hearts]) ? data.foundations[CardSuitEnum.Hearts] : [],
      [CardSuitEnum.Diamonds]: Array.isArray(data.foundations[CardSuitEnum.Diamonds]) ? data.foundations[CardSuitEnum.Diamonds] : [],
      [CardSuitEnum.Clubs]: Array.isArray(data.foundations[CardSuitEnum.Clubs]) ? data.foundations[CardSuitEnum.Clubs] : [],
      [CardSuitEnum.Spades]: Array.isArray(data.foundations[CardSuitEnum.Spades]) ? data.foundations[CardSuitEnum.Spades] : []
    };
    this.state = {
      stock: Array.isArray(data.stock) ? data.stock : [],
      waste: Array.isArray(data.waste) ? data.waste : [],
      foundations,
      foundationSlots: deriveFoundationSlots(foundations, data.foundationSlots),
      tableau: data.tableau.map(col => (Array.isArray(col) ? col : [])),
      stage: (data.stage as SolitaireStageEnum) || SolitaireStageEnum.Playing,
      movesCount: typeof data.movesCount === 'number' ? data.movesCount : 0,
      score: typeof data.score === 'number' ? data.score : 0,
      historyText: Array.isArray(data.historyText) ? data.historyText : []
    };

    return success(this.state);
  }
}
