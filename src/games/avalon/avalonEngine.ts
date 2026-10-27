import {
  Option,
  some,
  none,
  Result,
  success,
  failure
} from '../../utils/fp';
import { ArcadeGameEnum, REAL_LIFE_GAME_CAPACITIES } from '../../constants/gameEnums';
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

  constructor(leaderName: string = 'Human Knight',
              playerCount: number = 5) {
    const minAllowed = REAL_LIFE_GAME_CAPACITIES[ArcadeGameEnum.Avalon].minPlayers;
    const maxAllowed = REAL_LIFE_GAME_CAPACITIES[ArcadeGameEnum.Avalon].maxPlayers;
    const totalPlayers = Math.max(minAllowed, Math.min(maxAllowed, playerCount));

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

    // Alignments distribution:
    // 5 players: 3 Good, 2 Evil
    // 6 players: 4 Good, 2 Evil
    // 7 players: 4 Good, 3 Evil
    // 8 players: 5 Good, 3 Evil
    // 9 players: 6 Good, 3 Evil
    // 10 players: 6 Good, 4 Evil
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
      playersList.push({
        id: `p${i + 1}`,
        name: pName,
        isBot: i > 0,
        role: r.role,
        alignment: r.alignment
      });
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
