import { describe, it, expect } from 'bun:test';
import {
  Phase10Engine,
  createPhase10Deck,
  isValidSet,
  isValidRun,
  isValidColorGroup,
  Phase10Card
} from '../src/games/phase10/phase10Engine';
import {
  Phase10ColorEnum,
  Phase10SpecialEnum
} from '../src/constants/gameEnums';

describe('Phase10Engine - Liturgical Rites, Set/Run Validation & AI Auto-Play', () => {
  it('creates full 108-card Phase 10 deck', () => {
    const deck = createPhase10Deck();
    expect(deck.length).toBe(108);

    const wilds = deck.filter(c => c.special === Phase10SpecialEnum.Wild);
    const skips = deck.filter(c => c.special === Phase10SpecialEnum.Skip);
    const standard = deck.filter(c => c.special === Phase10SpecialEnum.Standard);

    expect(wilds.length).toBe(8);
    expect(skips.length).toBe(4);
    expect(standard.length).toBe(96);
  });

  it('validates sets correctly (numbers match or are Wild)', () => {
    const set3: Phase10Card[] = [
      { id: '1', color: Phase10ColorEnum.Red, value: 7, special: Phase10SpecialEnum.Standard },
      { id: '2', color: Phase10ColorEnum.Blue, value: 7, special: Phase10SpecialEnum.Standard },
      { id: '3', color: Phase10ColorEnum.Yellow, value: 0, special: Phase10SpecialEnum.Wild }
    ];
    expect(isValidSet(set3, 3)).toBe(true);

    const badSet: Phase10Card[] = [
      { id: '1', color: Phase10ColorEnum.Red, value: 7, special: Phase10SpecialEnum.Standard },
      { id: '2', color: Phase10ColorEnum.Blue, value: 8, special: Phase10SpecialEnum.Standard },
      { id: '3', color: Phase10ColorEnum.Yellow, value: 7, special: Phase10SpecialEnum.Standard }
    ];
    expect(isValidSet(badSet, 3)).toBe(false);
  });

  it('validates runs correctly (consecutive ascending values)', () => {
    const run4: Phase10Card[] = [
      { id: '1', color: Phase10ColorEnum.Red, value: 4, special: Phase10SpecialEnum.Standard },
      { id: '2', color: Phase10ColorEnum.Blue, value: 5, special: Phase10SpecialEnum.Standard },
      { id: '3', color: Phase10ColorEnum.Green, value: 6, special: Phase10SpecialEnum.Standard },
      { id: '4', color: Phase10ColorEnum.Yellow, value: 7, special: Phase10SpecialEnum.Standard }
    ];
    expect(isValidRun(run4, 4)).toBe(true);

    const badRun: Phase10Card[] = [
      { id: '1', color: Phase10ColorEnum.Red, value: 4, special: Phase10SpecialEnum.Standard },
      { id: '2', color: Phase10ColorEnum.Blue, value: 5, special: Phase10SpecialEnum.Standard },
      { id: '3', color: Phase10ColorEnum.Green, value: 8, special: Phase10SpecialEnum.Standard },
      { id: '4', color: Phase10ColorEnum.Yellow, value: 9, special: Phase10SpecialEnum.Standard }
    ];
    expect(isValidRun(badRun, 4)).toBe(false);
  });

  it('validates color groups correctly (all same color or Wild)', () => {
    const color7: Phase10Card[] = [
      { id: '1', color: Phase10ColorEnum.Red, value: 1, special: Phase10SpecialEnum.Standard },
      { id: '2', color: Phase10ColorEnum.Red, value: 5, special: Phase10SpecialEnum.Standard },
      { id: '3', color: Phase10ColorEnum.Red, value: 9, special: Phase10SpecialEnum.Standard },
      { id: '4', color: Phase10ColorEnum.Red, value: 11, special: Phase10SpecialEnum.Standard },
      { id: '5', color: Phase10ColorEnum.Red, value: 2, special: Phase10SpecialEnum.Standard },
      { id: '6', color: Phase10ColorEnum.Red, value: 4, special: Phase10SpecialEnum.Standard },
      { id: '7', color: Phase10ColorEnum.Red, value: 0, special: Phase10SpecialEnum.Wild }
    ];
    expect(isValidColorGroup(color7, 7)).toBe(true);
  });

  it('manages turn draw, lay down phase, and discard flow', () => {
    const engine = new Phase10Engine('Alice', 'Bob');
    const p1 = engine.getCurrentPlayer();
    expect(p1.hand.length).toBe(10);

    // Draw from deck
    const drawRes = engine.drawCard(false);
    expect(drawRes.isSuccess()).toBe(true);
    expect(p1.hand.length).toBe(11);
    expect(engine.state.hasDrawnThisTurn).toBe(true);

    // Discard card
    const discardRes = engine.discardAndEndTurn(0);
    expect(discardRes.isSuccess()).toBe(true);
    expect(p1.hand.length).toBe(10);

    // Turned to Bob
    expect(engine.getCurrentPlayer().name).toBe('Bob');
    expect(engine.state.hasDrawnThisTurn).toBe(false);
  });

  it('lays down Phase 1 (2 sets of 3) and allows hitting', () => {
    const engine = new Phase10Engine('Alice', 'Bob');
    const p1 = engine.getCurrentPlayer();

    // Fabricate hand with two sets of 3: three 7s and three 9s
    p1.hand = [
      { id: 's1', color: Phase10ColorEnum.Red, value: 7, special: Phase10SpecialEnum.Standard },
      { id: 's2', color: Phase10ColorEnum.Blue, value: 7, special: Phase10SpecialEnum.Standard },
      { id: 's3', color: Phase10ColorEnum.Green, value: 7, special: Phase10SpecialEnum.Standard },
      { id: 's4', color: Phase10ColorEnum.Yellow, value: 9, special: Phase10SpecialEnum.Standard },
      { id: 's5', color: Phase10ColorEnum.Red, value: 9, special: Phase10SpecialEnum.Standard },
      { id: 's6', color: Phase10ColorEnum.Blue, value: 9, special: Phase10SpecialEnum.Standard },
      { id: 'h1', color: Phase10ColorEnum.Yellow, value: 7, special: Phase10SpecialEnum.Standard },
      { id: 'd1', color: Phase10ColorEnum.Green, value: 2, special: Phase10SpecialEnum.Standard }
    ];

    engine.drawCard(false);
    const layRes = engine.layDownPhase([0, 1, 2], [3, 4, 5]);
    expect(layRes.isSuccess()).toBe(true);
    expect(p1.phaseCompletedThisRound).toBe(true);
    expect(p1.laidGroups.length).toBe(2);

    // Hit remaining 7 onto the first laid set of 7s
    const hitIdx = p1.hand.findIndex(c => c.value === 7);
    const hitRes = engine.hitCard(hitIdx, p1.id, 0);
    expect(hitRes.isSuccess()).toBe(true);
    expect(p1.laidGroups[0]?.cards.length).toBe(4);
  });

  it('executes autonomous bot turn', () => {
    const engine = new Phase10Engine('Alice', 'Bot Prior');
    engine.state.currentTurnIndex = 1; // Bot turn
    const logs = engine.autoPlayBotTurn();
    expect(logs.length).toBeGreaterThan(0);
  });

  it('validates phases 2 through 10 requirements and edge cases', () => {
    const engine = new Phase10Engine('Alice', 'Bob');

    // Phase 2: 1 set of 3 + 1 run of 4
    const set3 = [
      { id: '1', color: Phase10ColorEnum.Red, value: 5, special: Phase10SpecialEnum.Standard },
      { id: '2', color: Phase10ColorEnum.Blue, value: 5, special: Phase10SpecialEnum.Standard },
      { id: '3', color: Phase10ColorEnum.Green, value: 5, special: Phase10SpecialEnum.Standard }
    ];
    const run4 = [
      { id: '4', color: Phase10ColorEnum.Red, value: 2, special: Phase10SpecialEnum.Standard },
      { id: '5', color: Phase10ColorEnum.Blue, value: 3, special: Phase10SpecialEnum.Standard },
      { id: '6', color: Phase10ColorEnum.Green, value: 4, special: Phase10SpecialEnum.Standard },
      { id: '7', color: Phase10ColorEnum.Yellow, value: 5, special: Phase10SpecialEnum.Standard }
    ];
    expect(engine.validatePhaseAttempt(2, set3, run4)).toBe(true);
    expect(engine.validatePhaseAttempt(2, run4, set3)).toBe(true);

    // Phase 3: 1 set of 4 + 1 run of 4
    const set4 = [
      ...set3,
      { id: '8', color: Phase10ColorEnum.Yellow, value: 5, special: Phase10SpecialEnum.Standard }
    ];
    expect(engine.validatePhaseAttempt(3, set4, run4)).toBe(true);
    expect(engine.validatePhaseAttempt(3, run4, set4)).toBe(true);

    // Phase 4: 1 run of 7
    const run7 = [
      ...run4,
      { id: '8', color: Phase10ColorEnum.Red, value: 6, special: Phase10SpecialEnum.Standard },
      { id: '9', color: Phase10ColorEnum.Blue, value: 7, special: Phase10SpecialEnum.Standard },
      { id: '10', color: Phase10ColorEnum.Green, value: 8, special: Phase10SpecialEnum.Standard }
    ];
    expect(engine.validatePhaseAttempt(4, run7)).toBe(true);

    // Phase 5: 1 run of 8
    const run8 = [
      ...run7,
      { id: '11', color: Phase10ColorEnum.Yellow, value: 9, special: Phase10SpecialEnum.Standard }
    ];
    expect(engine.validatePhaseAttempt(5, run8)).toBe(true);

    // Phase 6: 1 run of 9
    const run9 = [
      ...run8,
      { id: '12', color: Phase10ColorEnum.Red, value: 10, special: Phase10SpecialEnum.Standard }
    ];
    expect(engine.validatePhaseAttempt(6, run9)).toBe(true);

    // Phase 7: 2 sets of 4
    const set4B = [
      { id: '13', color: Phase10ColorEnum.Red, value: 9, special: Phase10SpecialEnum.Standard },
      { id: '14', color: Phase10ColorEnum.Blue, value: 9, special: Phase10SpecialEnum.Standard },
      { id: '15', color: Phase10ColorEnum.Green, value: 9, special: Phase10SpecialEnum.Standard },
      { id: '16', color: Phase10ColorEnum.Yellow, value: 9, special: Phase10SpecialEnum.Standard }
    ];
    expect(engine.validatePhaseAttempt(7, set4, set4B)).toBe(true);

    // Phase 8: 7 cards of one color
    const color7 = [
      { id: '1', color: Phase10ColorEnum.Blue, value: 1, special: Phase10SpecialEnum.Standard },
      { id: '2', color: Phase10ColorEnum.Blue, value: 3, special: Phase10SpecialEnum.Standard },
      { id: '3', color: Phase10ColorEnum.Blue, value: 5, special: Phase10SpecialEnum.Standard },
      { id: '4', color: Phase10ColorEnum.Blue, value: 7, special: Phase10SpecialEnum.Standard },
      { id: '5', color: Phase10ColorEnum.Blue, value: 9, special: Phase10SpecialEnum.Standard },
      { id: '6', color: Phase10ColorEnum.Blue, value: 11, special: Phase10SpecialEnum.Standard },
      { id: '7', color: Phase10ColorEnum.Blue, value: 12, special: Phase10SpecialEnum.Standard }
    ];
    expect(engine.validatePhaseAttempt(8, color7)).toBe(true);

    // Phase 9: 1 set of 5 + 1 set of 2
    const set5 = [
      ...set4,
      { id: '17', color: Phase10ColorEnum.Red, value: 0, special: Phase10SpecialEnum.Wild }
    ];
    const set2 = [
      { id: '18', color: Phase10ColorEnum.Red, value: 3, special: Phase10SpecialEnum.Standard },
      { id: '19', color: Phase10ColorEnum.Blue, value: 3, special: Phase10SpecialEnum.Standard }
    ];
    expect(engine.validatePhaseAttempt(9, set5, set2)).toBe(true);
    expect(engine.validatePhaseAttempt(9, set2, set5)).toBe(true);

    // Phase 10: 1 set of 5 + 1 set of 3
    expect(engine.validatePhaseAttempt(10, set5, set3)).toBe(true);
    expect(engine.validatePhaseAttempt(10, set3, set5)).toBe(true);

    // Invalid phase number
    expect(engine.validatePhaseAttempt(99, set3, set3)).toBe(false);
  });

  it('handles error boundaries for drawing, laying down phases, hitting, and recycling', () => {
    const engine = new Phase10Engine('Alice', 'Bob');
    expect(engine.getOpponentPlayer().name).toBe('Bob');

    // Lay down phase before drawing -> error
    expect(engine.layDownPhase([0, 1, 2], [3, 4, 5]).isFailure()).toBe(true);

    // Hit before drawing -> error
    expect(engine.hitCard(0, 'p1', 0).isFailure()).toBe(true);

    // Draw from discard
    const dRes = engine.drawCard(true);
    expect(dRes.isSuccess()).toBe(true);

    // Draw twice in turn -> error
    expect(engine.drawCard(false).isFailure()).toBe(true);

    // Duplicate card indices when laying down -> error
    expect(engine.layDownPhase([0, 1, 2], [2, 3, 4]).isFailure()).toBe(true);

    // Invalid cards for phase 1 -> error
    expect(engine.layDownPhase([0, 1, 2], [3, 4, 5]).isFailure()).toBe(true);

    // Hit when phase not completed -> error
    expect(engine.hitCard(0, 'p1', 0).isFailure()).toBe(true);

    // Lay down phase successfully
    const p1 = engine.getCurrentPlayer();
    p1.hand = [
      { id: 'a1', color: Phase10ColorEnum.Red, value: 1, special: Phase10SpecialEnum.Standard },
      { id: 'a2', color: Phase10ColorEnum.Blue, value: 1, special: Phase10SpecialEnum.Standard },
      { id: 'a3', color: Phase10ColorEnum.Green, value: 1, special: Phase10SpecialEnum.Standard },
      { id: 'b1', color: Phase10ColorEnum.Red, value: 2, special: Phase10SpecialEnum.Standard },
      { id: 'b2', color: Phase10ColorEnum.Blue, value: 2, special: Phase10SpecialEnum.Standard },
      { id: 'b3', color: Phase10ColorEnum.Green, value: 2, special: Phase10SpecialEnum.Standard },
      { id: 'extra', color: Phase10ColorEnum.Yellow, value: 12, special: Phase10SpecialEnum.Standard }
    ];
    const laySuccess = engine.layDownPhase([0, 1, 2], [3, 4, 5]);
    expect(laySuccess.isSuccess()).toBe(true);

    // Lay down phase when already completed -> error
    expect(engine.layDownPhase([0]).isFailure()).toBe(true);

    // Hit on non-existent group -> error
    expect(engine.hitCard(0, 'p1', 99).isFailure()).toBe(true);

    // Hit with invalid hand index -> error
    expect(engine.hitCard(99, 'p1', 0).isFailure()).toBe(true);

    // Hit with card that doesn't fit -> error (value 12 doesn't fit into set of 1s)
    expect(engine.hitCard(0, 'p1', 0).isFailure()).toBe(true);

    // Hit with card that does fit when it's the last card -> goes out, round ends!
    p1.hand = [{ id: 'match1', color: Phase10ColorEnum.Yellow, value: 1, special: Phase10SpecialEnum.Standard }];
    const hitLastRes = engine.hitCard(0, 'p1', 0);
    expect(hitLastRes.isSuccess()).toBe(true);
    expect(engine.state.isRoundOver).toBe(true);

    // Reset round state to test discard ending turn
    engine.state.isRoundOver = false;
    engine.state.hasDrawnThisTurn = true;
    p1.hand = [{ id: 'discCard', color: Phase10ColorEnum.Red, value: 9, special: Phase10SpecialEnum.Standard }];

    // Discard invalid index -> error
    expect(engine.discardAndEndTurn(99).isFailure()).toBe(true);

    // Discard last card -> goes out, round ends!
    const discRes = engine.discardAndEndTurn(0);
    expect(discRes.isSuccess()).toBe(true);
    expect(engine.state.isRoundOver).toBe(true);
    // P1 completed phase 1 and round ended twice, so advanced to phase 3
    expect(p1.currentPhase).toBe(3);

    // Drawing when game over -> error
    engine.state.isGameOver = true;
    expect(engine.drawCard(false).isFailure()).toBe(true);
  });

  it('recycles deck when draw pile is empty and calculates tournament winner upon completing phase 10', () => {
    const engine = new Phase10Engine('Alice', 'Bob');
    engine.state.drawPile = [];
    engine.state.discardPile = [
      { id: 'd1', color: Phase10ColorEnum.Red, value: 1, special: Phase10SpecialEnum.Standard },
      { id: 'd2', color: Phase10ColorEnum.Blue, value: 2, special: Phase10SpecialEnum.Standard },
      { id: 'd3', color: Phase10ColorEnum.Green, value: 3, special: Phase10SpecialEnum.Standard }
    ];

    // Drawing from deck should trigger checkRecycleDeck()
    const drawRes = engine.drawCard(false);
    expect(drawRes.isSuccess()).toBe(true);
    expect(engine.state.drawPile.length).toBeGreaterThan(0);

    // When a player finishes phase 10 and goes out, game over is triggered!
    const p1 = engine.getCurrentPlayer();
    p1.currentPhase = 10;
    p1.phaseCompletedThisRound = true;
    p1.hand = [{ id: 'last', color: Phase10ColorEnum.Red, value: 1, special: Phase10SpecialEnum.Standard }];
    const discRes = engine.discardAndEndTurn(0);
    expect(discRes.isSuccess()).toBe(true);
    expect(engine.state.isGameOver).toBe(true);
    expect(engine.state.winner.getOrThrow()).toBe(p1.id);
  });

  it('supports up to 6 players and starts new rounds dealing 10 cards to each', () => {
    const engine = new Phase10Engine('Host', 'Bot1', undefined, 6);
    expect(engine.state.players.length).toBe(6);
    expect(engine.state.players[0]!.hand.length).toBe(10);
    expect(engine.state.players[5]!.hand.length).toBe(10);

    const roundRes = engine.startNextRound();
    expect(roundRes.isSuccess()).toBe(true);
    expect(engine.state.players[0]!.hand.length).toBe(10);
    expect(engine.state.players[5]!.hand.length).toBe(10);

    // Guard when game over
    engine.state.isGameOver = true;
    expect(engine.startNextRound().isFailure()).toBe(true);
  });
});
