import {
  Option,
  some,
  none,
  Result,
  success,
  failure
} from '../../utils/fp';
import { AIModelEnum, ArcadeGameEnum, REAL_LIFE_GAME_CAPACITIES } from '../../constants/gameEnums';
import { TableSeatManager } from '../multiplayer/tableSeatManager';
import { logger } from '../../utils/logger';

export type UnoColor = 'red' | 'blue' | 'green' | 'yellow' | 'wild';
export type UnoCardType = 'number' | 'skip' | 'reverse' | 'draw2' | 'wild' | 'wild4';

export interface UnoCard {
  id: string;
  color: UnoColor;
  type: UnoCardType;
  value: number; // 0-9 for numbers, -1 for action/wild
}

export interface UnoPlayerState {
  id: string;
  name: string;
  isBot: boolean;
  hand: UnoCard[];
  calledUno: boolean;
}

export interface UnoGameState {
  players: UnoPlayerState[];
  currentTurnIndex: number;
  direction: 1 | -1; // 1 = clockwise, -1 = counter-clockwise
  drawPile: UnoCard[];
  discardPile: UnoCard[];
  activeColor: UnoColor;
  isGameOver: boolean;
  winner: Option<string>;
  historyText: string[];
}

export function createUnoDeck(): UnoCard[] {
  const deck: UnoCard[] = [];
  const colors: UnoColor[] = ['red', 'blue', 'green', 'yellow'];
  let idCounter = 1;

  colors.forEach(color => {
    // One 0 per color
    deck.push({ id: `uno-${color}-0-${idCounter++}`, color, type: 'number', value: 0 });

    // Two of each 1-9 per color
    for (let num = 1; num <= 9; num++) {
      deck.push({ id: `uno-${color}-${num}a-${idCounter++}`, color, type: 'number', value: num });
      deck.push({ id: `uno-${color}-${num}b-${idCounter++}`, color, type: 'number', value: num });
    }

    // Two of each action card per color
    for (let a = 0; a < 2; a++) {
      deck.push({ id: `uno-${color}-skip-${a}-${idCounter++}`, color, type: 'skip', value: -1 });
      deck.push({ id: `uno-${color}-rev-${a}-${idCounter++}`, color, type: 'reverse', value: -1 });
      deck.push({ id: `uno-${color}-d2-${a}-${idCounter++}`, color, type: 'draw2', value: -1 });
    }
  });

  // 4 Wilds and 4 Wild Draw 4
  for (let w = 0; w < 4; w++) {
    deck.push({ id: `uno-wild-${w}-${idCounter++}`, color: 'wild', type: 'wild', value: -1 });
    deck.push({ id: `uno-wild4-${w}-${idCounter++}`, color: 'wild', type: 'wild4', value: -1 });
  }

  // Shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = deck[i]!;
    deck[i] = deck[j]!;
    deck[j] = temp;
  }

  return deck;
}

export class CardinalUnoEngine {
  public state: UnoGameState;
  public readonly seatManager: TableSeatManager<UnoPlayerState>;

  constructor(player1Name: string = 'Human Pilgrim',
              playerCount: number = 4,
              customDeck?: UnoCard[]) {
    const maxAllowed = REAL_LIFE_GAME_CAPACITIES[ArcadeGameEnum.Uno].maxPlayers;
    const totalPlayers = Math.max(2, Math.min(maxAllowed, playerCount));
    const deck = customDeck || createUnoDeck();
    this.seatManager = new TableSeatManager<UnoPlayerState>(maxAllowed, 2, AIModelEnum.MicroNeural);

    const botNames = [
      'Cardinal AI',
      'Archbishop Bot',
      'Deacon Michael',
      'Prior Gabriel',
      'Novice Raphael',
      'Canon Ignatius',
      'Abbot Benedict',
      'Vicar Dominic',
      'Brother Martin'
    ];

    const playersList: UnoPlayerState[] = [];

    for (let pIdx = 0; pIdx < totalPlayers; pIdx++) {
      const hand: UnoCard[] = [];
      for (let i = 0; i < 7; i++) {
        hand.push(deck.pop()!);
      }
      const pName = pIdx === 0 ? player1Name : botNames[pIdx - 1] || `UnoBot #${pIdx + 1}`;
      const pState: UnoPlayerState = {
        id: `p${pIdx + 1}`,
        name: pName,
        isBot: pIdx > 0,
        hand,
        calledUno: false
      };
      playersList.push(pState);
      if (pIdx === 0) {
        this.seatManager.claimSeat(1, pState.id, pState.name, pState);
      } else {
        this.seatManager.updateSeatData(pIdx + 1, () => pState);
      }
    }

    // Discard pile start card (non-wild preferred)
    let startCard = deck.pop()!;
    while (startCard.color === 'wild' && deck.length > 0) {
      deck.unshift(startCard);
      startCard = deck.pop()!;
    }

    this.state = {
      players: playersList,
      currentTurnIndex: 0,
      direction: 1,
      drawPile: deck,
      discardPile: [startCard],
      activeColor: startCard.color,
      isGameOver: false,
      winner: none(),
      historyText: [`Cardinal Uno initiated with ${totalPlayers} players. Start card: ${startCard.color} ${startCard.type === 'number' ? startCard.value : startCard.type}.`]
    };
  }

  /**
   * Dynamically adds a new player (human or AI bot) to the Uno table up to 10 players.
   */
  public addPlayer(playerName: string,
                   isBot: boolean = false): Result<UnoPlayerState, string> {
    const maxAllowed = REAL_LIFE_GAME_CAPACITIES[ArcadeGameEnum.Uno].maxPlayers;
    if (this.state.players.length >= maxAllowed) {
      return failure(`Cardinal Uno table is at maximum capacity (${maxAllowed} players).`);
    }

    const seatIdx = this.state.players.length + 1;
    const hand: UnoCard[] = [];
    for (let i = 0; i < 7; i++) {
      this.checkRecycleDeck();
      if (this.state.drawPile.length > 0) {
        hand.push(this.state.drawPile.pop()!);
      }
    }

    const newPlayer: UnoPlayerState = {
      id: `p${seatIdx}`,
      name: playerName,
      isBot,
      hand,
      calledUno: false
    };

    this.state.players.push(newPlayer);
    if (!isBot) {
      this.seatManager.claimSeat(seatIdx, newPlayer.id, newPlayer.name, newPlayer);
    } else {
      this.seatManager.updateSeatData(seatIdx, () => newPlayer);
    }

    this.state.historyText.push(`${playerName} (${isBot ? 'AI Bot' : 'Human'}) joined Seat #${seatIdx} (${this.state.players.length}/${maxAllowed} players).`);
    return success(newPlayer);
  }

  /**
   * Hot-swaps an existing seat to a Human user.
   */
  public claimSeatForHuman(playerIndex: number,
                           humanName: string): Result<UnoPlayerState, string> {
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
                          fallbackBotName: string = 'Cardinal Guardian Bot'): Result<UnoPlayerState, string> {
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

  public getCurrentPlayer(): UnoPlayerState {
    return this.state.players[this.state.currentTurnIndex]!;
  }

  public getTopDiscard(): UnoCard {
    return this.state.discardPile[this.state.discardPile.length - 1]!;
  }

  public canPlayCard(card: UnoCard): boolean {
    const top = this.getTopDiscard();
    if (card.color === 'wild') return true;
    if (card.color === this.state.activeColor) return true;
    if (card.type === 'number' && top.type === 'number' && card.value === top.value) return true;
    if (card.type !== 'number' && card.type === top.type) return true;
    return false;
  }

  public playCard(handIndex: number,
                  chosenWildColor?: UnoColor): Result<string, string> {
    if (this.state.isGameOver) return failure('Match has concluded.');
    const player = this.getCurrentPlayer();

    if (handIndex < 0 || handIndex >= player.hand.length) {
      return failure('Invalid hand index.');
    }

    const card = player.hand[handIndex]!;
    if (!this.canPlayCard(card)) {
      return failure(`Cannot play ${card.color} ${card.type} on ${this.state.activeColor}.`);
    }

    // Remove from hand and push to discard
    player.hand.splice(handIndex, 1);
    this.state.discardPile.push(card);

    let resolvedColor: UnoColor = card.color;
    if (card.color === 'wild') {
      resolvedColor = chosenWildColor && chosenWildColor !== 'wild' ? chosenWildColor : 'red';
    }
    this.state.activeColor = resolvedColor;

    // Check Victory
    if (player.hand.length === 0) {
      this.state.isGameOver = true;
      this.state.winner = some(player.id);
      const winMsg = `${player.name} played their final card and achieved Cardinal Victory!`;
      this.state.historyText.push(winMsg);
      logger.info(`[SERVER_SIDE] [UNO_TRACE] ${winMsg}`);
      return success(winMsg);
    }

    // Handle special action cards
    let skipNext = false;
    let cardsToDrawNext = 0;

    if (card.type === 'reverse') {
      if (this.state.players.length === 2) {
        skipNext = true; // In 2-player rules, reverse acts as skip
      } else {
        this.state.direction = (this.state.direction === 1 ? -1 : 1);
      }
      this.state.historyText.push(`${player.name} played Reverse! Play direction inverted.`);
    } else if (card.type === 'skip') {
      skipNext = true;
      this.state.historyText.push(`${player.name} played Skip! Next player skipped.`);
    } else if (card.type === 'draw2') {
      cardsToDrawNext = 2;
      skipNext = true;
      this.state.historyText.push(`${player.name} played Draw Two! Next player draws 2 and is skipped.`);
    } else if (card.type === 'wild4') {
      cardsToDrawNext = 4;
      skipNext = true;
      this.state.historyText.push(`${player.name} played Wild Draw 4! Color set to ${resolvedColor}.`);
    }

    this.advanceTurn(skipNext, cardsToDrawNext);
    return success(`Played ${card.type}.`);
  }

  public drawCard(): Result<UnoCard, string> {
    if (this.state.isGameOver) return failure('Match has concluded.');
    const player = this.getCurrentPlayer();

    this.checkRecycleDeck();
    if (this.state.drawPile.length === 0) {
      return failure('Draw deck empty.');
    }

    const card = this.state.drawPile.pop()!;
    player.hand.push(card);
    this.state.historyText.push(`${player.name} drew a card.`);

    // If card cannot be played or turn passes
    this.advanceTurn(false, 0);
    return success(card);
  }

  public callUno(playerId: string): Result<string, string> {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player) return failure('Player not found.');
    player.calledUno = true;
    const msg = `${player.name} declared CARDINAL UNO!`;
    this.state.historyText.push(msg);
    return success(msg);
  }

  public executeAiTurn(): Result<string, string> {
    if (this.state.isGameOver) return failure('Match has concluded.');
    const bot = this.getCurrentPlayer();
    const playableIdx = bot.hand.findIndex(c => this.canPlayCard(c));
    if (playableIdx >= 0) {
      return this.playCard(playableIdx, 'red');
    }
    const drawRes = this.drawCard();
    return drawRes.match({
      Ok: () => success('Bot drew a card.'),
      Err: err => failure(err)
    });
  }

  private checkRecycleDeck(): void {
    if (this.state.drawPile.length === 0 && this.state.discardPile.length > 1) {
      const top = this.state.discardPile.pop()!;
      this.state.drawPile = [...this.state.discardPile];
      this.state.discardPile = [top];

      for (let i = this.state.drawPile.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = this.state.drawPile[i]!;
        this.state.drawPile[i] = this.state.drawPile[j]!;
        this.state.drawPile[j] = temp;
      }
    }
  }

  private advanceTurn(skipNext: boolean,
                      cardsToDraw: number): void {
    const total = this.state.players.length;
    let nextIdx = (this.state.currentTurnIndex + this.state.direction + total) % total;

    if (cardsToDraw > 0) {
      const victim = this.state.players[nextIdx]!;
      for (let i = 0; i < cardsToDraw; i++) {
        this.checkRecycleDeck();
        if (this.state.drawPile.length > 0) {
          victim.hand.push(this.state.drawPile.pop()!);
        }
      }
    }

    if (skipNext) {
      nextIdx = (nextIdx + this.state.direction + total) % total;
    }

    this.state.currentTurnIndex = nextIdx;
  }
}
