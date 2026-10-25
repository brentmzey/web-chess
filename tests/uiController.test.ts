import { beforeEach, describe, expect, it } from 'bun:test';
import { Chess } from 'chess.js';
import { DESKTOP_PROFILE, MOBILE_LITE_PROFILE } from '../src/graphics/deviceTier';
import {
  GameModeEnum,
  OpponentDifficultyEnum,
  type EncryptedStorageAuditReport,
  type GameMode
} from '../src/types';
import { UIController } from '../src/ui/uiController';
import { failure, success } from '../src/utils/fp';

class MockElement {
  public className: string = '';
  public textContent: string = '';
  public innerHTML: string = '';
  public title: string = '';
  public scrollTop: number = 0;
  public scrollHeight: number = 100;
  public attrs: Record<string, string> = {};
  public classList = {
    classes: new Set<string>(),
    add: (...cls: string[]) => cls.forEach(c => this.classList.classes.add(c)),
    remove: (...cls: string[]) => cls.forEach(c => this.classList.classes.delete(c)),
    contains: (c: string) => this.classList.classes.has(c),
    toggle: (c: string, force?: boolean) => {
      const shouldAdd = force !== undefined ? force : !this.classList.classes.has(c);
      if (shouldAdd) this.classList.classes.add(c);
      else this.classList.classes.delete(c);
    }
  };
  setAttribute(k: string, v: string) {
    this.attrs[k] = v;
  }
  getAttribute(k: string) {
    return this.attrs[k] ?? null;
  }
}

describe('UIController Functional State, Difficulty Badges, Undo Lock, Storage Audit & Device Profiles', () => {
  let domElements: Record<string, MockElement>;

  beforeEach(() => {
    domElements = {
      'turn-dot': new MockElement(),
      'turn-text': new MockElement(),
      'game-mode-badge': new MockElement(),
      'difficulty-badge': new MockElement(),
      'device-tier-badge': new MockElement(),
      'mobile-lite-banner': new MockElement(),
      'mobile-lite-banner-text': new MockElement(),
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
      'promotion-modal': new MockElement(),
      'pregame-modal': new MockElement(),
      'storage-audit-modal': new MockElement(),
      'storage-audit-algo': new MockElement(),
      'storage-audit-summary': new MockElement(),
      'storage-audit-json': new MockElement(),
      'btn-undo': new MockElement(),
      'undo-icon': new MockElement(),
      'undo-label': new MockElement(),
      'undo-rule-status-pill': new MockElement(),
      'live-session-modal': new MockElement(),
      'tab-create-live': new MockElement(),
      'tab-join-live': new MockElement(),
      'panel-create-live': new MockElement(),
      'panel-join-live': new MockElement(),
      'live-created-info': new MockElement(),
      'live-created-code': new MockElement(),
      'live-created-url': new MockElement(),
      'live-join-error': new MockElement(),
      'live-active-banner': new MockElement(),
      'live-active-code': new MockElement(),
      'btn-leave-live-session': new MockElement(),
      'pregame-mode-lock-notice': new MockElement()
    };

    (globalThis as any).document = {
      getElementById: (id: string) => domElements[id] || null
    };
  });

  it('updates turn indicator on White turn', () => {
    const ui = new UIController();
    const chess = new Chess();
    ui.update(chess, GameModeEnum.Minimax);

    expect(domElements['turn-text']?.textContent).toBe("White Marble's Turn");
    expect(domElements['turn-dot']?.className).toContain('bg-stone-100');
  });

  it('exhaustively pattern matches all game modes with difficulty badge on Black turn', () => {
    const ui = new UIController();
    const chess = new Chess();
    chess.move('e4'); // White moves, now Black's turn

    const modeExpectations: Record<GameMode, string> = {
      'pass-and-play': "Black Obsidian's Turn",
      minimax: 'Minimax (BALANCED) Thinking...',
      'micro-neural': 'Neural AI (BALANCED) Evaluating...',
      'gemini-nano': 'Gemini Nano (BALANCED) Thinking...',
      live: "Remote Opponent's Turn"
    };

    (Object.keys(modeExpectations) as GameMode[]).forEach(mode => {
      ui.update(chess, mode, undefined, OpponentDifficultyEnum.Balanced, true);
      expect(domElements['turn-text']?.textContent).toBe(modeExpectations[mode]);
      expect(domElements['turn-dot']?.className).toContain('bg-purple-400');
    });

    ui.update(
      chess,
      GameModeEnum.MicroNeural,
      undefined,
      OpponentDifficultyEnum.Aggressive,
      true
    );
    expect(domElements['turn-text']?.textContent).toBe('Neural AI (RUTHLESS) Evaluating...');
    expect(domElements['difficulty-badge']?.textContent).toBe('RUTHLESS');
  });

  it('locks Undo button UI when allowUndo is false (Strict Mode)', () => {
    const ui = new UIController();
    const chess = new Chess();
    chess.move('e4');

    ui.update(chess, GameModeEnum.Minimax, undefined, OpponentDifficultyEnum.Balanced, false);
    expect(domElements['btn-undo']?.classList.contains('opacity-45')).toBe(true);
    expect(domElements['btn-undo']?.getAttribute('aria-disabled')).toBe('true');
    expect(domElements['undo-icon']?.textContent).toBe('lock');
    expect(domElements['undo-label']?.textContent).toBe('Locked');
    expect(domElements['undo-rule-status-pill']?.textContent).toBe('Undo: Locked (Strict)');

    ui.update(chess, GameModeEnum.Minimax, undefined, OpponentDifficultyEnum.Balanced, true);
    expect(domElements['btn-undo']?.classList.contains('opacity-45')).toBe(false);
    expect(domElements['btn-undo']?.getAttribute('aria-disabled')).toBe('false');
    expect(domElements['undo-icon']?.textContent).toBe('undo');
    expect(domElements['undo-label']?.textContent).toBe('Undo');
    expect(domElements['undo-rule-status-pill']?.textContent).toBe('Undo: Allowed');
  });

  it('applies Mobile Lite and Desktop device profile UI notices properly', () => {
    const ui = new UIController();
    ui.applyDeviceProfileUI(MOBILE_LITE_PROFILE);
    expect(domElements['device-tier-badge']?.textContent).toBe('Mobile Lite');
    expect(domElements['mobile-lite-banner']?.classList.contains('hidden')).toBe(false);
    expect(domElements['mobile-lite-banner-text']?.textContent).toContain('available on Desktop');

    ui.applyDeviceProfileUI(DESKTOP_PROFILE);
    expect(domElements['device-tier-badge']?.textContent).toBe('Desktop');
    expect(domElements['mobile-lite-banner']?.classList.contains('hidden')).toBe(true);
  });

  it('respects custom status override over default mode label', () => {
    const ui = new UIController();
    const chess = new Chess();
    chess.move('e4');

    ui.update(chess, 'gemini-nano', 'Gemini Nano Processing Prompt...');
    expect(domElements['turn-text']?.textContent).toBe('Gemini Nano Processing Prompt...');
  });

  it('displays Check and Checkmate banners and both White & Black captured piece lists correctly', () => {
    const ui = new UIController();
    const chess = new Chess();

    chess.move('e4');
    chess.move('d5');
    chess.move('Qh5');
    chess.move('dxe4'); // Black captures White pawn -> populates shatteredWhite
    chess.move('Bc4');
    chess.move('Nf6');
    chess.move('Qxf7+'); // White captures Black pawn with check -> populates shatteredBlack
    expect(chess.in_check()).toBe(true);
    ui.update(chess, 'minimax');
    expect(domElements['status-banner-text']?.textContent).toBe('KING IN CHECK!');
    expect(domElements['captured-by-black']?.textContent).toBe('1');
    expect(domElements['captured-by-white']?.textContent).toBe('1');

    const mateChess = new Chess();
    mateChess.move('f3');
    mateChess.move('e5');
    mateChess.move('g4');
    mateChess.move('Qh4#');
    ui.update(mateChess, 'minimax');
    expect(domElements['status-banner-text']?.textContent).toBe('CHECKMATE!');
  });

  it('displays Game Over (checkmate & stalemate), Promotion, Pre-Game, and Encrypted Storage Audit modals correctly', () => {
    const ui = new UIController();
    const chess = new Chess();

    chess.move('f3');
    chess.move('e5');
    chess.move('g4');
    chess.move('Qh4#');

    ui.showGameOver(chess);
    expect(domElements['gameover-title']?.textContent).toBe('CHECKMATE');
    expect(domElements['gameover-subtitle']?.textContent).toContain('Black Obsidian triumphs');
    expect(domElements['gameover-modal']?.classList.contains('flex')).toBe(true);

    ui.hideGameOver();
    expect(domElements['gameover-modal']?.classList.contains('hidden')).toBe(true);

    // Stalemate / draw GameOver branch
    const stalemateChess = new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    ui.showGameOver(stalemateChess);
    expect(domElements['gameover-title']?.textContent).toBe('STALEMATE / DRAW');

    // Promotion modal
    ui.showPromotionModal();
    expect(domElements['promotion-modal']?.classList.contains('flex')).toBe(true);
    ui.hidePromotionModal();
    expect(domElements['promotion-modal']?.classList.contains('hidden')).toBe(true);

    // Pre-Game modal
    ui.showPreGameModal();
    expect(domElements['pregame-modal']?.classList.contains('flex')).toBe(true);
    ui.hidePreGameModal();
    expect(domElements['pregame-modal']?.classList.contains('hidden')).toBe(true);

    // Encrypted Storage Audit modal (Success & Failure)
    const sampleReport: EncryptedStorageAuditReport = {
      database: 'WizardChessSessionDB',
      objectStore: 'sanctuary_sessions',
      algorithm: 'AES-GCM-256',
      keyLengthBits: 256,
      ivLengthBytes: 12,
      authTagBits: 128,
      cipherMode: 'Galois/Counter Mode (AEAD, 128-bit Auth Tag)',
      keyManagement: 'Web Crypto CSPRNG Non-Extractable CryptoKey (extractable: false)',
      keyExtractable: false,
      hardcodedBundleKey: false,
      aadContextBound: true,
      localStorageUsed: false,
      plaintextExposed: false,
      auditedAt: '2026-10-18T12:00:00.000Z',
      recordCount: 1,
      records: [
        {
          id: 'active_session',
          updatedAt: 1729250000000,
          envelope: {
            v: 1,
            alg: 'AES-GCM-256',
            iv: 'YWJjZGVmZ2hpamts',
            ciphertext: 'c2VjcmV0Y2lwaGVydGV4dA=='
          }
        }
      ]
    };

    ui.renderStorageAudit(success(sampleReport));
    expect(domElements['storage-audit-algo']?.textContent).toContain('AES-GCM-256');
    expect(domElements['storage-audit-summary']?.textContent).toContain('Encrypted Records: 1');
    expect(domElements['storage-audit-json']?.textContent).toContain('c2VjcmV0Y2lwaGVydGV4dA==');

    ui.renderStorageAudit(failure('IndexedDB unavailable'));
    expect(domElements['storage-audit-summary']?.textContent).toContain('IndexedDB unavailable');
    expect(domElements['storage-audit-json']?.textContent).toContain('IndexedDB unavailable');

    ui.showStorageAuditModal();
    expect(domElements['storage-audit-modal']?.classList.contains('flex')).toBe(true);
    ui.hideStorageAuditModal();
    expect(domElements['storage-audit-modal']?.classList.contains('hidden')).toBe(true);
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

  it('displays temporary banner messages and auto-hides after duration', async () => {
    const ui = new UIController();
    ui.showTemporaryBanner('Custom Cathedral Notification', 5);
    expect(domElements['status-banner-text']?.textContent).toBe('Custom Cathedral Notification');
    expect(domElements['status-banner']?.classList.contains('hidden')).toBe(false);
    await new Promise(resolve => setTimeout(resolve, 15));
    expect(domElements['status-banner']?.classList.contains('hidden')).toBe(true);
  });

  it('controls Live Multiplayer Session modal, tab switching, and error displays', () => {
    const ui = new UIController();

    // Show & hide modal
    ui.showLiveSessionModal();
    expect(domElements['live-session-modal']?.classList.contains('flex')).toBe(true);
    expect(domElements['live-session-modal']?.classList.contains('hidden')).toBe(false);

    ui.hideLiveSessionModal();
    expect(domElements['live-session-modal']?.classList.contains('hidden')).toBe(true);

    // Switch tabs
    ui.switchLiveSessionTab('join');
    expect(domElements['tab-join-live']?.classList.contains('active-chip')).toBe(true);
    expect(domElements['panel-join-live']?.classList.contains('hidden')).toBe(false);
    expect(domElements['panel-create-live']?.classList.contains('hidden')).toBe(true);

    ui.switchLiveSessionTab('create');
    expect(domElements['tab-create-live']?.classList.contains('active-chip')).toBe(true);
    expect(domElements['panel-create-live']?.classList.contains('hidden')).toBe(false);
    expect(domElements['panel-join-live']?.classList.contains('hidden')).toBe(true);

    // Created session feedback
    ui.showLiveCreatedSession('SANCT-TEST123', 'https://custom.app/?session=SANCT-TEST123');
    expect(domElements['live-created-info']?.classList.contains('hidden')).toBe(false);
    expect(domElements['live-created-code']?.textContent).toBe('SANCT-TEST123');
    expect((domElements['live-created-url'] as any)?.value).toBe('https://custom.app/?session=SANCT-TEST123');

    // Default URL generation fallback when inviteUrl omitted (without window, then with window)
    ui.showLiveCreatedSession('SANCT-DEF');
    expect((domElements['live-created-url'] as any)?.value).toContain('SANCT-DEF');

    (globalThis as any).window = { location: { origin: 'https://test.origin', pathname: '/game' } };
    ui.showLiveCreatedSession('SANCT-WIN');
    expect((domElements['live-created-url'] as any)?.value).toBe('https://test.origin/game?session=SANCT-WIN');
    delete (globalThis as any).window;

    // Join errors
    ui.showLiveJoinError('Invalid session code');
    expect(domElements['live-join-error']?.textContent).toBe('Invalid session code');
    expect(domElements['live-join-error']?.classList.contains('hidden')).toBe(false);

    ui.clearLiveJoinError();
    expect(domElements['live-join-error']?.textContent).toBe('');
    expect(domElements['live-join-error']?.classList.contains('hidden')).toBe(true);

    // Live Match Active locks & banner toggle
    ui.setLiveMatchActive(true, 'SANCT-ACTIVE');
    expect(domElements['live-active-banner']?.classList.contains('hidden')).toBe(false);
    expect(domElements['live-active-code']?.textContent).toBe('SANCT-ACTIVE');
    expect(domElements['pregame-mode-lock-notice']?.classList.contains('hidden')).toBe(false);

    ui.setLiveMatchActive(false);
    expect(domElements['live-active-banner']?.classList.contains('hidden')).toBe(true);
    expect(domElements['live-active-code']?.textContent).toBe('');
    expect(domElements['pregame-mode-lock-notice']?.classList.contains('hidden')).toBe(true);
  });
});

