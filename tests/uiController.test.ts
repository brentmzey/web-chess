import { beforeEach, describe, expect, it } from 'bun:test';
import { Chess } from 'chess.js';
import { UIController } from '../src/ui/uiController';
import type { GameMode } from '../src/types';

class MockElement {
  public className: string = '';
  public textContent: string = '';
  public innerHTML: string = '';
  public scrollTop: number = 0;
  public scrollHeight: number = 100;
  public classList = {
    classes: new Set<string>(),
    add: (...cls: string[]) => cls.forEach(c => this.classList.classes.add(c)),
    remove: (...cls: string[]) => cls.forEach(c => this.classList.classes.delete(c)),
    contains: (c: string) => this.classList.classes.has(c)
  };
}

describe('UIController Functional State and DOM Updates', () => {
  let domElements: Record<string, MockElement>;

  beforeEach(() => {
    domElements = {
      'turn-dot': new MockElement(),
      'turn-text': new MockElement(),
      'status-banner': new MockElement(),
      'status-banner-text': new MockElement(),
      'captured-by-white': new MockElement(),
      'captured-by-black': new MockElement(),
      'shattered-black-list': new MockElement(),
      'shattered-white-list': new MockElement(),
      'move-count-pill': new MockElement(),
      'move-history-container': new MockElement(),
      'log-drawer': new MockElement(),
      'gameover-modal': new MockElement(),
      'gameover-title': new MockElement(),
      'gameover-subtitle': new MockElement(),
      'promotion-modal': new MockElement()
    };

    (globalThis as any).document = {
      getElementById: (id: string) => domElements[id] || null
    };
  });

  it('updates turn indicator on White turn', () => {
    const ui = new UIController();
    const chess = new Chess();
    ui.update(chess, 'minimax');

    expect(domElements['turn-text']?.textContent).toBe("White Marble's Turn");
    expect(domElements['turn-dot']?.className).toContain('bg-stone-100');
  });

  it('exhaustively patterns matches all 4 game modes on Black turn', () => {
    const ui = new UIController();
    const chess = new Chess();
    chess.move('e4'); // White moves, now Black's turn

    const modeExpectations: Record<GameMode, string> = {
      'pass-and-play': "Black Obsidian's Turn",
      'minimax': 'Minimax (2-Ply) Thinking...',
      'micro-neural': 'Micro-Neural AI Evaluating...',
      'gemini-nano': 'Gemini Nano (Local LLM) Thinking...'
    };

    (Object.keys(modeExpectations) as GameMode[]).forEach((mode) => {
      ui.update(chess, mode);
      expect(domElements['turn-text']?.textContent).toBe(modeExpectations[mode]);
      expect(domElements['turn-dot']?.className).toContain('bg-purple-400');
    });
  });

  it('respects custom status override over default mode label', () => {
    const ui = new UIController();
    const chess = new Chess();
    chess.move('e4');

    ui.update(chess, 'gemini-nano', 'Gemini Nano Processing Prompt...');
    expect(domElements['turn-text']?.textContent).toBe('Gemini Nano Processing Prompt...');
  });

  it('displays Check and Checkmate banners correctly', () => {
    const ui = new UIController();
    const chess = new Chess();

    // 1. e4 e5 2. Qh5 Ke7 3. Qxe5#
    chess.move('e4');
    chess.move('e5');
    chess.move('Qh5');
    chess.move('Ke7');

    // Check
    chess.move('Qxe5+');
    expect(chess.in_check()).toBe(true);
    ui.update(chess, 'minimax');
    expect(domElements['status-banner-text']?.textContent).toBe('CHECKMATE!');
  });

  it('displays Game Over modal for checkmate and stalemate', () => {
    const ui = new UIController();
    const chess = new Chess();

    chess.move('f3');
    chess.move('e5');
    chess.move('g4');
    chess.move('Qh4#'); // White is checkmated by Black

    ui.showGameOver(chess);
    expect(domElements['gameover-title']?.textContent).toBe('CHECKMATE');
    expect(domElements['gameover-subtitle']?.textContent).toContain('Black Obsidian triumphs');
    expect(domElements['gameover-modal']?.classList.contains('flex')).toBe(true);
  });

  it('toggles Chronicle of Moves log drawer', () => {
    const ui = new UIController();
    expect(ui.drawerOpen).toBe(false);

    ui.toggleDrawer();
    expect(ui.drawerOpen).toBe(true);
    expect(domElements['log-drawer']?.classList.contains('translate-x-0')).toBe(true);

    ui.toggleDrawer();
    expect(ui.drawerOpen).toBe(false);
    expect(domElements['log-drawer']?.classList.contains('translate-x-[115%]')).toBe(true);
  });

  it('displays temporary liturgical banner messages', () => {
    const ui = new UIController();
    ui.showTemporaryBanner('Custom Cathedral Notification', 100);
    expect(domElements['status-banner-text']?.textContent).toBe('Custom Cathedral Notification');
    expect(domElements['status-banner']?.classList.contains('hidden')).toBe(false);
  });
});
