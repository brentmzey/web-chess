import { beforeEach, describe, expect, it } from 'bun:test';
import {
  ChessStore,
  INITIAL_BOARD_FEN
} from '../src/store/chessStore';
import {
  ChessThemeEnum,
  DeviceTierEnum,
  GameModeEnum,
  OpponentDifficultyEnum,
  StorageLoadStatusEnum
} from '../src/types';
import { some } from '../src/utils/fp';

// Mock in-memory IndexedDB for Store Unit Tests
class MockStoreIDB {
  public stores: Record<string, Map<string, any>> = {};
  public objectStoreNames = {
    contains: (name: string) => name in this.stores
  };

  createObjectStore(name: string) {
    this.stores[name] = new Map();
    return {};
  }

  transaction(storeNames: string[]) {
    const store = this.stores[storeNames[0]!] || new Map();
    return {
      objectStore: () => ({
        get: (key: string) => {
          const req: any = {};
          queueMicrotask(() => {
            req.result = store.get(key);
            req.onsuccess?.({ target: req });
          });
          return req;
        },
        put: (val: any) => {
          const req: any = {};
          queueMicrotask(() => {
            store.set(val.id, val);
            req.result = val.id;
            req.onsuccess?.({ target: req });
          });
          return req;
        },
        delete: (key: string) => {
          const req: any = {};
          queueMicrotask(() => {
            store.delete(key);
            req.onsuccess?.({ target: req });
          });
          return req;
        },
        clear: () => {
          const req: any = {};
          queueMicrotask(() => {
            store.clear();
            req.onsuccess?.({ target: req });
          });
          return req;
        }
      })
    };
  }
}

describe('ChessStore: Centralized Reactive State Store & Tab-Refresh Persistence', () => {
  let mockDb: MockStoreIDB;

  beforeEach(() => {
    mockDb = new MockStoreIDB();
    mockDb.createObjectStore('sanctuary_sessions');
    (globalThis as any).indexedDB = {
      open: () => {
        const req: any = { result: mockDb };
        queueMicrotask(() => req.onsuccess?.({ target: req }));
        return req;
      }
    };
  });

  it('initializes with default state and reports hydration status', () => {
    const store = new ChessStore();
    const state = store.getState();

    expect(state.fen).toBe(INITIAL_BOARD_FEN);
    expect(state.history).toEqual([]);
    expect(state.mode).toBe(GameModeEnum.Minimax);
    expect(state.difficulty).toBe(OpponentDifficultyEnum.Balanced);
    expect(state.allowUndo).toBe(true);
    expect(state.theme).toBe(ChessThemeEnum.GothicBasilica);
    expect(state.useActionCam).toBe(true);
    expect(state.gameStarted).toBe(false);
    expect(state.persistenceEnabled).toBe(true);
    expect(store.getIsHydrated()).toBe(false);
  });

  it('updates state immutably and notifies subscribers', () => {
    const store = new ChessStore();
    const notifications: Array<{ next: string; prev: string }> = [];

    const unsubscribe = store.subscribe((next, prev) => {
      notifications.push({ next: next.theme, prev: prev.theme });
    });

    store.setState({ theme: ChessThemeEnum.EmeraldCitadel });
    expect(store.getState().theme).toBe(ChessThemeEnum.EmeraldCitadel);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.prev).toBe(ChessThemeEnum.GothicBasilica);
    expect(notifications[0]?.next).toBe(ChessThemeEnum.EmeraldCitadel);

    // Functional updater callback
    store.setState(prev => ({ contrast: prev.contrast + 10 }));
    expect(store.getState().contrast).toBe(110);
    expect(notifications).toHaveLength(2);

    unsubscribe();
    store.setState({ theme: ChessThemeEnum.AstralObservatory });
    // Subscriber was removed, so count remains 2
    expect(notifications).toHaveLength(2);
  });

  it('saves encrypted state to storage when persistence is enabled', async () => {
    const store = new ChessStore({
      fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2',
      history: ['e4', 'e5'],
      mode: GameModeEnum.MicroNeural,
      difficulty: OpponentDifficultyEnum.Aggressive,
      theme: ChessThemeEnum.CrimsonInquisition,
      gameStarted: true
    });

    const res = await store.saveToStorage();
    expect(res.isSuccess()).toBe(true);
    expect(store.getState().lastPersistedTimestamp).toBeGreaterThan(0);

    // Verify stored in IndexedDB mock
    const raw = mockDb.stores['sanctuary_sessions']?.get('active_session');
    expect(raw).toBeDefined();
    expect(raw.envelope.v).toBe(1);
    expect(raw.envelope.alg).toBe('AES-GCM-256');
  });

  it('skips saving to storage when persistence is disabled', async () => {
    const store = new ChessStore({ persistenceEnabled: false });
    const res = await store.saveToStorage();
    expect(res.isSuccess()).toBe(true);

    const raw = mockDb.stores['sanctuary_sessions']?.get('active_session');
    expect(raw).toBeUndefined();
  });

  it('hydrates state from storage across simulated tab refresh', async () => {
    const originalStore = new ChessStore({
      fen: 'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2',
      history: ['e4', 'c5'],
      mode: GameModeEnum.Minimax,
      difficulty: OpponentDifficultyEnum.Aggressive,
      allowUndo: false,
      theme: ChessThemeEnum.AstralObservatory,
      useActionCam: false,
      contrast: 115,
      brightness: 125,
      gameStarted: true
    });
    await originalStore.saveToStorage();

    // Fresh store simulating a tab reload
    const reloadedStore = new ChessStore();
    expect(reloadedStore.getIsHydrated()).toBe(false);

    const outcome = await reloadedStore.hydrate();
    expect(outcome.status).toBe(StorageLoadStatusEnum.Restored);
    expect(reloadedStore.getIsHydrated()).toBe(true);

    const state = reloadedStore.getState();
    expect(state.fen).toBe('rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2');
    expect(state.history).toEqual(['e4', 'c5']);
    expect(state.mode).toBe(GameModeEnum.Minimax);
    expect(state.difficulty).toBe(OpponentDifficultyEnum.Aggressive);
    expect(state.allowUndo).toBe(false);
    expect(state.theme).toBe(ChessThemeEnum.AstralObservatory);
    expect(state.useActionCam).toBe(false);
    expect(state.contrast).toBe(115);
    expect(state.brightness).toBe(125);
    expect(state.gameStarted).toBe(true);
  });

  it('adapts GeminiNano to MicroNeural when restoring on MobileLite tier', async () => {
    const originalStore = new ChessStore({
      mode: GameModeEnum.GeminiNano,
      deviceTier: DeviceTierEnum.Desktop,
      gameStarted: true
    });
    await originalStore.saveToStorage();

    const mobileStore = new ChessStore({
      deviceTier: DeviceTierEnum.MobileLite
    });
    const outcome = await mobileStore.hydrate();
    expect(outcome.status).toBe(StorageLoadStatusEnum.Restored);
    expect(mobileStore.getState().mode).toBe(GameModeEnum.MicroNeural);
  });

  it('handles empty storage on initial boot gracefully', async () => {
    const store = new ChessStore();
    const outcome = await store.hydrate();
    expect(outcome.status).toBe(StorageLoadStatusEnum.Empty);
    expect(store.getState().fen).toBe(INITIAL_BOARD_FEN);
    expect(store.getState().history).toEqual([]);
    expect(store.getIsHydrated()).toBe(true);
  });

  it('handles persistence disabled preference during hydration', async () => {
    const store = new ChessStore();
    await store.setPersistence(false);

    const reloadedStore = new ChessStore();
    const outcome = await reloadedStore.hydrate();
    expect(outcome.status).toBe(StorageLoadStatusEnum.Empty);
    expect(reloadedStore.getState().persistenceEnabled).toBe(false);
  });

  it('toggles persistence preference and clears or persists records accordingly', async () => {
    const store = new ChessStore({ history: ['d4'] });
    await store.setPersistence(true);
    expect(mockDb.stores['sanctuary_sessions']?.get('active_session')).toBeDefined();

    await store.setPersistence(false);
    expect(store.getState().persistenceEnabled).toBe(false);
    expect(mockDb.stores['sanctuary_sessions']?.get('active_session')).toBeUndefined();
  });

  it('resets match state and immediately persists to storage', async () => {
    const store = new ChessStore({
      fen: 'some-active-fen',
      history: ['e4', 'e5', 'Nf3'],
      gameStarted: true,
      selectedSquare: some('e4'),
      legalMovesForSelected: ['e5'],
      isThinking: true,
      isGameOver: true,
      gameOverTitle: some('Checkmate'),
      gameOverSubtitle: some('White wins')
    });

    await store.resetMatch({ mode: GameModeEnum.MicroNeural });

    const state = store.getState();
    expect(state.fen).toBe(INITIAL_BOARD_FEN);
    expect(state.history).toEqual([]);
    expect(state.mode).toBe(GameModeEnum.MicroNeural);
    expect(state.selectedSquare.isNone()).toBe(true);
    expect(state.legalMovesForSelected).toEqual([]);
    expect(state.isThinking).toBe(false);
    expect(state.isGameOver).toBe(false);
    expect(state.gameOverTitle.isNone()).toBe(true);
    expect(state.gameStarted).toBe(true);
  });

  it('wipes all storage and resets store state to defaults', async () => {
    const store = new ChessStore({
      history: ['e4'],
      theme: ChessThemeEnum.EmeraldCitadel
    });
    await store.saveToStorage();
    expect(mockDb.stores['sanctuary_sessions']?.size).toBeGreaterThan(0);

    const wipeRes = await store.wipeAll();
    expect(wipeRes.isSuccess()).toBe(true);
    expect(store.getState().history).toEqual([]);
    expect(store.getState().theme).toBe(ChessThemeEnum.GothicBasilica);
    expect(mockDb.stores['sanctuary_sessions']?.size).toBe(0);
  });

  it('attaches and triggers lifecycle listeners for pagehide and visibilitychange', async () => {
    const store = new ChessStore({ history: ['e4', 'e5'] });
    let pagehideListener: (() => void) | null = null;
    let beforeunloadListener: (() => void) | null = null;
    let visibilityListener: (() => void) | null = null;

    const mockWindow: any = {
      addEventListener: (evt: string, fn: () => void) => {
        if (evt === 'pagehide') pagehideListener = fn;
        if (evt === 'beforeunload') beforeunloadListener = fn;
      },
      removeEventListener: (_evt: string, _fn: () => void) => {}
    };

    const mockDoc: any = {
      visibilityState: 'visible',
      addEventListener: (evt: string, fn: () => void) => {
        if (evt === 'visibilitychange') visibilityListener = fn;
      },
      removeEventListener: (_evt: string, _fn: () => void) => {}
    };

    const teardown = store.setupLifecycleListeners(mockWindow, mockDoc);
    expect(pagehideListener).toBeDefined();
    expect(beforeunloadListener).toBeDefined();
    expect(visibilityListener).toBeDefined();

    // Trigger pagehide -> flushes to storage
    pagehideListener!();
    await new Promise(r => setTimeout(r, 15));
    expect(mockDb.stores['sanctuary_sessions']?.get('active_session')).toBeDefined();

    mockDb.stores['sanctuary_sessions']?.delete('active_session');

    // Trigger beforeunload -> flushes to storage
    beforeunloadListener!();
    await new Promise(r => setTimeout(r, 15));
    expect(mockDb.stores['sanctuary_sessions']?.get('active_session')).toBeDefined();

    mockDb.stores['sanctuary_sessions']?.delete('active_session');

    // Trigger visibilitychange with visible (no flush) vs hidden (flush)
    mockDoc.visibilityState = 'visible';
    visibilityListener!();
    await new Promise(r => setTimeout(r, 15));
    expect(mockDb.stores['sanctuary_sessions']?.get('active_session')).toBeUndefined();

    mockDoc.visibilityState = 'hidden';
    visibilityListener!();
    await new Promise(r => setTimeout(r, 15));
    expect(mockDb.stores['sanctuary_sessions']?.get('active_session')).toBeDefined();

    teardown();
  });

  it('handles Unavailable storage outcome by disabling persistence', async () => {
    (globalThis as any).indexedDB = undefined;
    const store = new ChessStore({ persistenceEnabled: true });
    const outcome = await store.loadFromStorage();
    expect(outcome.status).toBe(StorageLoadStatusEnum.Unavailable);
    expect(store.getState().persistenceEnabled).toBe(false);
  });

  it('handles Unreadable storage outcome gracefully without throwing', async () => {
    // Put corrupted envelope in mockDb
    mockDb.stores['sanctuary_sessions']?.set('active_session', {
      id: 'active_session',
      envelope: {
        v: 1,
        alg: 'AES-GCM-256',
        iv: 'invalid-iv',
        ciphertext: 'corrupted-ciphertext=='
      }
    });

    const store = new ChessStore();
    const outcome = await store.loadFromStorage();
    expect(outcome.status).toBe(StorageLoadStatusEnum.Unreadable);
    expect(store.getState().fen).toBe(INITIAL_BOARD_FEN);
  });
});
