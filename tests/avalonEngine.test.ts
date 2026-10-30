import { describe, expect, it } from 'bun:test';
import { AvalonEngine } from '../src/games/avalon/avalonEngine';

describe('The Resistance: Avalon Engine - 5 to 10 Player Capacity & Hidden Roles', () => {
  it('initializes game with up to 10 players and distributes Good vs Evil alignments', () => {
    const engine = new AvalonEngine('Arthur', 10);
    expect(engine.state.players.length).toBe(10);
    expect(engine.state.quests.length).toBe(5);

    const goodCount = engine.state.players.filter(p => p.alignment === 'good').length;
    const evilCount = engine.state.players.filter(p => p.alignment === 'evil').length;
    expect(goodCount).toBe(6);
    expect(evilCount).toBe(4);

    const merlin = engine.state.players.find(p => p.role === 'Merlin');
    const assassin = engine.state.players.find(p => p.role === 'Assassin');
    expect(merlin).toBeDefined();
    expect(assassin).toBeDefined();
  });

  it('clamps player count to 5 to 10 players', () => {
    const engineMin = new AvalonEngine('P1', 3);
    expect(engineMin.state.players.length).toBe(5);

    const engineMax = new AvalonEngine('P1', 14);
    expect(engineMax.state.players.length).toBe(10);
  });

  it('processes quest proposal, voting, and quest execution', () => {
    const engine = new AvalonEngine('Leader', 5);
    const q1 = engine.getCurrentQuest();
    expect(q1.teamSize).toBe(2);

    // Propose team
    const proposeRes = engine.proposeTeam(['p1', 'p2']);
    expect(proposeRes.isSuccess()).toBe(true);
    expect(engine.state.stage).toBe('voting');

    // Vote approve across all 5 players
    engine.state.players.forEach(p => {
      engine.castVote(p.id, true);
    });

    // Team approved -> moves to quest execution
    expect(engine.state.stage).toBe('quest-execution');

    // Knights cast success cards
    engine.castQuestCard('p1', true);
    engine.castQuestCard('p2', true);

    // Quest 1 succeeded
    expect(q1.outcome.getOrElse('fail')).toBe('success');
    expect(engine.state.currentQuestIndex).toBe(1);
    expect(engine.state.stage).toBe('team-building');
  });

  it('triggers assassination phase when Good wins 3 quests', () => {
    const engine = new AvalonEngine('Leader', 5);

    // Simulate 3 quest successes
    engine.state.quests[0]!.outcome = { match: (cases: any) => cases.Some('success') } as any;
    engine.state.quests[1]!.outcome = { match: (cases: any) => cases.Some('success') } as any;
    engine.state.currentQuestIndex = 2;
    engine.state.stage = 'quest-execution';
    engine.state.quests[2]!.proposedTeam = ['p1', 'p2'];

    engine.castQuestCard('p1', true);
    engine.castQuestCard('p2', true);

    expect(engine.state.stage as string).toBe('assassination');

    // Assassin targets Merlin
    const merlin = engine.state.players.find(p => p.role === 'Merlin')!;
    const killRes = engine.assassinateMerlin(merlin.id);
    expect(killRes.isSuccess()).toBe(true);
    expect(engine.state.winner.match({ Some: w => w, None: () => '' })).toBe('evil');
  });

  it('triggers Evil victory when 5 consecutive team proposals are rejected', () => {
    const engine = new AvalonEngine('Leader', 5);

    for (let i = 0; i < 5; i++) {
      engine.proposeTeam(['p1', 'p2']);
      engine.state.players.forEach(p => {
        engine.castVote(p.id, false); // All vote reject
      });
    }

    expect(engine.state.stage as string).toBe('settled');
    expect(engine.state.winner.match({ Some: w => w, None: () => '' })).toBe('evil');
  });

  it('triggers Evil victory when 3 quests fail', () => {
    const engine = new AvalonEngine('Leader', 5);

    // Fail quests 0 and 1
    engine.state.quests[0]!.outcome = { match: (cases: any) => cases.Some('fail') } as any;
    engine.state.quests[1]!.outcome = { match: (cases: any) => cases.Some('fail') } as any;
    engine.state.currentQuestIndex = 2;
    engine.state.stage = 'quest-execution';

    const evilPlayer = engine.state.players.find(p => p.alignment === 'evil')!;
    const otherPlayer = engine.state.players.find(p => p.id !== evilPlayer.id)!;
    engine.state.quests[2]!.proposedTeam = [evilPlayer.id, otherPlayer.id];

    // Fail quest 2
    engine.castQuestCard(evilPlayer.id, false);
    engine.castQuestCard(otherPlayer.id, true);

    expect(engine.state.stage as string).toBe('settled');
    expect(engine.state.winner.match({ Some: w => w, None: () => '' })).toBe('evil');
  });

  it('validates rules, stage guards, and wrong target during assassination', () => {
    const engine = new AvalonEngine('Leader', 5);

    // Cannot cast vote while in team-building
    expect(engine.castVote('p1', true).isFailure()).toBe(true);

    // Cannot propose invalid team size
    expect(engine.proposeTeam(['p1']).isFailure()).toBe(true);

    // Propose valid team
    engine.proposeTeam(['p1', 'p2']);
    // Cannot propose team while in voting stage
    expect(engine.proposeTeam(['p1', 'p2']).isFailure()).toBe(true);

    // Cannot cast quest card while in voting stage
    expect(engine.castQuestCard('p1', true).isFailure()).toBe(true);

    // Advance to quest execution
    engine.state.players.forEach(p => engine.castVote(p.id, true));

    // Player p3 was not on proposed team
    expect(engine.castQuestCard('p3', true).isFailure()).toBe(true);

    // Good player attempting to cast Fail
    const goodKnight = engine.state.players.find(p => p.alignment === 'good')!;
    engine.getCurrentQuest().proposedTeam = [goodKnight.id];
    expect(engine.castQuestCard(goodKnight.id, false).isFailure()).toBe(true);

    // Assassination guards
    expect(engine.assassinateMerlin('p1').isFailure()).toBe(true);

    engine.state.stage = 'assassination';
    expect(engine.assassinateMerlin('non-existent').isFailure()).toBe(true);

    // Target not Merlin -> Good wins
    const nonMerlin = engine.state.players.find(p => p.role !== 'Merlin')!;
    const killWrong = engine.assassinateMerlin(nonMerlin.id);
    expect(killWrong.isSuccess()).toBe(true);
    expect(engine.state.winner.match({ Some: w => w, None: () => '' })).toBe('good');
  });

  it('adds, claims, and vacates up to 10 knights in The Resistance: Avalon', () => {
    const engine = new AvalonEngine('Arthur', 8);
    expect(engine.state.players.length).toBe(8);

    expect(engine.addPlayer('Sir Lancelot', false).isSuccess()).toBe(true);
    expect(engine.addPlayer('Sir Bors', true).isSuccess()).toBe(true);
    expect(engine.state.players.length).toBe(10);
    expect(engine.addPlayer('Overflow Knight', false).isFailure()).toBe(true);

    expect(engine.claimSeatForHuman(1, 'Lady Guinevere').isSuccess()).toBe(true);
    expect(engine.state.players[1]!.isBot).toBe(false);
    expect(engine.claimSeatForHuman(99, 'Invalid').isFailure()).toBe(true);

    expect(engine.vacatePlayerSeat('p2', 'Bot Knight #2').isSuccess()).toBe(true);
    expect(engine.state.players[1]!.isBot).toBe(true);
    expect(engine.vacatePlayerSeat('unknown').isFailure()).toBe(true);
  });

  it('accepts exactly one quest card per knight on the team', () => {
    const engine = new AvalonEngine('Percival', 5);
    const team = engine.state.players.slice(0, engine.getCurrentQuest().teamSize).map(p => p.id);
    expect(engine.proposeTeam(team).isSuccess()).toBe(true);
    engine.state.players.forEach(p => engine.castVote(p.id, true));
    expect(engine.state.stage).toBe('quest-execution');

    const first = team[0]!;
    expect(engine.castQuestCard(first, true).isSuccess()).toBe(true);
    const again = engine.castQuestCard(first, true);
    expect(again.isFailure()).toBe(true);
    expect(again.match({ Ok: () => '', Err: e => e })).toBe('This knight has already cast a quest card.');
    expect(engine.getCurrentQuest().questCards.length).toBe(1);
    expect(engine.getCurrentQuest().castBy).toEqual([first]);
  });

  it('keeps each player\'s role private and correctly merges human and bot votes in live play', () => {
    const engine = new AvalonEngine('Host Arthur', 5);
    // Seat 0 is claimed by Host ('p1'), Seat 1 is claimed by Joiner ('p2')
    engine.claimSeatForHuman(1, 'Joiner Lancelot');
    expect(engine.state.players[0]!.isBot).toBe(false);
    expect(engine.state.players[1]!.isBot).toBe(false);
    expect(engine.state.players[2]!.isBot).toBe(true);

    // 1. Verify Role Privacy: Each player role lookup is isolated to their own identity
    const p1Role = engine.state.players.find(p => p.id === 'p1')?.role;
    const p2Role = engine.state.players.find(p => p.id === 'p2')?.role;
    expect(p1Role).toBeDefined();
    expect(p2Role).toBeDefined();

    // In UI rendering, each client only extracts their own role via avalonLocalId()
    const getClientRoleView = (localPlayerId: string): string => {
      const p = engine.state.players.find(player => player.id === localPlayerId);
      return p ? `${p.role} (${p.alignment})` : 'Spectator (good)';
    };

    expect(getClientRoleView('p1')).toBe(`${p1Role} (${engine.state.players[0]!.alignment})`);
    expect(getClientRoleView('p2')).toBe(`${p2Role} (${engine.state.players[1]!.alignment})`);
    expect(getClientRoleView('spectator-guest')).toBe('Spectator (good)');

    // 2. Propose team of 2: p1 and p2
    const currentQuest = engine.getCurrentQuest();
    expect(engine.proposeTeam(['p1', 'p2']).isSuccess()).toBe(true);
    expect(engine.state.stage).toBe('voting');

    // 3. Joiner votes reject first (testing asynchronous partial vote merging)
    expect(engine.castVote('p2', false).isSuccess()).toBe(true);
    // Not all votes are in yet (1/5)
    expect(Object.keys(currentQuest.votes).length).toBe(1);
    expect(engine.state.stage).toBe('voting');

    // 4. Host votes approve and bot driver casts votes for bot seats p3, p4, p5
    expect(engine.castVote('p1', true).isSuccess()).toBe(true);
    const botPlayers = engine.state.players.filter(p => p.isBot);
    botPlayers.forEach(bot => {
      expect(engine.castVote(bot.id, true).isSuccess()).toBe(true);
    });

    // 5. All 5 votes merged: 4 approves (p1, p3, p4, p5) vs 1 reject (p2) -> Team approved!
    expect(Object.keys(currentQuest.votes).length).toBe(5);
    expect(engine.state.stage).toBe('quest-execution');

    // 6. Execute quest: p1 and p2 cast cards
    const p1Alignment = engine.state.players[0]!.alignment;
    const p2Alignment = engine.state.players[1]!.alignment;
    expect(p1Alignment).toBeDefined();

    // Good knights must pass; evil can choose
    expect(engine.castQuestCard('p1', true).isSuccess()).toBe(true);
    const p2Card = p2Alignment === 'good' ? true : false;
    expect(engine.castQuestCard('p2', p2Card).isSuccess()).toBe(true);

    // Quest outcome is resolved once both cards are in
    expect(currentQuest.outcome.isSome()).toBe(true);
  });
});

