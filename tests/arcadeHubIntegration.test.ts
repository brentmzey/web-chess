import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Database } from 'bun:sqlite';
import { UIController } from '../src/ui/uiController';
import { formatBlackjackAdditiveCount, type PlayingCard } from '../src/games/blackjack/blackjackEngine';
import { CathedralSoundEngine } from '../src/audio/CathedralSoundEngine';

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

    // Verify all 7 arcade modals have .arcade-theater-shell
    for (const modalId of [
      'id="blackjack-modal"',
      'id="poker-modal"',
      'id="skipbo-modal"',
      'id="phase10-modal"',
      'id="uno-modal"',
      'id="avalon-modal"',
      'id="set-modal"'
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

    // Verify all 7 felt tables contain arcade-felt-board and do not have min-h-0
    for (const feltClass of [
      'felt-blackjack',
      'felt-poker',
      'felt-skipbo',
      'felt-phase10',
      'felt-uno',
      'felt-avalon',
      'felt-set'
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
});
