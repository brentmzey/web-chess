import {
  fromNullable,
  none,
  Option,
  Result,
  some,
  failure,
  success
} from '../../utils/fp';
import {
  ArcadeGameEnum,
  REAL_LIFE_GAME_CAPACITIES,
  SET_COLORS,
  SET_COUNTS,
  SET_SHADINGS,
  SET_SHAPES,
  SetColorEnum,
  SetCountEnum,
  SetShadingEnum,
  SetShapeEnum
} from '../../constants/gameEnums';
import { logger } from '../../utils/logger';

/**
 * 4-tuple coordinate in GF(3)^4: each coordinate is in {0, 1, 2}.
 */
export type GF3Vector4 = readonly [number, number, number, number];

export interface SetCard {
  id: string;
  count: SetCountEnum;
  shape: SetShapeEnum;
  shading: SetShadingEnum;
  color: SetColorEnum;
  vector: GF3Vector4;
}

export interface SetPlayerState {
  id: string;
  name: string;
  isBot: boolean;
  score: number;
  setsFound: number;
  penalties: number;
}

export interface SetGameState {
  players: SetPlayerState[];
  deck: SetCard[];
  tableCards: SetCard[];
  claimedSetsCount: number;
  lastClaimedSet: Option< readonly [SetCard, SetCard, SetCard] >;
  isGameOver: boolean;
  winner: Option<string>;
  historyText: string[];
}

/**
 * Generates the complete canonical 81-card SET deck isomorphic to AG(4, 3) = GF(3)^4.
 */
export function createSetDeck(): SetCard[] {
  const deck: SetCard[] = [];

  SET_COUNTS.forEach((count, cIdx) => {
    SET_SHAPES.forEach((shape, shIdx) => {
      SET_SHADINGS.forEach((shading, sdIdx) => {
        SET_COLORS.forEach((color, clIdx) => {
          const vector: GF3Vector4 = [cIdx, shIdx, sdIdx, clIdx];
          deck.push({
            id: `set-${count}-${shape}-${shading}-${color}`,
            count,
            shape,
            shading,
            color,
            vector
          });
        });
      });
    });
  });

  return deck;
}

/**
 * Fisher-Yates shuffle returning a new array.
 */
export function shuffleSetCards(cards: readonly SetCard[]): SetCard[] {
  const copy = [...cards];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = temp;
  }
  return copy;
}

/**
 * Determines whether 3 cards form a valid SET in GF(3)^4:
 * three vectors a, b, c form a line in AG(4, 3) iff (a_i + b_i + c_i) mod 3 === 0 for all i in {0, 1, 2, 3}.
 */
export function isValidSet(cardA: SetCard,
                           cardB: SetCard,
                           cardC: SetCard): boolean {
  if (cardA.id === cardB.id || cardB.id === cardC.id || cardA.id === cardC.id) {
    return false;
  }
  for (let i = 0; i < 4; i++) {
    const sumMod3 = (cardA.vector[i]! + cardB.vector[i]! + cardC.vector[i]!) % 3;
    if (sumMod3 !== 0) {
      return false;
    }
  }
  return true;
}

/**
 * Given any two distinct cards in GF(3)^4, computes the unique third card vector
 * c = (6 - a - b) mod 3 that completes the SET.
 */
export function computeCompletingCardVector(cardA: SetCard,
                                            cardB: SetCard): GF3Vector4 {
  return [
    (6 - cardA.vector[0] - cardB.vector[0]) % 3,
    (6 - cardA.vector[1] - cardB.vector[1]) % 3,
    (6 - cardA.vector[2] - cardB.vector[2]) % 3,
    (6 - cardA.vector[3] - cardB.vector[3]) % 3
  ];
}

/**
 * Explains why 3 cards do not form a valid SET, or returns None if they are a valid SET.
 */
export function explainSetFailure(cardA: SetCard,
                                  cardB: SetCard,
                                  cardC: SetCard): Option<string> {
  if (cardA.id === cardB.id || cardB.id === cardC.id || cardA.id === cardC.id) {
    return some('A SET must consist of 3 distinct cards.');
  }

  const featureNames = ['Count', 'Shape', 'Shading', 'Color'] as const;
  const failedFeatures: string[] = [];

  for (let i = 0; i < 4; i++) {
    const sumMod3 = (cardA.vector[i]! + cardB.vector[i]! + cardC.vector[i]!) % 3;
    if (sumMod3 !== 0) {
      failedFeatures.push(featureNames[i]!);
    }
  }

  if (failedFeatures.length === 0) {
    return none();
  }

  return some(
    `Invalid SET: ${failedFeatures.join(', ')} must be either all the same or all different across the 3 cards.`
  );
}

/**
 * Finds all valid 3-card SET index triples [i, j, k] currently present on the table.
 */
export function findAllSetsOnTable(tableCards: readonly SetCard[]): Array<readonly [number, number, number]> {
  const triples: Array<readonly [number, number, number]> = [];
  const n = tableCards.length;

  for (let i = 0; i < n - 2; i++) {
    for (let j = i + 1; j < n - 1; j++) {
      for (let k = j + 1; k < n; k++) {
        if (isValidSet(tableCards[i]!, tableCards[j]!, tableCards[k]!)) {
          triples.push([i, j, k]);
        }
      }
    }
  }

  return triples;
}

export class SetEngine {
  public state: SetGameState;

  constructor(playerCount: number = 2,
              humanName: string = 'Geometer Pilgrim') {
    const cap = REAL_LIFE_GAME_CAPACITIES[ArcadeGameEnum.Set];
    const totalPlayers = Math.max(cap.minPlayers, Math.min(cap.maxPlayers, playerCount));
    const fullDeck = shuffleSetCards(createSetDeck());

    const initialTable = fullDeck.splice(0, 12);
    const botNames = [
      'Brother Euclid',
      'Sister Hypatia',
      'Abbot Galois',
      'Prior Fano',
      'Scribe Emmy',
      'Canon Euler'
    ];

    const players: SetPlayerState[] = [];
    for (let i = 0; i < totalPlayers; i++) {
      players.push({
        id: `p${i + 1}`,
        name: i === 0 ? humanName : botNames[(i - 1) % botNames.length]!,
        isBot: i > 0,
        score: 0,
        setsFound: 0,
        penalties: 0
      });
    }

    this.state = {
      players,
      deck: fullDeck,
      tableCards: initialTable,
      claimedSetsCount: 0,
      lastClaimedSet: none(),
      isGameOver: false,
      winner: none(),
      historyText: [
        `Sacred Geometry SET initiated with ${totalPlayers} players. 12 cards dealt on table (${fullDeck.length} remaining in deck).`
      ]
    };
  }

  /**
   * Returns all valid SET index triples currently on the table.
   */
  public getAvailableSets(): Array<readonly [number, number, number]> {
    return findAllSetsOnTable(this.state.tableCards);
  }

  /**
   * Returns a single hint index (the first card of an available SET) if one exists.
   */
  public getHintCardIndex(): Option<number> {
    const sets = this.getAvailableSets();
    return fromNullable(sets[0]).map(triple => triple[0]);
  }

  /**
   * Claims a 3-card SET for the specified player.
   */
  public claimSet(playerId: string,
                  indices: readonly [number, number, number]): Result<string, string> {
    if (this.state.isGameOver) {
      return failure('Match has already concluded.');
    }

    const playerOpt = fromNullable(this.state.players.find(p => p.id === playerId));
    if (!playerOpt.isSome()) {
      return failure(`Player '${playerId}' not found at table.`);
    }
    const player = playerOpt.getOrThrow();

    const [i0, i1, i2] = indices;
    if (
      i0 === i1 ||
      i1 === i2 ||
      i0 === i2 ||
      i0 < 0 ||
      i1 < 0 ||
      i2 < 0 ||
      i0 >= this.state.tableCards.length ||
      i1 >= this.state.tableCards.length ||
      i2 >= this.state.tableCards.length
    ) {
      return failure('Must select 3 distinct valid card positions on the table.');
    }

    const cardA = this.state.tableCards[i0]!;
    const cardB = this.state.tableCards[i1]!;
    const cardC = this.state.tableCards[i2]!;

    const failureReasonOpt = explainSetFailure(cardA, cardB, cardC);
    if (failureReasonOpt.isSome()) {
      const reason = failureReasonOpt.getOrThrow();
      player.score = Math.max(0, player.score - 1);
      player.penalties += 1;
      const penMsg = `${player.name} called a false SET (-1 penalty): ${reason}`;
      this.state.historyText.push(penMsg);
      logger.info(`[SERVER_SIDE] [SET_TRACE] ${penMsg}`);
      return failure(reason);
    }

    // Valid SET! Remove cards in descending index order so indices don't shift
    const sortedDesc = [...indices].sort((a, b) => b - a);
    for (const idx of sortedDesc) {
      this.state.tableCards.splice(idx, 1);
    }

    player.score += 1;
    player.setsFound += 1;
    this.state.claimedSetsCount += 1;
    this.state.lastClaimedSet = some([cardA, cardB, cardC]);

    // Replenish to 12 cards if table dropped below 12 and deck has cards
    if (this.state.tableCards.length < 12 && this.state.deck.length > 0) {
      const needed = Math.min(12 - this.state.tableCards.length, this.state.deck.length);
      const dealt = this.state.deck.splice(0, needed);
      this.state.tableCards.push(...dealt);
    }

    const msg = `${player.name} claimed SET #${this.state.claimedSetsCount}! (${this.state.deck.length} cards left in deck)`;
    this.state.historyText.push(msg);
    logger.info(`[SERVER_SIDE] [SET_TRACE] ${msg}`);

    this.checkEndOfGame();
    return success(msg);
  }

  /**
   * Deals 3 additional cards to the table when no SET is present (or players agree).
   * Note: By the Cap Set Theorem in AG(4, 3), 21 cards is guaranteed to contain a SET.
   */
  public dealThreeMoreCards(): Result<string, string> {
    if (this.state.isGameOver) {
      return failure('Match has already concluded.');
    }
    if (this.state.deck.length === 0) {
      this.checkEndOfGame();
      return failure('No cards remaining in the draw deck.');
    }
    if (this.state.tableCards.length >= 21) {
      return failure('Maximum table cap of 21 cards reached (a SET is mathematically guaranteed to exist!).');
    }

    const dealt = this.state.deck.splice(0, Math.min(3, this.state.deck.length));
    this.state.tableCards.push(...dealt);
    const msg = `Dealt ${dealt.length} additional cards to the table (${this.state.tableCards.length} on table, ${this.state.deck.length} in deck).`;
    this.state.historyText.push(msg);
    logger.info(`[SERVER_SIDE] [SET_TRACE] ${msg}`);

    this.checkEndOfGame();
    return success(msg);
  }

  /**
   * Executes an AI Bot scan & action: claims a SET if available, or deals 3 more cards if deadlocked.
   */
  public executeAiTurn(botId?: string): Result<string, string> {
    if (this.state.isGameOver) {
      return failure('Match has already concluded.');
    }

    const targetBot = fromNullable(
      botId
        ? this.state.players.find(p => p.id === botId)
        : this.state.players.find(p => p.isBot)
    ).getOrElse(this.state.players[this.state.players.length - 1]!);

    const sets = this.getAvailableSets();
    if (sets.length > 0) {
      const chosenTriple = sets[0]!;
      return this.claimSet(targetBot.id, chosenTriple);
    }

    if (this.state.deck.length > 0) {
      return this.dealThreeMoreCards();
    }

    this.checkEndOfGame();
    return failure('No remaining SETs on table and deck is empty.');
  }

  private checkEndOfGame(): void {
    if (this.state.deck.length === 0 && this.getAvailableSets().length === 0) {
      this.state.isGameOver = true;
      const sorted = [...this.state.players].sort((a, b) => b.score - a.score);
      const topPlayer = sorted[0]!;
      this.state.winner = some(topPlayer.id);
      const winMsg = `Game Over! All SETs exhausted. ${topPlayer.name} triumphs with ${topPlayer.score} points (${topPlayer.setsFound} SETs)!`;
      this.state.historyText.push(winMsg);
      logger.info(`[SERVER_SIDE] [SET_TRACE] ${winMsg}`);
    }
  }
}
