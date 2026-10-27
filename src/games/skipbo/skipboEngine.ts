import {
  Option,
  some,
  none,
  Result,
  success,
  failure,
  match
} from '../../utils/fp';
import {
  SkipBoCardTypeEnum,
  SkipBoSourcePileEnum
} from '../../constants/gameEnums';
import { logger } from '../../utils/logger';

export interface SkipBoCard {
  id: string;
  type: SkipBoCardTypeEnum;
  value: number; // 1-12, or 0 for Wild
}

export interface SkipBoPlayerState {
  id: string;
  name: string;
  isBot: boolean;
  stockpile: SkipBoCard[];
  hand: SkipBoCard[];
  discardPiles: [SkipBoCard[], SkipBoCard[], SkipBoCard[], SkipBoCard[]];
}

export interface SkipBoGameState {
  players: SkipBoPlayerState[];
  currentTurnIndex: number;
  buildingPiles: [SkipBoCard[], SkipBoCard[], SkipBoCard[], SkipBoCard[]];
  drawPile: SkipBoCard[];
  recyclePile: SkipBoCard[];
  isGameOver: boolean;
  winner: Option<string>;
  historyText: string[];
}

/**
 * Creates and shuffles a standard 162-card Skip-Bo deck:
 * 144 number cards (12 each of 1-12) + 18 Skip-Bo wild cards.
 */
export function createSkipBoDeck(): SkipBoCard[] {
  const cards: SkipBoCard[] = [];
  let idCounter = 1;

  for (let num = 1; num <= 12; num++) {
    for (let count = 0; count < 12; count++) {
      cards.push({
        id: `sb-${num}-${count}-${idCounter++}`,
        type: SkipBoCardTypeEnum.Number,
        value: num
      });
    }
  }

  for (let w = 0; w < 18; w++) {
    cards.push({
      id: `sb-wild-${w}-${idCounter++}`,
      type: SkipBoCardTypeEnum.Wild,
      value: 0
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

export class SkipBoEngine {
  public state: SkipBoGameState;

  constructor(
    player1Name: string = 'Human Pilgrim',
    player2Name: string = 'Cathedral AI Abbot',
    stockpileSize: number = 15,
    customDeck?: SkipBoCard[]
  ) {
    const deck = customDeck || createSkipBoDeck();

    const p1Stock: SkipBoCard[] = [];
    const p2Stock: SkipBoCard[] = [];

    for (let i = 0; i < stockpileSize; i++) {
      p1Stock.push(deck.pop()!);
      p2Stock.push(deck.pop()!);
    }

    const p1Hand: SkipBoCard[] = [];
    const p2Hand: SkipBoCard[] = [];

    // Deal initial 5 cards to Player 1 (starting player)
    for (let i = 0; i < 5; i++) {
      p1Hand.push(deck.pop()!);
    }

    const player1: SkipBoPlayerState = {
      id: 'p1',
      name: player1Name,
      isBot: false,
      stockpile: p1Stock,
      hand: p1Hand,
      discardPiles: [[], [], [], []]
    };

    const player2: SkipBoPlayerState = {
      id: 'p2',
      name: player2Name,
      isBot: true,
      stockpile: p2Stock,
      hand: p2Hand,
      discardPiles: [[], [], [], []]
    };

    this.state = {
      players: [player1, player2],
      currentTurnIndex: 0,
      buildingPiles: [[], [], [], []],
      drawPile: deck,
      recyclePile: [],
      isGameOver: false,
      winner: none(),
      historyText: ['Sacred Skip-Bo match commenced. Deal complete.']
    };
  }

  public getCurrentPlayer(): SkipBoPlayerState {
    return this.state.players[this.state.currentTurnIndex]!;
  }

  public getOpponentPlayer(): SkipBoPlayerState {
    return this.state.players[(this.state.currentTurnIndex + 1) % this.state.players.length]!;
  }

  /**
   * Refills draw pile from recycled cards if empty.
   */
  private checkRecycleDrawPile(): void {
    if (this.state.drawPile.length === 0 && this.state.recyclePile.length > 0) {
      this.state.drawPile = [...this.state.recyclePile];
      this.state.recyclePile = [];
      // Shuffle recycled
      for (let i = this.state.drawPile.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = this.state.drawPile[i]!;
        this.state.drawPile[i] = this.state.drawPile[j]!;
        this.state.drawPile[j] = temp;
      }
      this.state.historyText.push('Recycled building pile cards into fresh draw deck.');
    }
  }

  /**
   * Refills current player hand to 5 cards from draw pile.
   */
  public refillHand(player: SkipBoPlayerState): void {
    while (player.hand.length < 5) {
      this.checkRecycleDrawPile();
      if (this.state.drawPile.length === 0) break;
      player.hand.push(this.state.drawPile.pop()!);
    }
  }

  /**
   * Checks if a card can be legally placed on a target building pile (0 to 3).
   */
  public canPlayOnBuilding(card: SkipBoCard, buildingPileIndex: number): boolean {
    if (buildingPileIndex < 0 || buildingPileIndex >= 4) return false;
    const pile = this.state.buildingPiles[buildingPileIndex]!;
    const expectedValue = pile.length === 0 ? 1 : pile.length + 1;

    if (expectedValue > 12) return false;
    if (card.type === SkipBoCardTypeEnum.Wild) return true;
    return card.value === expectedValue;
  }

  /**
   * Plays a card from stockpile, hand, or discard pile onto a target building pile.
   */
  public playToBuilding(
    source: SkipBoSourcePileEnum,
    sourceIndex: number,
    targetBuildingPileIndex: number
  ): Result<string, string> {
    if (this.state.isGameOver) {
      return failure('Match is already concluded.');
    }

    if (targetBuildingPileIndex < 0 || targetBuildingPileIndex >= 4) {
      return failure('Target building pile must be 0, 1, 2, or 3.');
    }

    const player = this.getCurrentPlayer();
    let cardToPlay: Option<SkipBoCard> = none();

    match(source, {
      [SkipBoSourcePileEnum.Stockpile]: () => {
        if (player.stockpile.length > 0) {
          cardToPlay = some(player.stockpile[player.stockpile.length - 1]!);
        }
      },
      [SkipBoSourcePileEnum.Hand]: () => {
        if (sourceIndex >= 0 && sourceIndex < player.hand.length) {
          cardToPlay = some(player.hand[sourceIndex]!);
        }
      },
      [SkipBoSourcePileEnum.Discard]: () => {
        if (sourceIndex >= 0 && sourceIndex < 4) {
          const discard = player.discardPiles[sourceIndex]!;
          if (discard.length > 0) {
            cardToPlay = some(discard[discard.length - 1]!);
          }
        }
      }
    });

    return cardToPlay.match({
      None: () => failure('No card available at specified source.'),
      Some: card => {
        if (!this.canPlayOnBuilding(card, targetBuildingPileIndex)) {
          return failure(
            `Card ${card.type === SkipBoCardTypeEnum.Wild ? 'WILD' : card.value} cannot be played onto Building Pile ${targetBuildingPileIndex + 1}.`
          );
        }

        // Remove card from source
        match(source, {
          [SkipBoSourcePileEnum.Stockpile]: () => {
            player.stockpile.pop();
          },
          [SkipBoSourcePileEnum.Hand]: () => {
            player.hand.splice(sourceIndex, 1);
          },
          [SkipBoSourcePileEnum.Discard]: () => {
            player.discardPiles[sourceIndex]!.pop();
          }
        });

        const pile = this.state.buildingPiles[targetBuildingPileIndex]!;
        pile.push(card);

        // Check if building pile is completed (reaches 12)
        if (pile.length === 12) {
          this.state.recyclePile.push(...pile);
          this.state.buildingPiles[targetBuildingPileIndex] = [];
          this.state.historyText.push(`Building Pile ${targetBuildingPileIndex + 1} completed and cleared to sanctuary!`);
        }

        // Check if stockpile is exhausted -> WIN!
        if (player.stockpile.length === 0) {
          this.state.isGameOver = true;
          this.state.winner = some(player.id);
          const winMsg = `${player.name} exhausted their Stockpile and achieved sacred victory!`;
          this.state.historyText.push(winMsg);
          logger.info(`[SERVER_SIDE] [SKIPBO_TRACE] Game Won by ${player.name}`);
          return success(winMsg);
        }

        // If player hand is now empty, immediately draw 5 more!
        if (player.hand.length === 0) {
          this.refillHand(player);
          this.state.historyText.push(`${player.name} played all 5 hand cards and drew a fresh 5-card hand!`);
        }

        const playMsg = `${player.name} played ${card.type === SkipBoCardTypeEnum.Wild ? 'WILD' : card.value} to Pile ${targetBuildingPileIndex + 1}`;
        this.state.historyText.push(playMsg);
        return success(playMsg);
      }
    });
  }

  /**
   * Discards a card from hand to a discard pile, ending the turn.
   */
  public discardAndEndTurn(handIndex: number, discardPileIndex: number): Result<string, string> {
    if (this.state.isGameOver) {
      return failure('Match is already concluded.');
    }

    if (discardPileIndex < 0 || discardPileIndex >= 4) {
      return failure('Discard pile index must be between 0 and 3.');
    }

    const player = this.getCurrentPlayer();
    if (handIndex < 0 || handIndex >= player.hand.length) {
      return failure('Invalid hand card index.');
    }

    const card = player.hand.splice(handIndex, 1)[0]!;
    player.discardPiles[discardPileIndex]!.push(card);

    this.state.historyText.push(
      `${player.name} discarded ${card.type === SkipBoCardTypeEnum.Wild ? 'WILD' : card.value} to Discard Pile ${discardPileIndex + 1}.`
    );

    // Advance turn
    this.state.currentTurnIndex = (this.state.currentTurnIndex + 1) % this.state.players.length;
    const nextPlayer = this.getCurrentPlayer();

    // Refill next player hand up to 5 cards
    this.refillHand(nextPlayer);

    return success(`Turn ended. Now ${nextPlayer.name}'s turn.`);
  }

  /**
   * Autonomous AI Bot turn solver.
   * Plays stockpile, hand, and discard cards intelligently before discarding to end turn.
   */
  public autoPlayBotTurn(): string[] {
    const logs: string[] = [];
    if (this.state.isGameOver) return logs;

    const bot = this.getCurrentPlayer();
    let playedAny = true;

    while (playedAny && !this.state.isGameOver) {
      playedAny = false;

      // 1. Try playing top of stockpile (highest priority!)
      if (bot.stockpile.length > 0) {
        const topStock = bot.stockpile[bot.stockpile.length - 1]!;
        for (let b = 0; b < 4; b++) {
          if (this.canPlayOnBuilding(topStock, b)) {
            const res = this.playToBuilding(SkipBoSourcePileEnum.Stockpile, 0, b);
            if (res.isSuccess()) {
              logs.push(res.getOrThrow());
              playedAny = true;
              break;
            }
          }
        }
        if (playedAny) continue;
      }

      // 2. Try playing from hand to build piles
      for (let h = 0; h < bot.hand.length; h++) {
        const hCard = bot.hand[h]!;
        for (let b = 0; b < 4; b++) {
          if (this.canPlayOnBuilding(hCard, b)) {
            const res = this.playToBuilding(SkipBoSourcePileEnum.Hand, h, b);
            if (res.isSuccess()) {
              logs.push(res.getOrThrow());
              playedAny = true;
              break;
            }
          }
        }
        if (playedAny) break;
      }
      if (playedAny) continue;

      // 3. Try playing from discard piles
      for (let d = 0; d < 4; d++) {
        const discPile = bot.discardPiles[d]!;
        if (discPile.length > 0) {
          const topDisc = discPile[discPile.length - 1]!;
          for (let b = 0; b < 4; b++) {
            if (this.canPlayOnBuilding(topDisc, b)) {
              const res = this.playToBuilding(SkipBoSourcePileEnum.Discard, d, b);
              if (res.isSuccess()) {
                logs.push(res.getOrThrow());
                playedAny = true;
                break;
              }
            }
          }
          if (playedAny) break;
        }
      }
    }

    // If game ended during play, return logs without discarding
    if (this.state.isGameOver) return logs;

    // Discard 1 card from hand to optimal discard pile
    if (bot.hand.length > 0) {
      // Pick highest value non-wild card to discard, or card 0
      let bestCardIndex = 0;
      let highestVal = -1;
      bot.hand.forEach((c, idx) => {
        if (c.type === SkipBoCardTypeEnum.Number && c.value > highestVal) {
          highestVal = c.value;
          bestCardIndex = idx;
        }
      });

      // Pick discard pile: prefer pile whose top is >= card value, or empty pile
      let bestDiscardPile = 0;
      const targetVal = bot.hand[bestCardIndex]!.value;
      for (let p = 0; p < 4; p++) {
        const pile = bot.discardPiles[p]!;
        if (pile.length === 0) {
          bestDiscardPile = p;
          break;
        } else if (pile[pile.length - 1]!.value >= targetVal) {
          bestDiscardPile = p;
          break;
        }
      }

      const discardRes = this.discardAndEndTurn(bestCardIndex, bestDiscardPile);
      if (discardRes.isSuccess()) {
        logs.push(discardRes.getOrThrow());
      }
    }

    return logs;
  }
}
