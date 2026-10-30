import { describe, expect, it } from 'bun:test';
import {
  CathedralSolitaireEngine,
  canStackOnTableau,
  canStackOnFoundation,
  getCardColor,
  isOppositeColor,
  generateStandardDeck,
  shuffleDeck
} from '../src/games/solitaire/solitaireEngine';
import {
  CardSuitEnum,
  CardValueEnum,
  SolitaireStageEnum
} from '../src/constants/gameEnums';
import type { PlayingCard } from '../src/games/blackjack/blackjackEngine';
import { some, none } from '../src/utils/fp';

describe('Cathedral Solitaire Engine - Pure Functional Klondike & Spectator Logic', () => {
  it('generates a standard 52-card deck and shuffles predictably', () => {
    const deck = generateStandardDeck();
    expect(deck.length).toBe(52);
    expect(deck.every(c => !c.faceUp)).toBe(true);

    const shuffled = shuffleDeck(deck);
    expect(shuffled.length).toBe(52);
  });

  it('determines card colors and opposite suit relationships', () => {
    expect(getCardColor(CardSuitEnum.Hearts)).toBe('red');
    expect(getCardColor(CardSuitEnum.Diamonds)).toBe('red');
    expect(getCardColor(CardSuitEnum.Clubs)).toBe('black');
    expect(getCardColor(CardSuitEnum.Spades)).toBe('black');

    expect(isOppositeColor(CardSuitEnum.Hearts, CardSuitEnum.Spades)).toBe(true);
    expect(isOppositeColor(CardSuitEnum.Diamonds, CardSuitEnum.Clubs)).toBe(true);
    expect(isOppositeColor(CardSuitEnum.Hearts, CardSuitEnum.Diamonds)).toBe(false);
    expect(isOppositeColor(CardSuitEnum.Clubs, CardSuitEnum.Spades)).toBe(false);
  });

  it('validates tableau stacking rules', () => {
    const redQueen: PlayingCard = { suit: CardSuitEnum.Hearts, value: CardValueEnum.Queen, faceUp: true };
    const blackKing: PlayingCard = { suit: CardSuitEnum.Spades, value: CardValueEnum.King, faceUp: true };
    const redKing: PlayingCard = { suit: CardSuitEnum.Diamonds, value: CardValueEnum.King, faceUp: true };
    const blackJack: PlayingCard = { suit: CardSuitEnum.Clubs, value: CardValueEnum.Jack, faceUp: true };

    // Red Queen on Black King -> Valid
    expect(canStackOnTableau(redQueen, some(blackKing))).toBe(true);
    // Red Queen on Red King -> Invalid (same color)
    expect(canStackOnTableau(redQueen, some(redKing))).toBe(false);
    // Black Jack on Black King -> Invalid (rank mismatch and same color)
    expect(canStackOnTableau(blackJack, some(blackKing))).toBe(false);

    // Empty tableau slot (none) -> Only King is valid
    expect(canStackOnTableau(blackKing, none())).toBe(true);
    expect(canStackOnTableau(redQueen, none())).toBe(false);
  });

  it('validates foundation stacking rules', () => {
    const aceHearts: PlayingCard = { suit: CardSuitEnum.Hearts, value: CardValueEnum.Ace, faceUp: true };
    const twoHearts: PlayingCard = { suit: CardSuitEnum.Hearts, value: CardValueEnum.Two, faceUp: true };
    const twoSpades: PlayingCard = { suit: CardSuitEnum.Spades, value: CardValueEnum.Two, faceUp: true };
    const threeHearts: PlayingCard = { suit: CardSuitEnum.Hearts, value: CardValueEnum.Three, faceUp: true };

    // Empty foundation -> Only Ace is valid
    expect(canStackOnFoundation(aceHearts, [])).toBe(true);
    expect(canStackOnFoundation(twoHearts, [])).toBe(false);

    // Foundation with Ace of Hearts
    const foundationHearts = [aceHearts];
    expect(canStackOnFoundation(twoHearts, foundationHearts)).toBe(true);
    expect(canStackOnFoundation(twoSpades, foundationHearts)).toBe(false); // Suit mismatch
    expect(canStackOnFoundation(threeHearts, foundationHearts)).toBe(false); // Rank skip
  });

  it('initializes canonical Klondike layout correctly', () => {
    const engine = new CathedralSolitaireEngine();

    expect(engine.state.tableau.length).toBe(7);
    for (let col = 0; col < 7; col++) {
      expect(engine.state.tableau[col]!.length).toBe(col + 1);
      // Top card is face up
      expect(engine.state.tableau[col]![col]!.faceUp).toBe(true);
      // Under cards are face down
      for (let r = 0; r < col; r++) {
        expect(engine.state.tableau[col]![r]!.faceUp).toBe(false);
      }
    }

    // 28 cards in tableau, 24 in stock
    expect(engine.state.stock.length).toBe(24);
    expect(engine.state.waste.length).toBe(0);
    expect(engine.state.stage).toBe(SolitaireStageEnum.Playing);
    expect(engine.state.movesCount).toBe(0);
    expect(engine.state.score).toBe(0);

    // Seat 1 is claimed by the human player
    expect(engine.seatManager.getOccupiedSeats().length).toBe(1);
    expect(engine.seatManager.getSeat(1).getOrThrow().isBot).toBe(false);
  });

  it('draws from stock into waste and recycles when empty', () => {
    const engine = new CathedralSolitaireEngine();
    const initialStockCount = engine.state.stock.length;

    // Draw 1 card
    const res1 = engine.drawFromStock(1);
    expect(res1.isSuccess()).toBe(true);
    expect(engine.state.stock.length).toBe(initialStockCount - 1);
    expect(engine.state.waste.length).toBe(1);
    expect(engine.state.waste[0]!.faceUp).toBe(true);
    expect(engine.state.movesCount).toBe(1);

    // Draw remaining 23 cards
    for (let i = 0; i < 23; i++) {
      engine.drawFromStock(1);
    }
    expect(engine.state.stock.length).toBe(0);
    expect(engine.state.waste.length).toBe(24);

    // Draw again -> recycles waste into stock
    const recycleRes = engine.drawFromStock(1);
    expect(recycleRes.isSuccess()).toBe(true);
    expect(engine.state.stock.length).toBe(24);
    expect(engine.state.waste.length).toBe(0);
    expect(engine.state.stock.every(c => !c.faceUp)).toBe(true);

    // If both stock and waste are empty, draw fails
    (engine.state as any).stock = [];
    (engine.state as any).waste = [];
    const emptyRes = engine.drawFromStock(1);
    expect(emptyRes.isFailure()).toBe(true);
  });

  it('moves waste card to foundation and detects suit/rank mismatches', () => {
    const engine = new CathedralSolitaireEngine();
    const aceDiamonds: PlayingCard = { suit: CardSuitEnum.Diamonds, value: CardValueEnum.Ace, faceUp: true };
    const twoDiamonds: PlayingCard = { suit: CardSuitEnum.Diamonds, value: CardValueEnum.Two, faceUp: true };

    // Empty waste cannot move
    expect(engine.moveWasteToFoundation().isFailure()).toBe(true);

    (engine.state as any).waste = [aceDiamonds];
    const moveRes = engine.moveWasteToFoundation();
    expect(moveRes.isSuccess()).toBe(true);
    expect(engine.state.waste.length).toBe(0);
    expect(engine.state.foundations[CardSuitEnum.Diamonds].length).toBe(1);
    expect(engine.state.score).toBe(10);

    // Mismatched target suit
    (engine.state as any).waste = [twoDiamonds];
    const mismatchRes = engine.moveWasteToFoundation(CardSuitEnum.Hearts);
    expect(mismatchRes.isFailure()).toBe(true);

    // Valid second card on foundation
    const moveTwoRes = engine.moveWasteToFoundation(CardSuitEnum.Diamonds);
    expect(moveTwoRes.isSuccess()).toBe(true);
    expect(engine.state.foundations[CardSuitEnum.Diamonds].length).toBe(2);
    expect(engine.state.score).toBe(20);
  });

  it('moves waste card to tableau', () => {
    const engine = new CathedralSolitaireEngine();
    const blackKing: PlayingCard = { suit: CardSuitEnum.Spades, value: CardValueEnum.King, faceUp: true };
    const redQueen: PlayingCard = { suit: CardSuitEnum.Hearts, value: CardValueEnum.Queen, faceUp: true };

    // Move to invalid column index
    expect(engine.moveWasteToTableau(7).isFailure()).toBe(true);

    // Move King to an empty tableau column
    (engine.state as any).tableau[0] = [];
    (engine.state as any).waste = [blackKing];

    const moveKingRes = engine.moveWasteToTableau(0);
    expect(moveKingRes.isSuccess()).toBe(true);
    expect(engine.state.tableau[0]!.length).toBe(1);
    expect(engine.state.tableau[0]![0]!.value).toBe(CardValueEnum.King);
    expect(engine.state.score).toBe(5);

    // Move Red Queen onto Black King
    (engine.state as any).waste = [redQueen];
    const moveQueenRes = engine.moveWasteToTableau(0);
    expect(moveQueenRes.isSuccess()).toBe(true);
    expect(engine.state.tableau[0]!.length).toBe(2);
    expect(engine.state.tableau[0]![1]!.value).toBe(CardValueEnum.Queen);

    // Invalid placement rejected
    (engine.state as any).waste = [{ suit: CardSuitEnum.Clubs, value: CardValueEnum.Five, faceUp: true }];
    expect(engine.moveWasteToTableau(0).isFailure()).toBe(true);
  });

  it('moves tableau card to foundation and auto-reveals newly exposed card', () => {
    const engine = new CathedralSolitaireEngine();
    const aceSpades: PlayingCard = { suit: CardSuitEnum.Spades, value: CardValueEnum.Ace, faceUp: true };
    const hiddenCard: PlayingCard = { suit: CardSuitEnum.Clubs, value: CardValueEnum.Nine, faceUp: false };

    // Empty col fails
    (engine.state as any).tableau[1] = [];
    expect(engine.moveTableauToFoundation(1).isFailure()).toBe(true);
    expect(engine.moveTableauToFoundation(99).isFailure()).toBe(true);

    // Set col 1 with hidden card + Ace of Spades
    (engine.state as any).tableau[1] = [hiddenCard, aceSpades];

    const res = engine.moveTableauToFoundation(1);
    expect(res.isSuccess()).toBe(true);
    expect(engine.state.foundations[CardSuitEnum.Spades].length).toBe(1);
    expect(engine.state.tableau[1]!.length).toBe(1);
    // Newly exposed top card is automatically flipped face-up
    expect(engine.state.tableau[1]![0]!.faceUp).toBe(true);
    expect(engine.state.score).toBe(15); // 10 pts for foundation + 5 pts for flip
  });

  it('moves stacks between tableau columns', () => {
    const engine = new CathedralSolitaireEngine();
    const hiddenCard: PlayingCard = { suit: CardSuitEnum.Clubs, value: CardValueEnum.Ten, faceUp: false };
    const redJack: PlayingCard = { suit: CardSuitEnum.Hearts, value: CardValueEnum.Jack, faceUp: true };
    const blackTen: PlayingCard = { suit: CardSuitEnum.Spades, value: CardValueEnum.Ten, faceUp: true };
    const blackQueen: PlayingCard = { suit: CardSuitEnum.Clubs, value: CardValueEnum.Queen, faceUp: true };

    // Set col 0 with hidden card, red Jack, black Ten
    (engine.state as any).tableau[0] = [hiddenCard, redJack, blackTen];
    // Set col 1 with black Queen
    (engine.state as any).tableau[1] = [blackQueen];

    // Invalid column bounds
    expect(engine.moveTableauToTableau(0, 1, 0).isFailure()).toBe(true);
    expect(engine.moveTableauToTableau(0, 9, 1).isFailure()).toBe(true);
    // Cannot move face down card
    expect(engine.moveTableauToTableau(0, 0, 1).isFailure()).toBe(true);

    // Move stack [red Jack, black Ten] onto black Queen
    const moveStackRes = engine.moveTableauToTableau(0, 1, 1);
    expect(moveStackRes.isSuccess()).toBe(true);

    // Dest col 1 now has 3 cards: Queen, Jack, Ten
    expect(engine.state.tableau[1]!.length).toBe(3);
    expect(engine.state.tableau[1]![1]!.value).toBe(CardValueEnum.Jack);
    expect(engine.state.tableau[1]![2]!.value).toBe(CardValueEnum.Ten);

    // Source col 0 now has 1 card, which got auto-revealed
    expect(engine.state.tableau[0]!.length).toBe(1);
    expect(engine.state.tableau[0]![0]!.faceUp).toBe(true);
  });

  it('moves card from foundation back to tableau', () => {
    const engine = new CathedralSolitaireEngine();
    const blackKing: PlayingCard = { suit: CardSuitEnum.Spades, value: CardValueEnum.King, faceUp: true };
    const redQueen: PlayingCard = { suit: CardSuitEnum.Hearts, value: CardValueEnum.Queen, faceUp: true };

    (engine.state as any).foundations[CardSuitEnum.Hearts] = [redQueen];
    (engine.state as any).tableau[0] = [blackKing];

    // Invalid column
    expect(engine.moveFoundationToTableau(CardSuitEnum.Hearts, -1).isFailure()).toBe(true);
    // Empty foundation
    expect(engine.moveFoundationToTableau(CardSuitEnum.Spades, 0).isFailure()).toBe(true);

    // Valid move
    const res = engine.moveFoundationToTableau(CardSuitEnum.Hearts, 0);
    expect(res.isSuccess()).toBe(true);
    expect(engine.state.foundations[CardSuitEnum.Hearts].length).toBe(0);
    expect(engine.state.tableau[0]!.length).toBe(2);
    expect(engine.state.tableau[0]![1]!.value).toBe(CardValueEnum.Queen);
  });

  it('executes auto-move to foundations across waste and tableau', () => {
    const engine = new CathedralSolitaireEngine();
    const aceHearts: PlayingCard = { suit: CardSuitEnum.Hearts, value: CardValueEnum.Ace, faceUp: true };
    const twoHearts: PlayingCard = { suit: CardSuitEnum.Hearts, value: CardValueEnum.Two, faceUp: true };

    (engine.state as any).waste = [aceHearts];
    (engine.state as any).tableau = [[twoHearts], [], [], [], [], [], []];

    const autoRes = engine.autoMoveToFoundations();
    expect(autoRes.isSuccess()).toBe(true);
    expect(autoRes.getOrThrow().movedCount).toBe(2);
    expect(engine.state.foundations[CardSuitEnum.Hearts].length).toBe(2);
  });

  it('detects autocomplete eligibility and auto-completes winning game', () => {
    const engine = new CathedralSolitaireEngine();

    // With stock cards remaining, cannot autocomplete
    expect(engine.canAutoComplete()).toBe(false);
    expect(engine.autoComplete().isFailure()).toBe(true);

    // Set empty stock & waste, and all cards face-up in tableau
    (engine.state as any).stock = [];
    (engine.state as any).waste = [];
    (engine.state as any).tableau = [
      [{ suit: CardSuitEnum.Hearts, value: CardValueEnum.Ace, faceUp: true }],
      [], [], [], [], [], []
    ];

    expect(engine.canAutoComplete()).toBe(true);
    const partialComp = engine.autoComplete();
    expect(partialComp.isSuccess()).toBe(true);
    expect(partialComp.getOrThrow().success).toBe(false); // only 1 card moved, not fully won

    // Setup almost winning state (12 cards per suit in foundations, 4 Kings in tableau)
    const suits = [CardSuitEnum.Hearts, CardSuitEnum.Diamonds, CardSuitEnum.Clubs, CardSuitEnum.Spades];
    const nonKingValues = [
      CardValueEnum.Ace, CardValueEnum.Two, CardValueEnum.Three, CardValueEnum.Four,
      CardValueEnum.Five, CardValueEnum.Six, CardValueEnum.Seven, CardValueEnum.Eight,
      CardValueEnum.Nine, CardValueEnum.Ten, CardValueEnum.Jack, CardValueEnum.Queen
    ];
    for (const suit of suits) {
      (engine.state as any).foundations[suit] = nonKingValues.map(v => ({ suit, value: v, faceUp: true }));
    }
    (engine.state as any).tableau = [
      [{ suit: CardSuitEnum.Hearts, value: CardValueEnum.King, faceUp: true }],
      [{ suit: CardSuitEnum.Diamonds, value: CardValueEnum.King, faceUp: true }],
      [{ suit: CardSuitEnum.Clubs, value: CardValueEnum.King, faceUp: true }],
      [{ suit: CardSuitEnum.Spades, value: CardValueEnum.King, faceUp: true }],
      [], [], []
    ];

    expect(engine.isGameWon()).toBe(false);
    expect(engine.canAutoComplete()).toBe(true);
    const fullComp = engine.autoComplete();
    expect(fullComp.isSuccess()).toBe(true);
    expect(fullComp.getOrThrow().success).toBe(true);
    expect(engine.isGameWon()).toBe(true);
    expect(engine.state.stage).toBe(SolitaireStageEnum.Won);
  });

  it('supports undoing consecutive moves', () => {
    const engine = new CathedralSolitaireEngine();
    expect(engine.canUndo()).toBe(false);
    expect(engine.undo().isFailure()).toBe(true);

    engine.drawFromStock(1);
    expect(engine.canUndo()).toBe(true);
    expect(engine.state.waste.length).toBe(1);

    const undoRes = engine.undo();
    expect(undoRes.isSuccess()).toBe(true);
    expect(engine.state.waste.length).toBe(0);
    expect(engine.canUndo()).toBe(false);
  });

  it('restarts game with fresh layout', () => {
    const engine = new CathedralSolitaireEngine();
    engine.drawFromStock(1);
    expect(engine.state.waste.length).toBe(1);

    engine.restartGame();
    expect(engine.state.waste.length).toBe(0);
    expect(engine.state.stock.length).toBe(24);
    expect(engine.canUndo()).toBe(false);
  });

  it('exports and imports game snapshots safely', () => {
    const engine = new CathedralSolitaireEngine();
    engine.drawFromStock(1);

    const snapshot = engine.exportSnapshot();
    expect(snapshot.waste.length).toBe(1);

    const engine2 = new CathedralSolitaireEngine();
    expect(engine2.state.waste.length).toBe(0);

    const importRes = engine2.importSnapshot(snapshot);
    expect(importRes.isSuccess()).toBe(true);
    expect(engine2.state.waste.length).toBe(1);

    // Invalid snapshot formats
    expect(engine2.importSnapshot(null).isFailure()).toBe(true);
    expect(engine2.importSnapshot({ tableau: 'not-an-array' }).isFailure()).toBe(true);
  });

  it('handles edge case validation errors across tableau and foundation moves', () => {
    const engine = new CathedralSolitaireEngine();

    // moveWasteToFoundation when waste is empty
    (engine.state as any).waste = [];
    expect(engine.moveWasteToFoundation().isFailure()).toBe(true);

    // moveWasteToTableau when waste is empty
    expect(engine.moveWasteToTableau(0).isFailure()).toBe(true);

    // moveWasteToTableau with invalid column index
    (engine.state as any).waste = [{ suit: CardSuitEnum.Hearts, value: CardValueEnum.Ace, faceUp: true }];
    expect(engine.moveWasteToTableau(-1).isFailure()).toBe(true);
    expect(engine.moveWasteToTableau(7).isFailure()).toBe(true);

    // moveTableauToFoundation with empty column
    (engine.state as any).tableau[0] = [];
    expect(engine.moveTableauToFoundation(0).isFailure()).toBe(true);
    expect(engine.moveTableauToFoundation(-1).isFailure()).toBe(true);

    // moveTableauToFoundation with face-down top card
    (engine.state as any).tableau[0] = [{ suit: CardSuitEnum.Hearts, value: CardValueEnum.Ace, faceUp: false }];
    expect(engine.moveTableauToFoundation(0).isFailure()).toBe(true);

    // moveTableauToFoundation with targetSuit mismatch
    (engine.state as any).tableau[0] = [{ suit: CardSuitEnum.Hearts, value: CardValueEnum.Ace, faceUp: true }];
    expect(engine.moveTableauToFoundation(0, CardSuitEnum.Clubs).isFailure()).toBe(true);

    // moveTableauToFoundation when cannot stack on foundation
    (engine.state as any).tableau[0] = [{ suit: CardSuitEnum.Hearts, value: CardValueEnum.King, faceUp: true }];
    expect(engine.moveTableauToFoundation(0).isFailure()).toBe(true);

    // moveTableauToTableau invalid column indices or empty column
    expect(engine.moveTableauToTableau(-1, 0, 1).isFailure()).toBe(true);
    expect(engine.moveTableauToTableau(0, -1, 1).isFailure()).toBe(true);
    (engine.state as any).tableau[1] = [];
    expect(engine.moveTableauToTableau(1, 0, 1).isFailure()).toBe(true);

    // moveTableauToTableau invalid cardIndex (<0 or >=col.length)
    (engine.state as any).tableau[0] = [{ suit: CardSuitEnum.Hearts, value: CardValueEnum.Ace, faceUp: true }];
    expect(engine.moveTableauToTableau(0, -1, 1).isFailure()).toBe(true);
    expect(engine.moveTableauToTableau(0, 1, 5).isFailure()).toBe(true);
    expect(engine.moveTableauToTableau(0, 5, 1).isFailure()).toBe(true);

    // moveTableauToTableau moving face-down card (cardIndex 0 is faceUp: false)
    (engine.state as any).tableau[0] = [
      { suit: CardSuitEnum.Hearts, value: CardValueEnum.King, faceUp: false },
      { suit: CardSuitEnum.Spades, value: CardValueEnum.Queen, faceUp: true }
    ];
    expect(engine.moveTableauToTableau(0, 0, 1).isFailure()).toBe(true);

    // moveFoundationToTableau invalid target column
    expect(engine.moveFoundationToTableau(CardSuitEnum.Hearts, 7).isFailure()).toBe(true);
  });
});
