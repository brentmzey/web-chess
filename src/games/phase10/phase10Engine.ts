import {
  Option,
  some,
  none,
  Result,
  success,
  failure
} from '../../utils/fp';
import {
  AIModelEnum,
  ArcadeGameEnum,
  Phase10ColorEnum,
  Phase10SpecialEnum,
  PHASE_10_REQUIREMENTS,
  REAL_LIFE_GAME_CAPACITIES
} from '../../constants/gameEnums';
export { PHASE_10_REQUIREMENTS };
import { TableSeatManager } from '../multiplayer/tableSeatManager';
import { logger } from '../../utils/logger';

export interface Phase10Card {
  id: string;
  color: Phase10ColorEnum;
  value: number; // 1-12
  special: Phase10SpecialEnum; // Standard, Wild, Skip
}

export interface LaidPhaseGroup {
  type: 'set' | 'run' | 'color';
  cards: Phase10Card[];
}

export interface Phase10PlayerState {
  id: string;
  name: string;
  isBot: boolean;
  currentPhase: number; // 1 to 10
  phaseCompletedThisRound: boolean;
  hand: Phase10Card[];
  laidGroups: LaidPhaseGroup[];
  score: number;
}

export interface Phase10GameState {
  players: Phase10PlayerState[];
  currentTurnIndex: number;
  hasDrawnThisTurn: boolean;
  drawPile: Phase10Card[];
  discardPile: Phase10Card[];
  isRoundOver: boolean;
  isGameOver: boolean;
  winner: Option<string>;
  historyText: string[];
}

/**
 * Creates and shuffles a standard 108-card Phase 10 deck:
 * 4 colors (Red, Blue, Green, Yellow), numbers 1-12 (2 copies of each = 96 cards),
 * plus 8 Wild cards and 4 Skip cards.
 */
export function createPhase10Deck(): Phase10Card[] {
  const cards: Phase10Card[] = [];
  const colors = [
    Phase10ColorEnum.Red,
    Phase10ColorEnum.Blue,
    Phase10ColorEnum.Green,
    Phase10ColorEnum.Yellow
  ];
  let idCounter = 1;

  colors.forEach(col => {
    for (let num = 1; num <= 12; num++) {
      for (let copy = 0; copy < 2; copy++) {
        cards.push({
          id: `p10-${col}-${num}-${copy}-${idCounter++}`,
          color: col,
          value: num,
          special: Phase10SpecialEnum.Standard
        });
      }
    }
  });

  // 8 Wilds
  for (let w = 0; w < 8; w++) {
    cards.push({
      id: `p10-wild-${w}-${idCounter++}`,
      color: Phase10ColorEnum.Red, // default color representation
      value: 0,
      special: Phase10SpecialEnum.Wild
    });
  }

  // 4 Skips
  for (let s = 0; s < 4; s++) {
    cards.push({
      id: `p10-skip-${s}-${idCounter++}`,
      color: Phase10ColorEnum.Blue,
      value: 0,
      special: Phase10SpecialEnum.Skip
    });
  }

  // Fisher-Yates Shuffle
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = cards[i]!;
    cards[i] = cards[j]!;
    cards[j] = temp;
  }

  return cards;
}

/**
 * Validates if cards form a valid Set of given size (cards share same number or are Wild).
 */
export function isValidSet(cards: Phase10Card[], minSize: number): boolean {
  if (cards.length < minSize) return false;
  const nonWilds = cards.filter(c => c.special === Phase10SpecialEnum.Standard);
  if (nonWilds.length === 0) return true; // All wilds count as valid set
  const targetVal = nonWilds[0]!.value;
  return nonWilds.every(c => c.value === targetVal);
}

/**
 * Validates if cards form a valid Run of given size (consecutive numbers, Wilds can fill gaps).
 */
export function isValidRun(cards: Phase10Card[], minSize: number): boolean {
  if (cards.length < minSize) return false;
  const nonWilds = cards
    .filter(c => c.special === Phase10SpecialEnum.Standard)
    .sort((a, b) => a.value - b.value);

  if (nonWilds.length === 0) return true;

  // Check duplicates in non-wilds
  for (let i = 0; i < nonWilds.length - 1; i++) {
    if (nonWilds[i]!.value === nonWilds[i + 1]!.value) return false;
  }

  const minVal = nonWilds[0]!.value;
  const maxVal = nonWilds[nonWilds.length - 1]!.value;
  const span = maxVal - minVal + 1;

  if (span > cards.length) return false;
  return true;
}

/**
 * Validates if cards form a valid Color group of given size.
 */
export function isValidColorGroup(cards: Phase10Card[], minSize: number): boolean {
  if (cards.length < minSize) return false;
  const nonWilds = cards.filter(c => c.special === Phase10SpecialEnum.Standard);
  if (nonWilds.length === 0) return true;
  const targetColor = nonWilds[0]!.color;
  return nonWilds.every(c => c.color === targetColor);
}

export class Phase10Engine {
  public state: Phase10GameState;
  public readonly seatManager: TableSeatManager<Phase10PlayerState>;

  constructor(player1Name: string = 'Human Pilgrim',
              player2Name: string = 'Cathedral AI Prior',
              customDeck?: Phase10Card[],
              playerCount: number = 2) {
    const deck = customDeck || createPhase10Deck();
    const maxSeats = REAL_LIFE_GAME_CAPACITIES[ArcadeGameEnum.Phase10].maxPlayers;
    const totalPlayers = Math.max(2, Math.min(maxSeats, playerCount));
    this.seatManager = new TableSeatManager<Phase10PlayerState>(maxSeats, 2, AIModelEnum.MicroNeural);

    const playersList: Phase10PlayerState[] = [];
    const botNames = ['Cathedral AI Prior', 'Abbot Brother', 'Deacon Michael', 'Novice Thomas', 'Archon Gregory'];

    for (let pIdx = 0; pIdx < totalPlayers; pIdx++) {
      const pHand: Phase10Card[] = [];
      for (let i = 0; i < 10; i++) {
        pHand.push(deck.pop()!);
      }

      const pName = pIdx === 0
        ? player1Name
        : pIdx === 1
        ? player2Name
        : botNames[pIdx - 1] || `Sanctuary Bot #${pIdx + 1}`;

      const playerState: Phase10PlayerState = {
        id: `p${pIdx + 1}`,
        name: pName,
        isBot: pIdx > 0,
        currentPhase: 1,
        phaseCompletedThisRound: false,
        hand: pHand,
        laidGroups: [],
        score: 0
      };
      playersList.push(playerState);

      if (pIdx === 0) {
        this.seatManager.claimSeat(1, playerState.id, playerState.name, playerState);
      } else {
        this.seatManager.updateSeatData(pIdx + 1, () => playerState);
      }
    }

    // Top card to discard pile
    const initialDiscard = [deck.pop()!];

    this.state = {
      players: playersList,
      currentTurnIndex: 0,
      hasDrawnThisTurn: false,
      drawPile: deck,
      discardPile: initialDiscard,
      isRoundOver: false,
      isGameOver: false,
      winner: none(),
      historyText: [`Phase 10 match started (${totalPlayers} players). Phase 1 active (2 Sets of 3).`]
    };
  }

  /**
   * Dynamically adds a new player (human or AI bot) to the Phase 10 table up to 6 players.
   */
  public addPlayer(playerName: string,
                   isBot: boolean = false): Result<Phase10PlayerState, string> {
    const maxSeats = REAL_LIFE_GAME_CAPACITIES[ArcadeGameEnum.Phase10].maxPlayers;
    if (this.state.players.length >= maxSeats) {
      return failure(`Phase 10 table is at maximum capacity (${maxSeats} players).`);
    }

    const seatIdx = this.state.players.length + 1;
    const pHand: Phase10Card[] = [];
    for (let i = 0; i < 10; i++) {
      this.checkRecycleDeck();
      if (this.state.drawPile.length > 0) {
        pHand.push(this.state.drawPile.pop()!);
      }
    }

    const newPlayer: Phase10PlayerState = {
      id: `p${seatIdx}`,
      name: playerName,
      isBot,
      currentPhase: 1,
      phaseCompletedThisRound: false,
      hand: pHand,
      laidGroups: [],
      score: 0
    };

    this.state.players.push(newPlayer);
    if (!isBot) {
      this.seatManager.claimSeat(seatIdx, newPlayer.id, newPlayer.name, newPlayer);
    } else {
      this.seatManager.updateSeatData(seatIdx, () => newPlayer);
    }

    this.state.historyText.push(`${playerName} (${isBot ? 'AI Bot' : 'Human'}) joined Seat #${seatIdx} (${this.state.players.length}/${maxSeats} players).`);
    return success(newPlayer);
  }

  /**
   * Hot-swaps an existing seat to a Human user.
   */
  public claimSeatForHuman(playerIndex: number,
                           humanName: string): Result<Phase10PlayerState, string> {
    if (playerIndex < 0 || playerIndex >= this.state.players.length) {
      return failure(`Invalid player index ${playerIndex}.`);
    }
    const target = this.state.players[playerIndex]!;
    target.name = humanName;
    target.isBot = false;
    this.seatManager.claimSeat(playerIndex + 1, target.id, humanName, target);
    this.state.historyText.push(`${humanName} claimed Seat #${playerIndex + 1}.`);
    return success(target);
  }

  /**
   * Hot-swaps a departing human player back to an AI Bot.
   */
  public vacatePlayerSeat(playerId: string,
                          fallbackBotName: string = 'Prior Guardian Bot'): Result<Phase10PlayerState, string> {
    const idx = this.state.players.findIndex(p => p.id === playerId);
    if (idx < 0) {
      return failure(`Player ${playerId} not found.`);
    }
    const target = this.state.players[idx]!;
    target.isBot = true;
    target.name = `${fallbackBotName} #${idx + 1}`;
    this.seatManager.vacateSeat(idx + 1, AIModelEnum.MicroNeural, fallbackBotName);
    this.state.historyText.push(`Seat #${idx + 1} hot-swapped to ${target.name}.`);
    return success(target);
  }

  public getCurrentPlayer(): Phase10PlayerState {
    return this.state.players[this.state.currentTurnIndex]!;
  }

  public getOpponentPlayer(): Phase10PlayerState {
    return this.state.players[(this.state.currentTurnIndex + 1) % this.state.players.length]!;
  }

  private checkRecycleDeck(): void {
    if (this.state.drawPile.length === 0 && this.state.discardPile.length > 1) {
      const topDiscard = this.state.discardPile.pop()!;
      this.state.drawPile = [...this.state.discardPile];
      this.state.discardPile = [topDiscard];

      for (let i = this.state.drawPile.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = this.state.drawPile[i]!;
        this.state.drawPile[i] = this.state.drawPile[j]!;
        this.state.drawPile[j] = temp;
      }
      this.state.historyText.push('Recycled discard pile into draw deck.');
    }
  }

  /**
   * Draws a card from either the draw pile or discard pile.
   */
  public drawCard(fromDiscard: boolean): Result<Phase10Card, string> {
    if (this.state.isGameOver) return failure('Game is already over.');
    if (this.state.hasDrawnThisTurn) return failure('Already drew a card this turn.');

    const player = this.getCurrentPlayer();

    if (fromDiscard) {
      if (this.state.discardPile.length === 0) return failure('Discard pile is empty.');
      const card = this.state.discardPile.pop()!;
      player.hand.push(card);
      this.state.hasDrawnThisTurn = true;
      this.state.historyText.push(`${player.name} drew from discard pile.`);
      return success(card);
    } else {
      this.checkRecycleDeck();
      if (this.state.drawPile.length === 0) return failure('No cards left to draw.');
      const card = this.state.drawPile.pop()!;
      player.hand.push(card);
      this.state.hasDrawnThisTurn = true;
      this.state.historyText.push(`${player.name} drew from draw deck.`);
      return success(card);
    }
  }

  /**
   * Validates whether two subsets of cards satisfy the player's phase requirement.
   */
  public validatePhaseAttempt(
    phaseNumber: number,
    group1: Phase10Card[],
    group2?: Phase10Card[]
  ): boolean {
    const g2 = group2 || [];
    switch (phaseNumber) {
      case 1: // 2 sets of 3
        return isValidSet(group1, 3) && isValidSet(g2, 3);
      case 2: // 1 set of 3 + 1 run of 4
        return (isValidSet(group1, 3) && isValidRun(g2, 4)) || (isValidRun(group1, 4) && isValidSet(g2, 3));
      case 3: // 1 set of 4 + 1 run of 4
        return (isValidSet(group1, 4) && isValidRun(g2, 4)) || (isValidRun(group1, 4) && isValidSet(g2, 4));
      case 4: // 1 run of 7
        return isValidRun(group1, 7);
      case 5: // 1 run of 8
        return isValidRun(group1, 8);
      case 6: // 1 run of 9
        return isValidRun(group1, 9);
      case 7: // 2 sets of 4
        return isValidSet(group1, 4) && isValidSet(g2, 4);
      case 8: // 7 cards of one color
        return isValidColorGroup(group1, 7);
      case 9: // 1 set of 5 + 1 set of 2
        return (isValidSet(group1, 5) && isValidSet(g2, 2)) || (isValidSet(group1, 2) && isValidSet(g2, 5));
      case 10: // 1 set of 5 + 1 set of 3
        return (isValidSet(group1, 5) && isValidSet(g2, 3)) || (isValidSet(group1, 3) && isValidSet(g2, 5));
      default:
        return false;
    }
  }

  /**
   * Lays down current phase for active player.
   */
  public layDownPhase(group1Indices: number[], group2Indices: number[] = []): Result<string, string> {
    if (!this.state.hasDrawnThisTurn) return failure('Must draw a card before laying down phase.');
    const player = this.getCurrentPlayer();
    if (player.phaseCompletedThisRound) return failure('Phase already completed for this round.');

    const allIndices = [...group1Indices, ...group2Indices];
    if (new Set(allIndices).size !== allIndices.length) {
      return failure('Cannot use the same card in multiple phase groups.');
    }

    const g1Cards = group1Indices.map(i => player.hand[i]!).filter(Boolean);
    const g2Cards = group2Indices.map(i => player.hand[i]!).filter(Boolean);

    if (!this.validatePhaseAttempt(player.currentPhase, g1Cards, g2Cards)) {
      return failure(`Cards do not fulfill Phase ${player.currentPhase} requirements.`);
    }

    // Remove cards from hand (sort descending to not corrupt splice indices)
    allIndices.sort((a, b) => b - a).forEach(i => {
      player.hand.splice(i, 1);
    });

    player.laidGroups.push({ type: 'set', cards: g1Cards });
    if (g2Cards.length > 0) {
      player.laidGroups.push({ type: 'set', cards: g2Cards });
    }

    player.phaseCompletedThisRound = true;
    const msg = `${player.name} laid down Phase ${player.currentPhase}!`;
    this.state.historyText.push(msg);
    logger.info(`[SERVER_SIDE] [PHASE10_TRACE] ${msg}`);
    return success(msg);
  }

  /**
   * Hits a card from hand onto an already laid group.
   */
  public hitCard(handIndex: number, targetPlayerId: string, groupIndex: number): Result<string, string> {
    if (!this.state.hasDrawnThisTurn) return failure('Must draw a card first.');
    const player = this.getCurrentPlayer();
    if (!player.phaseCompletedThisRound) return failure('Must complete your phase before hitting.');

    const targetPlayer = this.state.players.find(p => p.id === targetPlayerId);
    if (!targetPlayer || !targetPlayer.laidGroups[groupIndex]) {
      return failure('Target laid group not found.');
    }

    if (handIndex < 0 || handIndex >= player.hand.length) {
      return failure('Invalid hand card.');
    }

    const card = player.hand[handIndex]!;
    const group = targetPlayer.laidGroups[groupIndex]!;

    // Test if adding card keeps group valid
    const testGroup = [...group.cards, card];
    const isStillSet = isValidSet(testGroup, testGroup.length);
    const isStillRun = isValidRun(testGroup, testGroup.length);
    const isStillColor = isValidColorGroup(testGroup, testGroup.length);

    if (!isStillSet && !isStillRun && !isStillColor) {
      return failure('Card does not fit onto the selected phase group.');
    }

    player.hand.splice(handIndex, 1);
    group.cards.push(card);

    // Check if player emptied hand (Went Out)
    if (player.hand.length === 0) {
      return this.handleRoundEnd(player);
    }

    const hitMsg = `${player.name} hit on ${targetPlayer.name}'s Phase group!`;
    this.state.historyText.push(hitMsg);
    return success(hitMsg);
  }

  /**
   * Discards a card and concludes turn.
   */
  public discardAndEndTurn(handIndex: number): Result<string, string> {
    if (!this.state.hasDrawnThisTurn) return failure('Must draw a card before ending turn.');
    const player = this.getCurrentPlayer();

    if (handIndex < 0 || handIndex >= player.hand.length) {
      return failure('Invalid hand index.');
    }

    const card = player.hand.splice(handIndex, 1)[0]!;
    this.state.discardPile.push(card);
    this.state.historyText.push(`${player.name} discarded ${card.color} ${card.value || card.special}.`);

    // Check if player went out
    if (player.hand.length === 0) {
      return this.handleRoundEnd(player);
    }

    // Reset turn flags and advance
    this.state.hasDrawnThisTurn = false;
    this.state.currentTurnIndex = (this.state.currentTurnIndex + 1) % this.state.players.length;

    return success(`Turn concluded. Now ${this.getCurrentPlayer().name}'s turn.`);
  }

  /**
   * Handles round settlement when a player goes out.
   */
  private handleRoundEnd(winner: Phase10PlayerState): Result<string, string> {
    this.state.isRoundOver = true;

    // Advance phase for players who finished their phase
    this.state.players.forEach(p => {
      if (p.phaseCompletedThisRound) {
        p.currentPhase += 1;
        if (p.currentPhase > 10) {
          this.state.isGameOver = true;
          this.state.winner = some(p.id);
        }
      }
      // Add penalty points for remaining hand cards
      p.hand.forEach(c => {
        p.score += c.special === Phase10SpecialEnum.Wild ? 25 : c.special === Phase10SpecialEnum.Skip ? 15 : c.value;
      });
    });

    const msg = this.state.isGameOver
      ? `${winner.name} completed all 10 Phases and won the tournament!`
      : `${winner.name} went out! Round finished. Advancing phases.`;

    this.state.historyText.push(msg);
    logger.info(`[SERVER_SIDE] [PHASE10_TRACE] Round End: ${msg}`);
    return success(msg);
  }

  /**
   * Autonomous AI bot turn.
   */
  public autoPlayBotTurn(): string[] {
    const logs: string[] = [];
    if (this.state.isGameOver || this.state.isRoundOver) return logs;

    const bot = this.getCurrentPlayer();

    // 1. Draw
    const drawRes = this.drawCard(false);
    if (drawRes.isSuccess()) {
      logs.push(`${bot.name} drew a card.`);
    }

    // 2. Try laying down phase if not completed
    if (!bot.phaseCompletedThisRound) {
      // Evaluate subsets in bot's hand
      const req = PHASE_10_REQUIREMENTS[bot.currentPhase - 1];
      if (req) {
        // Quick greedy check for 2 sets of 3 (Phase 1)
        if (bot.currentPhase === 1) {
          const valCounts: Record<number, number[]> = {};
          bot.hand.forEach((c, idx) => {
            if (c.special === Phase10SpecialEnum.Standard) {
              valCounts[c.value] = valCounts[c.value] || [];
              valCounts[c.value]!.push(idx);
            }
          });
          const setsOf3 = Object.values(valCounts).filter(arr => arr.length >= 3);
          if (setsOf3.length >= 2) {
            const g1 = setsOf3[0]!.slice(0, 3);
            const g2 = setsOf3[1]!.slice(0, 3);
            const layRes = this.layDownPhase(g1, g2);
            if (layRes.isSuccess()) logs.push(layRes.getOrThrow());
          }
        }
      }
    }

    // 3. Discard highest card
    if (bot.hand.length > 0) {
      let maxIdx = 0;
      let maxVal = -1;
      bot.hand.forEach((c, i) => {
        if (c.value > maxVal && c.special === Phase10SpecialEnum.Standard) {
          maxVal = c.value;
          maxIdx = i;
        }
      });
      const discRes = this.discardAndEndTurn(maxIdx);
      if (discRes.isSuccess()) {
        logs.push(discRes.getOrThrow());
      }
    }

    return logs;
  }

  /**
   * Commences the next round by reshuffling and dealing 10 cards to all seated players.
   */
  public startNextRound(): Result<string, string> {
    if (this.state.isGameOver) return failure('Game is already over.');
    const deck = createPhase10Deck();

    this.state.players.forEach(p => {
      p.hand = [];
      p.laidGroups = [];
      p.phaseCompletedThisRound = false;
      for (let i = 0; i < 10; i++) {
        p.hand.push(deck.pop()!);
      }
    });

    this.state.drawPile = deck;
    this.state.discardPile = [deck.pop()!];
    this.state.isRoundOver = false;
    this.state.hasDrawnThisTurn = false;
    this.state.currentTurnIndex = 0;
    this.state.historyText.push(`New round started. Phases advanced.`);
    return success('New round started successfully.');
  }
}
