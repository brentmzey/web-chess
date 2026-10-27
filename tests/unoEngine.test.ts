import { describe, expect, it } from 'bun:test';
import { CardinalUnoEngine, createUnoDeck } from '../src/games/uno/unoEngine';

describe('Cardinal Uno Engine - 2 to 10 Player Capacity & Tournament Rules', () => {
  it('creates standard 108-card deck with correct color and action distributions', () => {
    const deck = createUnoDeck();
    expect(deck.length).toBe(108);

    const wilds = deck.filter(c => c.type === 'wild');
    const wild4s = deck.filter(c => c.type === 'wild4');
    expect(wilds.length).toBe(4);
    expect(wild4s.length).toBe(4);

    const skips = deck.filter(c => c.type === 'skip');
    const reverses = deck.filter(c => c.type === 'reverse');
    const draw2s = deck.filter(c => c.type === 'draw2');
    expect(skips.length).toBe(8);
    expect(reverses.length).toBe(8);
    expect(draw2s.length).toBe(8);
  });

  it('initializes game with up to 10 players (real-life table maximum)', () => {
    const engine = new CardinalUnoEngine('High Cardinal', 10);
    expect(engine.state.players.length).toBe(10);
    expect(engine.state.players[0]!.name).toBe('High Cardinal');
    expect(engine.state.players[0]!.hand.length).toBe(7);
    expect(engine.state.players[9]!.hand.length).toBe(7);
    expect(engine.state.discardPile.length).toBe(1);
    expect(engine.state.direction).toBe(1);
  });

  it('clamps player counts between 2 and 10 players', () => {
    const engineMin = new CardinalUnoEngine('P1', 1);
    expect(engineMin.state.players.length).toBe(2);

    const engineMax = new CardinalUnoEngine('P1', 15);
    expect(engineMax.state.players.length).toBe(10);
  });

  it('validates matching card rules (color, number, or wild)', () => {
    const customDeck = [
      { id: 'c1', color: 'red' as const, type: 'number' as const, value: 5 },
      { id: 'c2', color: 'blue' as const, type: 'number' as const, value: 5 },
      { id: 'c3', color: 'green' as const, type: 'number' as const, value: 8 },
      { id: 'w1', color: 'wild' as const, type: 'wild' as const, value: -1 }
    ];

    const engine = new CardinalUnoEngine('TestPlayer', 2);
    engine.state.discardPile = [{ id: 'top', color: 'red', type: 'number', value: 7 }];
    engine.state.activeColor = 'red';

    // c1 matches red color
    expect(engine.canPlayCard(customDeck[0]!)).toBe(true);
    // c2 matches number 5? top is 7, color is red -> false
    expect(engine.canPlayCard(customDeck[1]!)).toBe(false);
    // w1 wild is always playable
    expect(engine.canPlayCard(customDeck[3]!)).toBe(true);

    // If top is number 5:
    engine.state.discardPile = [{ id: 'top2', color: 'yellow', type: 'number', value: 5 }];
    engine.state.activeColor = 'yellow';
    // c2 matches number 5
    expect(engine.canPlayCard(customDeck[1]!)).toBe(true);
  });

  it('handles reverse, skip, draw2, and victory conditions', () => {
    const engine = new CardinalUnoEngine('Pilgrim', 4);
    const p1 = engine.state.players[0]!;

    // Force a reverse card into p1 hand
    p1.hand = [{ id: 'rev-card', color: 'red', type: 'reverse', value: -1 }];
    engine.state.activeColor = 'red';
    engine.state.discardPile = [{ id: 'top', color: 'red', type: 'number', value: 2 }];

    const playRes = engine.playCard(0);
    expect(playRes.isSuccess()).toBe(true);
    expect(engine.state.isGameOver).toBe(true);
    expect(engine.state.winner.getOrElse('')).toBe(p1.id);
  });

  it('allows drawing a card when player has no valid move', () => {
    const engine = new CardinalUnoEngine('Pilgrim', 3);
    const p1 = engine.state.players[0]!;
    const initialHandLen = p1.hand.length;

    const drawRes = engine.drawCard();
    expect(drawRes.isSuccess()).toBe(true);
    expect(p1.hand.length).toBe(initialHandLen + 1);
    // Turn advances
    expect(engine.state.currentTurnIndex).toBe(1);
  });

  it('handles action cards: wild, wild4, skip, draw2, and 2-player reverse', () => {
    const engine = new CardinalUnoEngine('Pilgrim', 2);
    const p1 = engine.state.players[0]!;
    const p2 = engine.state.players[1]!;

    // 1. Invalid hand index & unplayable card guards
    expect(engine.playCard(-1).isFailure()).toBe(true);
    expect(engine.playCard(99).isFailure()).toBe(true);

    // Unplayable card
    p1.hand = [{ id: 'blue-9', color: 'blue', type: 'number', value: 9 }];
    engine.state.discardPile = [{ id: 'red-2', color: 'red', type: 'number', value: 2 }];
    engine.state.activeColor = 'red';
    expect(engine.playCard(0).isFailure()).toBe(true);

    // 2. Play Wild Card with chosen color
    p1.hand = [{ id: 'w-card', color: 'wild', type: 'wild', value: -1 }, { id: 'dummy', color: 'red', type: 'number', value: 1 }];
    const wildRes = engine.playCard(0, 'green');
    expect(wildRes.isSuccess()).toBe(true);
    expect(engine.state.activeColor as string).toBe('green');

    // 3. 2-player Reverse acts as skip
    engine.state.currentTurnIndex = 0;
    p1.hand = [{ id: 'rev-2p', color: 'green', type: 'reverse', value: -1 }, { id: 'dummy2', color: 'red', type: 'number', value: 1 }];
    engine.playCard(0);
    // Skips p2, stays on p1!
    expect(engine.state.currentTurnIndex).toBe(0);

    // 4. Play Skip
    p1.hand = [{ id: 'skp', color: 'green', type: 'skip', value: -1 }, { id: 'd3', color: 'red', type: 'number', value: 1 }];
    engine.playCard(0);
    expect(engine.state.currentTurnIndex).toBe(0);

    // 5. Play Draw Two
    const p2HandBefore = p2.hand.length;
    p1.hand = [{ id: 'd2', color: 'green', type: 'draw2', value: -1 }, { id: 'd4', color: 'red', type: 'number', value: 1 }];
    engine.playCard(0);
    expect(p2.hand.length).toBe(p2HandBefore + 2);

    // 6. Play Wild Draw 4
    const p2HandBefore4 = p2.hand.length;
    p1.hand = [{ id: 'w4', color: 'wild', type: 'wild4', value: -1 }, { id: 'd5', color: 'red', type: 'number', value: 1 }];
    engine.playCard(0, 'blue');
    expect(engine.state.activeColor as string).toBe('blue');
    expect(p2.hand.length).toBe(p2HandBefore4 + 4);

    // 7. Call UNO & AI Turn execution
    expect(engine.callUno('p1').isSuccess()).toBe(true);
    expect(engine.callUno('unknown').isFailure()).toBe(true);
    expect(engine.executeAiTurn().isSuccess()).toBe(true);

    // 8. Check game over guard
    engine.state.isGameOver = true;
    expect(engine.playCard(0).isFailure()).toBe(true);
    expect(engine.drawCard().isFailure()).toBe(true);
    expect(engine.executeAiTurn().isFailure()).toBe(true);
  });
});
