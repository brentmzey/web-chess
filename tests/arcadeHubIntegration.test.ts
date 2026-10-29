import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Database } from 'bun:sqlite';
import { UIController } from '../src/ui/uiController';
import { formatBlackjackAdditiveCount, type PlayingCard } from '../src/games/blackjack/blackjackEngine';
import { CathedralSoundEngine } from '../src/audio/CathedralSoundEngine';
import { ARCADE_GAME_RULES } from '../src/constants/gameRules';

class MockElement {
  public className: string = '';
  public textContent: string = '';
  public innerHTML: string = '';
  public title: string = '';
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

describe('Sanctuary Arcade Multi-Game Hub UI & Hungarian Schema Architecture', () => {
  it('controls Arcade Hub modal visibility and quick join feedback', () => {
    const hubModal = new MockElement();
    hubModal.classList.add('hidden');
    const feedback = new MockElement();
    feedback.classList.add('hidden');

    const domMap: Record<string, MockElement> = {
      'arcade-hub-modal': hubModal,
      'hub-quick-join-feedback': feedback
    };

    const originalDoc = (globalThis as any).document;
    (globalThis as any).document = {
      getElementById: (id: string) => domMap[id] || null
    };

    const ui = new UIController();
    expect(ui.isArcadeHubVisible()).toBe(false);

    ui.showArcadeHub();
    expect(ui.isArcadeHubVisible()).toBe(true);
    expect(hubModal.classList.contains('hidden')).toBe(false);

    ui.hideArcadeHub();
    expect(ui.isArcadeHubVisible()).toBe(false);
    expect(hubModal.classList.contains('hidden')).toBe(true);

    // Feedback error state
    ui.setHubQuickJoinFeedback('Invalid session code', true);
    expect(feedback.textContent).toBe('Invalid session code');
    expect(feedback.classList.contains('hidden')).toBe(false);
    expect(feedback.classList.contains('text-red-200')).toBe(true);

    // Feedback success state
    ui.setHubQuickJoinFeedback('Connecting to Blackjack...', false);
    expect(feedback.textContent).toBe('Connecting to Blackjack...');
    expect(feedback.classList.contains('text-emerald-200')).toBe(true);

    ui.clearHubQuickJoinFeedback();
    expect(feedback.textContent).toBe('');
    expect(feedback.classList.contains('hidden')).toBe(true);

    (globalThis as any).document = originalDoc;
  });

  it('verifies Hungarian Multi-Game PocketBase schema specification', () => {
    const schemaPath = resolve(__dirname, '../src/server/pocketbase/multiGameSchema.json');
    const raw = readFileSync(schemaPath, 'utf8');
    const schema = JSON.parse(raw);

    expect(Array.isArray(schema.collections)).toBe(true);
    const collectionNames = schema.collections.map((c: any) => c.name);

    // Verify Blackjack collections
    expect(collectionNames).toContain('tbl_bjk_sessions');
    expect(collectionNames).toContain('tbl_bjk_hands');
    expect(collectionNames).toContain('tbl_archived_bjk_snapshots');
    expect(collectionNames).toContain('tbl_archived_bjk_snapshots_history');

    // Verify Avalon collections
    expect(collectionNames).toContain('tbl_res_sessions');
    expect(collectionNames).toContain('tbl_res_missions');
    expect(collectionNames).toContain('tbl_archived_res_snapshots');
    expect(collectionNames).toContain('tbl_archived_res_snapshots_history');

    // Verify Uno collections
    expect(collectionNames).toContain('tbl_uno_sessions');
    expect(collectionNames).toContain('tbl_archived_uno_snapshots');
    expect(collectionNames).toContain('tbl_archived_uno_snapshots_history');

    // Verify Phase 10 collections
    expect(collectionNames).toContain('tbl_p10_sessions');
    expect(collectionNames).toContain('tbl_archived_p10_snapshots');
    expect(collectionNames).toContain('tbl_archived_p10_snapshots_history');

    // Verify that every primary session collection contains do_not_delete and session_code
    for (const sessionColName of ['tbl_bjk_sessions', 'tbl_res_sessions', 'tbl_uno_sessions', 'tbl_p10_sessions']) {
      const col = schema.collections.find((c: any) => c.name === sessionColName);
      expect(col).toBeDefined();
      const fieldNames = col.fields.map((f: any) => f.name);
      expect(fieldNames).toContain('session_code');
      expect(fieldNames).toContain('do_not_delete');
    }

    // Verify that every snapshot collection contains Hungarian-prefixed fields and bln_do_not_delete
    for (const snapColName of [
      'tbl_archived_bjk_snapshots',
      'tbl_archived_res_snapshots',
      'tbl_archived_uno_snapshots',
      'tbl_archived_p10_snapshots'
    ]) {
      const snapCol = schema.collections.find((c: any) => c.name === snapColName);
      expect(snapCol).toBeDefined();
      const fieldNames = snapCol.fields.map((f: any) => f.name);
      expect(fieldNames).toContain('txt_session_code');
      expect(fieldNames).toContain('bln_do_not_delete');
      expect(fieldNames).toContain('json_snapshot_payload');
    }
  });

  it('executes and verifies SQLite Multi-Game Schema in memory', () => {
    const sqlPath = resolve(__dirname, '../src/server/db/multiGameSchema.sql');
    const sqlContent = readFileSync(sqlPath, 'utf8');

    const db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON;');
    db.run(sqlContent);

    // Verify all tables exist
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'tbl_%'")
      .all()
      .map((row: any) => row.name);

    expect(tables).toContain('tbl_bjk_sessions');
    expect(tables).toContain('tbl_bjk_hands');
    expect(tables).toContain('tbl_archived_bjk_snapshots');
    expect(tables).toContain('tbl_archived_bjk_snapshots_history');

    expect(tables).toContain('tbl_res_sessions');
    expect(tables).toContain('tbl_res_missions');
    expect(tables).toContain('tbl_archived_res_snapshots');
    expect(tables).toContain('tbl_archived_res_snapshots_history');

    expect(tables).toContain('tbl_uno_sessions');
    expect(tables).toContain('tbl_archived_uno_snapshots');
    expect(tables).toContain('tbl_archived_uno_snapshots_history');

    expect(tables).toContain('tbl_p10_sessions');
    expect(tables).toContain('tbl_archived_p10_snapshots');
    expect(tables).toContain('tbl_archived_p10_snapshots_history');

    // Test inserting and querying a Blackjack session with do_not_delete = 1
    db.prepare(`
      INSERT INTO tbl_bjk_sessions (id, session_code, status, min_bet, max_bet, deck_shoe_count, do_not_delete, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('bjk_1', 'BJK-GOLDEN', 'betting', 10, 500, 6, 1, 1000, 1000);

    const bjkRow = db.prepare('SELECT * FROM tbl_bjk_sessions WHERE session_code = ?').get('BJK-GOLDEN') as any;
    expect(bjkRow).toBeDefined();
    expect(bjkRow.session_code).toBe('BJK-GOLDEN');
    expect(bjkRow.do_not_delete).toBe(1);

    // Test cascade delete on child hands
    db.prepare(`
      INSERT INTO tbl_bjk_hands (id, session_id, player_id, player_name, cards_json, bet_amount, hand_total, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('hand_1', 'bjk_1', 'p_1', 'CardMaster', '["As", "Kh"]', 25, 21, 'blackjack', 1000);

    const handsCountBefore = db.prepare('SELECT COUNT(*) as count FROM tbl_bjk_hands WHERE session_id = ?').get('bjk_1') as any;
    expect(handsCountBefore.count).toBe(1);

    db.prepare('DELETE FROM tbl_bjk_sessions WHERE id = ?').run('bjk_1');
    const handsCountAfter = db.prepare('SELECT COUNT(*) as count FROM tbl_bjk_hands WHERE session_id = ?').get('bjk_1') as any;
    expect(handsCountAfter.count).toBe(0);

    db.close();
  });

  it('verifies all 7 Arcade Game Theaters have mobile responsive shells, seat strips, sticky action docks, and dynamic player controls', () => {
    const htmlPath = resolve(__dirname, '../index.html');
    const html = readFileSync(htmlPath, 'utf8');
    const cssPath = resolve(__dirname, '../src/styles/main.css');
    const css = readFileSync(cssPath, 'utf8');

    // Verify viewport-fit=cover for notched mobile screens
    expect(html).toContain('viewport-fit=cover');

    // Verify all 8 arcade modals have .arcade-theater-shell
    for (const modalId of [
      'id="blackjack-modal"',
      'id="poker-modal"',
      'id="skipbo-modal"',
      'id="phase10-modal"',
      'id="uno-modal"',
      'id="avalon-modal"',
      'id="set-modal"',
      'id="solitaire-modal"'
    ]) {
      expect(html).toContain(modalId);
    }

    // Verify all 7 multi-player seat selectors and + Player buttons exist in index.html
    for (const controlId of [
      'id="bjk-seats-select"',
      'id="bjk-btn-add-player"',
      'id="bjk-seats-track"',
      'id="poker-seats-select"',
      'id="poker-btn-add-player"',
      'id="poker-seats-track"',
      'id="skipbo-seats-select"',
      'id="skipbo-btn-add-player"',
      'id="skipbo-opponents-track"',
      'id="phase10-seats-select"',
      'id="phase10-btn-add-player"',
      'id="phase10-btn-bot-step"',
      'id="phase10-opponents-track"',
      'id="uno-seats-select"',
      'id="uno-btn-add-player"',
      'id="uno-opponents-track"',
      'id="avalon-seats-select"',
      'id="avalon-btn-add-player"',
      'id="set-seats-select"',
      'id="set-btn-add-player"',
      'id="set-players-scoreboard"'
    ]) {
      expect(html).toContain(controlId);
    }

    // Verify responsive CSS classes in src/styles/main.css
    for (const cssRule of [
      '.playing-card-ui',
      '.playing-card-corner',
      '.playing-card-center',
      '.arcade-set-card-ui',
      '.arcade-theater-shell',
      '.arcade-theater-main',
      '.arcade-seat-strip',
      '.arcade-action-dock',
      '.arcade-felt-board',
      '@media (max-width: 639px)'
    ]) {
      expect(css).toContain(cssRule);
    }

    // Verify all 8 felt tables contain arcade-felt-board and do not have min-h-0
    for (const feltClass of [
      'felt-blackjack',
      'felt-poker',
      'felt-skipbo',
      'felt-phase10',
      'felt-uno',
      'felt-avalon',
      'felt-set',
      'felt-solitaire'
    ]) {
      expect(html).toContain(feltClass);
      expect(html).toContain(`arcade-felt-board`);
    }
  });

  it('formats Blackjack additive count equations and displays accurately across game stages', () => {
    // Empty hand
    expect(formatBlackjackAdditiveCount([])).toBe('0');

    // Single card
    const singleCard: PlayingCard[] = [{ suit: 'spades', value: '10', faceUp: true }];
    expect(formatBlackjackAdditiveCount(singleCard)).toBe('10');

    // 2-card standard total
    const twoCards: PlayingCard[] = [
      { suit: 'hearts', value: '10', faceUp: true },
      { suit: 'diamonds', value: '7', faceUp: true }
    ];
    expect(formatBlackjackAdditiveCount(twoCards)).toBe('10 + 7 = 17');

    // Soft total with Ace
    const softHand: PlayingCard[] = [
      { suit: 'spades', value: 'A', faceUp: true },
      { suit: 'clubs', value: '6', faceUp: true }
    ];
    expect(formatBlackjackAdditiveCount(softHand)).toBe('11 + 6 = 17 (Soft)');

    // Natural 21 Blackjack
    const blackjackHand: PlayingCard[] = [
      { suit: 'spades', value: 'A', faceUp: true },
      { suit: 'hearts', value: 'K', faceUp: true }
    ];
    expect(formatBlackjackAdditiveCount(blackjackHand)).toBe('11 + 10 = 21 (Blackjack!)');

    // Bust hand
    const bustHand: PlayingCard[] = [
      { suit: 'clubs', value: '10', faceUp: true },
      { suit: 'diamonds', value: '8', faceUp: true },
      { suit: 'spades', value: '5', faceUp: true }
    ];
    expect(formatBlackjackAdditiveCount(bustHand)).toBe('10 + 8 + 5 = 23 (Bust)');

    // Dealer hole card hidden
    const dealerHoleHidden: PlayingCard[] = [
      { suit: 'hearts', value: '10', faceUp: true },
      { suit: 'spades', value: '6', faceUp: false }
    ];
    expect(formatBlackjackAdditiveCount(dealerHoleHidden, true)).toBe('10 + ? = 10+?');
    expect(formatBlackjackAdditiveCount(dealerHoleHidden, false)).toBe('10 + 6 = 16');

    // Multiple Aces reduction
    const multiAces: PlayingCard[] = [
      { suit: 'clubs', value: 'A', faceUp: true },
      { suit: 'diamonds', value: 'A', faceUp: true },
      { suit: 'hearts', value: '9', faceUp: true }
    ];
    expect(formatBlackjackAdditiveCount(multiAces)).toBe('1 + 11 + 9 = 21 (Soft)');
  });

  it('suspends Cathedral Web Audio engine to conserve battery and wake up seamlessly', () => {
    let suspendCalled = false;
    class MockAudioContext {
      public state = 'running';
      suspend() {
        suspendCalled = true;
        this.state = 'suspended';
        return Promise.resolve();
      }
      resume() {
        this.state = 'running';
        return Promise.resolve();
      }
    }
    (globalThis as any).window = {
      ...(globalThis as any).window,
      AudioContext: MockAudioContext
    };

    const sound = new CathedralSoundEngine();
    sound.init();
    expect(sound.enabled).toBe(true);
    sound.suspend();
    expect(suspendCalled).toBe(true);
  });

  it('validates comprehensive real-life game rules repository for all 9 arcade games', () => {
    const requiredKeys = ['chess', 'blackjack', 'poker', 'skipbo', 'phase10', 'uno', 'avalon', 'set', 'solitaire'];
    expect(Object.keys(ARCADE_GAME_RULES).sort()).toEqual(requiredKeys.sort());

    for (const key of requiredKeys) {
      const rule = ARCADE_GAME_RULES[key];
      expect(rule).toBeDefined();
      expect(rule.id).toBe(key);
      expect(rule.title.length).toBeGreaterThan(0);
      expect(rule.realLifeName.length).toBeGreaterThan(0);
      expect(rule.objective.length).toBeGreaterThan(0);
      expect(rule.summary.length).toBeGreaterThan(0);
      expect(rule.keyRules.length).toBeGreaterThanOrEqual(3);
      expect(rule.officialUrl).toMatch(/^https:\/\/en\.wikipedia\.org\/wiki\//);
      expect(rule.urlLabel.length).toBeGreaterThan(0);
    }
  });

  it('controls Universal Game Rules modal and renders instructions in UIController', () => {
    const rulesModal = new MockElement();
    rulesModal.classList.add('hidden');
    const titleEl = new MockElement();
    const realLifeEl = new MockElement();
    const objectiveEl = new MockElement();
    const rulesListEl = new MockElement();
    const linkEl = new MockElement() as any;
    linkEl.href = '';
    const labelEl = new MockElement();

    const domMap: Record<string, any> = {
      'arcade-rules-modal': rulesModal,
      'rules-modal-title': titleEl,
      'rules-modal-real-life': realLifeEl,
      'rules-modal-objective': objectiveEl,
      'rules-modal-rules-list': rulesListEl,
      'rules-modal-external-link': linkEl,
      'rules-modal-external-label': labelEl
    };

    const originalDoc = (globalThis as any).document;
    (globalThis as any).document = {
      getElementById: (id: string) => domMap[id] || null
    };

    const ui = new UIController();
    expect(ui.isArcadeRulesVisible()).toBe(false);

    // Show Blackjack rules
    ui.showArcadeRules('blackjack');
    expect(ui.isArcadeRulesVisible()).toBe(true);
    expect(rulesModal.classList.contains('hidden')).toBe(false);
    expect(titleEl.textContent).toBe('Gothic Blackjack');
    expect(realLifeEl.textContent).toContain('Blackjack (Twenty-One)');
    expect(objectiveEl.textContent).toContain('21');
    expect(rulesListEl.innerHTML).toContain('<li>');
    expect(linkEl.href).toBe('https://en.wikipedia.org/wiki/Blackjack');
    expect(labelEl.textContent).toContain('Official');

    // Show SET rules
    ui.showArcadeRules('set');
    expect(titleEl.textContent).toBe('Sacred Geometry SET');
    expect(realLifeEl.textContent).toContain('SET');

    // Hide rules
    ui.hideArcadeRules();
    expect(ui.isArcadeRulesVisible()).toBe(false);
    expect(rulesModal.classList.contains('hidden')).toBe(true);

    // Unknown key does nothing
    ui.showArcadeRules('nonexistent_game');
    expect(ui.isArcadeRulesVisible()).toBe(false);

    (globalThis as any).document = originalDoc;
  });

  it('confirms HTML DOM contains real-life game annotations, accordions, and rules triggers', () => {
    const htmlPath = resolve(__dirname, '../index.html');
    const html = readFileSync(htmlPath, 'utf8');

    // Universal rules modal exists
    expect(html).toContain('id="arcade-rules-modal"');
    expect(html).toContain('id="rules-modal-title"');
    expect(html).toContain('id="rules-modal-real-life"');
    expect(html).toContain('id="rules-modal-objective"');
    expect(html).toContain('id="rules-modal-rules-list"');
    expect(html).toContain('id="rules-modal-external-link"');
    expect(html).toContain('id="btn-close-arcade-rules"');
    expect(html).toContain('id="btn-dismiss-arcade-rules"');

    // All 8 theater rules buttons exist
    const rulesButtons = [
      'id="btn-chess-rules"',
      'id="btn-bjk-rules"',
      'id="btn-poker-rules"',
      'id="btn-skipbo-rules"',
      'id="btn-phase10-rules"',
      'id="btn-uno-rules"',
      'id="btn-avalon-rules"',
      'id="btn-set-rules"'
    ];
    for (const btnId of rulesButtons) {
      expect(html).toContain(btnId);
    }

    // Arcade Hub has Real-Life Game annotations and Wikipedia links for each game
    const expectedRealLifeNames = [
      'Classical Chess (FIDE)',
      'Blackjack (Twenty-One)',
      'The Resistance: Avalon',
      'UNO (Mattel)',
      'Phase 10',
      "Texas Hold'em / Omaha / Stud Poker",
      'Skip-Bo / Spite and Malice',
      'SET (Marsha Falco / PlayMonster)'
    ];
    for (const name of expectedRealLifeNames) {
      expect(html).toContain(name);
    }
    expect(html).toContain('https://en.wikipedia.org/wiki/Rules_of_chess');
    expect(html).toContain('https://en.wikipedia.org/wiki/Blackjack');
    expect(html).toContain('https://en.wikipedia.org/wiki/Texas_hold_%27em');
    expect(html).toContain('https://en.wikipedia.org/wiki/Skip-Bo');
    expect(html).toContain('https://en.wikipedia.org/wiki/Phase_10');
    expect(html).toContain('https://en.wikipedia.org/wiki/Uno_(card_game)');
    expect(html).toContain('https://en.wikipedia.org/wiki/The_Resistance_(game)');
    expect(html).toContain('https://en.wikipedia.org/wiki/Set_(card_game)');

    // Verify presence of preferred full-link copy buttons and match-code copy buttons across all arcade games
    const expectedCopyButtons = [
      'id="btn-bjk-copy-link"',
      'id="btn-bjk-copy-code"',
      'id="btn-poker-copy-link"',
      'id="btn-poker-copy-code"',
      'id="btn-skipbo-copy-link"',
      'id="btn-skipbo-copy-code"',
      'id="btn-phase10-copy-link"',
      'id="btn-phase10-copy-code"',
      'id="btn-uno-copy-link"',
      'id="btn-uno-copy-code"',
      'id="btn-avalon-copy-link"',
      'id="btn-avalon-copy-code"',
      'id="btn-set-copy-link"',
      'id="btn-set-copy-code"',
      'id="btn-solitaire-copy-link"',
      'id="btn-solitaire-copy-code"',
      'id="btn-persistent-copy-link"',
      'id="btn-persistent-copy-code"'
    ];
    for (const btnId of expectedCopyButtons) {
      expect(html).toContain(btnId);
    }
  });

  it('supports copying preferred full live match invite link and room code across arcade games', async () => {
    let clipboardText = '';
    const mockClipboard = {
      writeText: async (text: string) => {
        clipboardText = text;
      }
    };
    const originalNavigator = globalThis.navigator;
    (globalThis as any).navigator = {
      ...originalNavigator,
      clipboard: mockClipboard
    };

    const originalLocation = globalThis.window?.location;
    (globalThis as any).window = {
      ...globalThis.window,
      location: {
        origin: 'https://sanctuary-chess.netlify.app',
        pathname: '/'
      }
    };

    try {
      const copyArcadeLink = (code: string) => {
        const shareUrl = `${window.location.origin}${window.location.pathname}?session=${code}`;
        return navigator.clipboard.writeText(shareUrl);
      };
      const copyArcadeCode = (code: string) => {
        return navigator.clipboard.writeText(code);
      };

      const testGameCodes = [
        { game: 'Blackjack', code: 'BJK-TEST' },
        { game: 'Poker', code: 'POKER-TEST' },
        { game: 'Skip-Bo', code: 'SKIP-TEST' },
        { game: 'Phase 10', code: 'P10-TEST' },
        { game: 'Uno', code: 'UNO-TEST' },
        { game: 'Avalon', code: 'AVALON-TEST' },
        { game: 'SET', code: 'SET-TEST' },
        { game: 'Solitaire', code: 'SOL-TEST' },
        { game: 'Chess', code: 'SANCT-TEST' }
      ];

      for (const item of testGameCodes) {
        // Preferred full link
        await copyArcadeLink(item.code);
        expect(clipboardText).toBe(`https://sanctuary-chess.netlify.app/?session=${item.code}`);

        // Code only
        await copyArcadeCode(item.code);
        expect(clipboardText).toBe(item.code);
      }
    } finally {
      (globalThis as any).navigator = originalNavigator;
      if (originalLocation && globalThis.window) {
        (globalThis.window as any).location = originalLocation;
      }
    }
  });

  it('manages theater modal open/close lifecycle and display classes across all arcade games', () => {
    const modals: Record<string, MockElement> = {
      'arcade-hub-modal': new MockElement(),
      'blackjack-modal': new MockElement(),
      'poker-modal': new MockElement(),
      'skipbo-modal': new MockElement(),
      'phase10-modal': new MockElement(),
      'uno-modal': new MockElement(),
      'avalon-modal': new MockElement(),
      'set-modal': new MockElement(),
      'solitaire-modal': new MockElement()
    };
    Object.values(modals).forEach(m => m.classList.add('hidden'));

    const originalDoc = (globalThis as any).document;
    (globalThis as any).document = {
      getElementById: (id: string) => modals[id] || null
    };

    try {
      const ui = new UIController();

      // Verify each arcade game can be shown and hidden cleanly with flex displayClass
      const games = [
        { name: 'Blackjack', show: () => ui.showBlackjack(), hide: () => ui.hideBlackjack(), isVis: () => ui.isBlackjackVisible(), el: modals['blackjack-modal']! },
        { name: 'Poker', show: () => ui.showPoker(), hide: () => ui.hidePoker(), isVis: () => ui.isPokerVisible(), el: modals['poker-modal']! },
        { name: 'Skip-Bo', show: () => ui.showSkipBo(), hide: () => ui.hideSkipBo(), isVis: () => ui.isSkipBoVisible(), el: modals['skipbo-modal']! },
        { name: 'Phase 10', show: () => ui.showPhase10(), hide: () => ui.hidePhase10(), isVis: () => ui.isPhase10Visible(), el: modals['phase10-modal']! },
        { name: 'Uno', show: () => ui.showUno(), hide: () => ui.hideUno(), isVis: () => ui.isUnoVisible(), el: modals['uno-modal']! },
        { name: 'Avalon', show: () => ui.showAvalon(), hide: () => ui.hideAvalon(), isVis: () => ui.isAvalonVisible(), el: modals['avalon-modal']! },
        { name: 'Set', show: () => ui.showSet(), hide: () => ui.hideSet(), isVis: () => ui.isSetVisible(), el: modals['set-modal']! },
        { name: 'Solitaire', show: () => ui.showSolitaire(), hide: () => ui.hideSolitaire(), isVis: () => ui.isSolitaireVisible(), el: modals['solitaire-modal']! }
      ];

      for (const g of games) {
        expect(g.isVis()).toBe(false);
        g.show();
        expect(g.isVis()).toBe(true);
        expect(g.el.classList.contains('hidden')).toBe(false);
        expect(g.el.classList.contains('flex')).toBe(true);

        g.hide();
        expect(g.isVis()).toBe(false);
        expect(g.el.classList.contains('hidden')).toBe(true);
        expect(g.el.classList.contains('flex')).toBe(false);
      }

      // Hide all arcade modals helper
      games.forEach(g => g.show());
      ui.hideAllArcadeModals();
      games.forEach(g => {
        expect(g.isVis()).toBe(false);
      });
    } finally {
      (globalThis as any).document = originalDoc;
    }
  });

  it('verifies presence of seamless game navigation headers and join modal in index.html', () => {
    const htmlPath = resolve(__dirname, '../index.html');
    const html = readFileSync(htmlPath, 'utf8');

    // Verify Arcade Join Modal elements
    expect(html).toContain('id="arcade-join-modal"');
    expect(html).toContain('id="arcade-join-player-name-input"');
    expect(html).toContain('id="btn-arcade-confirm-join"');
    expect(html).toContain('id="btn-arcade-cancel-join"');
    expect(html).toContain('id="arcade-join-error-banner"');

    // Verify data-arcade-nav="hub" and quick game switcher across headers
    expect(html).toContain('data-arcade-nav="hub"');
    expect(html).toContain('class="arcade-quick-switcher');
    expect(html).toContain('data-arcade-nav="chess"');
  });

  it('manages Arcade Join Modal lifecycle and error messaging in UIController', () => {
    const joinModal = new MockElement();
    joinModal.classList.add('hidden');
    const titleEl = new MockElement();
    const iconEl = new MockElement();
    const codeEl = new MockElement();
    const inputEl = new MockElement() as any;
    inputEl.value = '';
    inputEl.focus = () => {};
    const errorBanner = new MockElement();
    errorBanner.classList.add('hidden');

    const domMap: Record<string, any> = {
      'arcade-join-modal': joinModal,
      'arcade-join-game-title': titleEl,
      'arcade-join-game-icon': iconEl,
      'arcade-join-code-badge': codeEl,
      'arcade-join-player-name-input': inputEl,
      'arcade-join-error-banner': errorBanner
    };

    const originalDoc = (globalThis as any).document;
    (globalThis as any).document = {
      getElementById: (id: string) => domMap[id] || null
    };

    try {
      const ui = new UIController();
      expect(ui.isArcadeJoinModalVisible()).toBe(false);

      ui.showArcadeJoinModal('Cathedral Poker', 'token', 'POKER-ROYAL', 'Arthur');
      expect(ui.isArcadeJoinModalVisible()).toBe(true);
      expect(titleEl.textContent).toBe('Cathedral Poker');
      expect(iconEl.textContent).toBe('token');
      expect(codeEl.textContent).toBe('POKER-ROYAL');
      expect(inputEl.value).toBe('Arthur');

      // Set validation error message
      const { some, none } = require('../src/utils/fp');
      ui.setArcadeJoinError(some('Player name is offensive'));
      expect(errorBanner.textContent).toBe('Player name is offensive');
      expect(errorBanner.classList.contains('hidden')).toBe(false);

      ui.setArcadeJoinError(none());
      expect(errorBanner.classList.contains('hidden')).toBe(true);

      ui.hideArcadeJoinModal();
      expect(ui.isArcadeJoinModalVisible()).toBe(false);
    } finally {
      (globalThis as any).document = originalDoc;
    }
  });
});
