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

export type AvalonRole =
  | 'Merlin'
  | 'Percival'
  | 'Loyal Servant'
  | 'Mordred'
  | 'Morgana'
  | 'Assassin'
  | 'Minion of Mordred'
  | 'Oberon';

export type AvalonAlignment = 'good' | 'evil';

export interface AvalonPlayer {
  id: string;
  name: string;
  isBot: boolean;
  role: AvalonRole;
  alignment: AvalonAlignment;
}

export type AvalonStage =
  | 'team-building'
  | 'voting'
  | 'quest-execution'
  | 'assassination'
  | 'settled';

export interface AvalonQuest {
  questNumber: number;
  teamSize: number;
  twoFailsRequired: boolean;
  proposedTeam: string[]; // player IDs
  votes: Record<string, boolean>; // player ID -> approve/reject
  questCards: boolean[]; // true = success, false = fail
  outcome: Option<'success' | 'fail'>;
}

export interface AvalonGameState {
  players: AvalonPlayer[];
  currentLeaderIndex: number;
  currentQuestIndex: number;
  failedVoteCount: number; // 5 failed votes = evil wins
  quests: AvalonQuest[];
  stage: AvalonStage;
  winner: Option<AvalonAlignment>;
  historyText: string[];
}

export const QUEST_SIZES_BY_PLAYERS: Record<number, number[]> = {
  5: [2, 3, 2, 3, 3],
  6: [2, 3, 4, 3, 4],
  7: [2, 3, 3, 4, 4], // Quest 4 requires 2 fails
  8: [3, 4, 4, 5, 5], // Quest 4 requires 2 fails
  9: [3, 4, 4, 5, 5], // Quest 4 requires 2 fails
  10: [3, 4, 4, 5, 5] // Quest 4 requires 2 fails
};

export class AvalonEngine {
  public state: AvalonGameState;
  public readonly seatManager: TableSeatManager<AvalonPlayer>;

  constructor(leaderName: string = 'Human Knight',
              playerCount: number = 5) {
    const minAllowed = REAL_LIFE_GAME_CAPACITIES[ArcadeGameEnum.Avalon].minPlayers;
    const maxAllowed = REAL_LIFE_GAME_CAPACITIES[ArcadeGameEnum.Avalon].maxPlayers;
    const totalPlayers = Math.max(minAllowed, Math.min(maxAllowed, playerCount));
    this.seatManager = new TableSeatManager<AvalonPlayer>(maxAllowed, minAllowed, AIModelEnum.MicroNeural);

    const botNames = [
      'Galahad Bot',
      'Bedivere Bot',
      'Kay Bot',
      'Tristan Bot',
      'Gawain Bot',
      'Lancelot Bot',
      'Lamorak Bot',
      'Bors Bot',
      'Palamedes Bot'
    ];

    const evilCount = totalPlayers <= 6 ? 2 : totalPlayers <= 9 ? 3 : 4;
    const goodCount = totalPlayers - evilCount;

    const rolesPool: { role: AvalonRole; alignment: AvalonAlignment }[] = [
      { role: 'Merlin', alignment: 'good' },
      { role: 'Percival', alignment: 'good' },
      ...Array(goodCount - 2).fill({ role: 'Loyal Servant' as AvalonRole, alignment: 'good' as AvalonAlignment }),
      { role: 'Assassin', alignment: 'evil' },
      { role: 'Morgana', alignment: 'evil' },
      ...Array(evilCount - 2).fill({ role: 'Minion of Mordred' as AvalonRole, alignment: 'evil' as AvalonAlignment })
    ];

    // Shuffle roles
    for (let i = rolesPool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = rolesPool[i]!;
      rolesPool[i] = rolesPool[j]!;
      rolesPool[j] = temp;
    }

    const playersList: AvalonPlayer[] = [];
    for (let i = 0; i < totalPlayers; i++) {
      const pName = i === 0 ? leaderName : botNames[i - 1] || `Knight #${i + 1}`;
      const r = rolesPool[i]!;
      const pState: AvalonPlayer = {
        id: `p${i + 1}`,
        name: pName,
        isBot: i > 0,
        role: r.role,
        alignment: r.alignment
      };
      playersList.push(pState);
      if (i === 0) {
        this.seatManager.claimSeat(1, pState.id, pState.name, pState);
      } else {
        this.seatManager.updateSeatData(i + 1, () => pState);
      }
    }

    const questSizes = QUEST_SIZES_BY_PLAYERS[totalPlayers] || [2, 3, 2, 3, 3];
    const quests: AvalonQuest[] = questSizes.map((size, idx) => ({
      questNumber: idx + 1,
      teamSize: size,
      twoFailsRequired: totalPlayers >= 7 && idx === 3,
      proposedTeam: [],
      votes: {},
      questCards: [],
      outcome: none()
    }));

    this.state = {
      players: playersList,
      currentLeaderIndex: 0,
      currentQuestIndex: 0,
      failedVoteCount: 0,
      quests,
      stage: 'team-building',
      winner: none(),
      historyText: [`The Resistance: Avalon commenced with ${totalPlayers} players (${goodCount} Good, ${evilCount} Evil).`]
    };
  }

  /**
   * Dynamically adds a new player (human or AI bot) up to 10 players and updates quest team sizes.
   */
  public addPlayer(playerName: string,
                   isBot: boolean = false): Result<AvalonPlayer, string> {
    const maxAllowed = REAL_LIFE_GAME_CAPACITIES[ArcadeGameEnum.Avalon].maxPlayers;
    if (this.state.players.length >= maxAllowed) {
      return failure(`Avalon council is at maximum capacity (${maxAllowed} players).`);
    }

    const seatIdx = this.state.players.length + 1;
    const targetEvilCount = seatIdx <= 6 ? 2 : seatIdx <= 9 ? 3 : 4;
    const currentEvilCount = this.state.players.filter(p => p.alignment === 'evil').length;
    const isEvil = currentEvilCount < targetEvilCount;

    const newPlayer: AvalonPlayer = {
      id: `p${seatIdx}`,
      name: playerName,
      isBot,
      role: isEvil ? 'Minion of Mordred' : 'Loyal Servant',
      alignment: isEvil ? 'evil' : 'good'
    };

    this.state.players.push(newPlayer);
    if (!isBot) {
      this.seatManager.claimSeat(seatIdx, newPlayer.id, newPlayer.name, newPlayer);
    } else {
      this.seatManager.updateSeatData(seatIdx, () => newPlayer);
    }

    const questSizes = QUEST_SIZES_BY_PLAYERS[this.state.players.length] || [2, 3, 2, 3, 3];
    this.state.quests.forEach((q, idx) => {
      if (q.outcome.isNone()) {
        q.teamSize = questSizes[idx] || q.teamSize;
        q.twoFailsRequired = this.state.players.length >= 7 && idx === 3;
      }
    });

    this.state.historyText.push(`${playerName} (${isBot ? 'Bot Knight' : 'Human Knight'}) joined Seat #${seatIdx} (${this.state.players.length}/${maxAllowed} knights).`);
    return success(newPlayer);
  }

  /**
   * Hot-swaps an existing seat to a Human user.
   */
  public claimSeatForHuman(playerIndex: number,
                           humanName: string): Result<AvalonPlayer, string> {
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
                          fallbackBotName: string = 'Arthurian Bot'): Result<AvalonPlayer, string> {
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

  public getCurrentLeader(): AvalonPlayer {
    return this.state.players[this.state.currentLeaderIndex]!;
  }

  public getCurrentQuest(): AvalonQuest {
    return this.state.quests[this.state.currentQuestIndex]!;
  }

  public proposeTeam(playerIds: string[]): Result<string, string> {
    if (this.state.stage !== 'team-building') return failure('Not currently in team building stage.');
    const quest = this.getCurrentQuest();
    if (playerIds.length !== quest.teamSize) {
      return failure(`Quest ${quest.questNumber} requires exactly ${quest.teamSize} knights.`);
    }

    quest.proposedTeam = [...playerIds];
    quest.votes = {};
    this.state.stage = 'voting';
    const leader = this.getCurrentLeader();
    const msg = `${leader.name} proposed knights for Quest ${quest.questNumber}: ${playerIds.join(', ')}.`;
    this.state.historyText.push(msg);
    return success(msg);
  }

  public castVote(playerId: string,
                  approve: boolean): Result<string, string> {
    if (this.state.stage !== 'voting') return failure('Not in voting stage.');
    const quest = this.getCurrentQuest();
    quest.votes[playerId] = approve;

    // Check if all players have voted
    if (Object.keys(quest.votes).length === this.state.players.length) {
      const approves = Object.values(quest.votes).filter(v => v).length;
      const rejects = this.state.players.length - approves;

      if (approves > rejects) {
        // Vote Passed
        this.state.failedVoteCount = 0;
        this.state.stage = 'quest-execution';
        this.state.historyText.push(`Team approved (${approves} to ${rejects})! Knights embark on Quest ${quest.questNumber}.`);
      } else {
        // Vote Failed
        this.state.failedVoteCount += 1;
        this.state.historyText.push(`Team rejected (${approves} to ${rejects}). Failed proposals: ${this.state.failedVoteCount}/5.`);

        if (this.state.failedVoteCount >= 5) {
          this.state.stage = 'settled';
          this.state.winner = some('evil');
          const winMsg = 'Five consecutive team proposals rejected. The Minions of Mordred claim victory!';
          this.state.historyText.push(winMsg);
          return success(winMsg);
        }

        // Advance leader and return to team building
        this.advanceLeader();
        this.state.stage = 'team-building';
      }
    }

    return success('Vote recorded.');
  }

  public castQuestCard(playerId: string,
                       successCard: boolean): Result<string, string> {
    if (this.state.stage !== 'quest-execution') return failure('Not in quest execution stage.');
    const quest = this.getCurrentQuest();
    if (!quest.proposedTeam.includes(playerId)) {
      return failure('Only knights selected for the quest may cast quest cards.');
    }

    const player = this.state.players.find(p => p.id === playerId);
    if (player && player.alignment === 'good' && !successCard) {
      return failure('Good players must always cast Success.');
    }

    quest.questCards.push(successCard);

    if (quest.questCards.length === quest.teamSize) {
      const fails = quest.questCards.filter(c => !c).length;
      const neededFails = quest.twoFailsRequired ? 2 : 1;
      const questPassed = fails < neededFails;

      quest.outcome = some(questPassed ? 'success' : 'fail');
      this.state.historyText.push(
        `Quest ${quest.questNumber} ${questPassed ? 'SUCCEEDED' : 'FAILED'} with ${fails} fail card(s)!`
      );

      // Check win condition
      const passedCount = this.state.quests.filter(q => q.outcome.match({ Some: o => o === 'success', None: () => false })).length;
      const failedCount = this.state.quests.filter(q => q.outcome.match({ Some: o => o === 'fail', None: () => false })).length;

      if (passedCount >= 3) {
        this.state.stage = 'assassination';
        this.state.historyText.push('Good completed 3 Quests! The Assassin enters for the final strike on Merlin.');
      } else if (failedCount >= 3) {
        this.state.stage = 'settled';
        this.state.winner = some('evil');
        this.state.historyText.push('Evil thwarted 3 Quests! The Minions of Mordred rule the Sanctuary.');
      } else {
        this.state.currentQuestIndex += 1;
        this.advanceLeader();
        this.state.stage = 'team-building';
      }
    }

    return success('Quest card processed.');
  }

  public assassinateMerlin(assassinTargetId: string): Result<string, string> {
    if (this.state.stage !== 'assassination') return failure('Not in assassination stage.');
    const target = this.state.players.find(p => p.id === assassinTargetId);
    if (!target) return failure('Target not found.');

    this.state.stage = 'settled';
    if (target.role === 'Merlin') {
      this.state.winner = some('evil');
      const msg = `The Assassin struck down Merlin (${target.name})! Evil steals victory from the jaws of defeat!`;
      this.state.historyText.push(msg);
      logger.info(`[SERVER_SIDE] [RES_TRACE] ${msg}`);
      return success(msg);
    } else {
      this.state.winner = some('good');
      const msg = `The Assassin targeted ${target.name} (${target.role}), who was NOT Merlin! Loyal Servants of Arthur triumph!`;
      this.state.historyText.push(msg);
      logger.info(`[SERVER_SIDE] [RES_TRACE] ${msg}`);
      return success(msg);
    }
  }

  private advanceLeader(): void {
    this.state.currentLeaderIndex = (this.state.currentLeaderIndex + 1) % this.state.players.length;
  }
}
