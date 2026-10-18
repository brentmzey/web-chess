import { beforeEach, describe, expect, it } from 'bun:test';
import {
  clearSessionState,
  getPersistencePreference,
  loadSavedSession,
  openSessionDatabase,
  saveSessionState,
  SESSION_KEY,
  setPersistencePreference
} from '../src/storage/indexedDbStore';
import {
  DeviceTierEnum,
  GameModeEnum,
  OpponentDifficultyEnum,
  type StoredSessionState
} from '../src/types';

// In-Memory IndexedDB Mock for Unit Tests
class MockIDBDatabase {
  public objectStoreNames = {
    contains: (name: string) => name in this.stores
  };
  private stores: Record<string, Map<string, any>> = {};

  createObjectStore(name: string, _options?: any) {
    this.stores[name] = new Map();
    return {};
  }

  transaction(storeNames: string[], _mode: string) {
    const store = this.stores[storeNames[0]!] || new Map();
    return {
      objectStore: (_name: string) => ({
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
        }
      })
    };
  }
}

function setupMockIndexedDB() {
  const db = new MockIDBDatabase();
  db.createObjectStore('sanctuary_sessions', { keyPath: 'id' });

  (globalThis as any).indexedDB = {
    open: (_name: string, _version: number) => {
      const req: any = {
        result: db
      };
      queueMicrotask(() => {
        req.onsuccess?.({ target: req });
      });
      return req;
    }
  };
}

describe('IndexedDB Sanctuary Session Persistence (No LocalStorage)', () => {
  beforeEach(() => {
    setupMockIndexedDB();
  });

  it('connects to IndexedDB successfully', async () => {
    const dbRes = await openSessionDatabase();
    expect(dbRes.isSuccess()).toBe(true);
  });

  it('reads and writes persistence preference', async () => {
    let pref = await getPersistencePreference();
    expect(pref).toBe(false);

    await setPersistencePreference(true);
    pref = await getPersistencePreference();
    expect(pref).toBe(true);

    await setPersistencePreference(false);
    pref = await getPersistencePreference();
    expect(pref).toBe(false);
  });

  it('persists and loads active chess session state including difficulty and allowUndo', async () => {
    const mockSession: StoredSessionState = {
      id: SESSION_KEY,
      enabled: true,
      fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
      history: ['e4'],
      mode: GameModeEnum.Minimax,
      difficulty: OpponentDifficultyEnum.Aggressive,
      allowUndo: false,
      contrast: 125,
      brightness: 110,
      deviceTier: DeviceTierEnum.Desktop,
      timestamp: Date.now()
    };

    const saveRes = await saveSessionState(mockSession);
    expect(saveRes.isSuccess()).toBe(true);

    const loadedOpt = await loadSavedSession();
    expect(loadedOpt.isSome()).toBe(true);

    const loaded = loadedOpt.fold(
      () => {
        throw new Error('Expected session');
      },
      s => s
    );
    expect(loaded.fen).toBe(mockSession.fen);
    expect(loaded.history).toEqual(['e4']);
    expect(loaded.mode).toBe(GameModeEnum.Minimax);
    expect(loaded.difficulty).toBe(OpponentDifficultyEnum.Aggressive);
    expect(loaded.allowUndo).toBe(false);
    expect(loaded.contrast).toBe(125);
    expect(loaded.brightness).toBe(110);
    expect(loaded.deviceTier).toBe(DeviceTierEnum.Desktop);
  });

  it('clears session state on command', async () => {
    const mockSession: StoredSessionState = {
      id: SESSION_KEY,
      enabled: true,
      fen: '8/8/8/8/8/8/8/8 w - - 0 1',
      history: [],
      mode: GameModeEnum.MicroNeural,
      difficulty: OpponentDifficultyEnum.Cautious,
      allowUndo: true,
      contrast: 100,
      brightness: 100,
      deviceTier: DeviceTierEnum.MobileLite,
      timestamp: Date.now()
    };

    await saveSessionState(mockSession);
    const loadedBefore = await loadSavedSession();
    expect(loadedBefore.isSome()).toBe(true);

    const clearRes = await clearSessionState();
    expect(clearRes.isSuccess()).toBe(true);

    const loadedAfter = await loadSavedSession();
    expect(loadedAfter.isNone()).toBe(true);
  });

  it('handles onupgradeneeded schema creation and missing indexedDB gracefully', async () => {
    // 1. Trigger onupgradeneeded when store does not yet exist
    const freshDb = new MockIDBDatabase();
    (globalThis as any).indexedDB = {
      open: () => {
        const req: any = { result: freshDb };
        queueMicrotask(() => {
          req.onupgradeneeded?.({ target: req });
          req.onsuccess?.({ target: req });
        });
        return req;
      }
    };
    const openUpgrade = await openSessionDatabase();
    expect(openUpgrade.isSuccess()).toBe(true);

    // 2. Missing indexedDB environment fallback
    (globalThis as any).indexedDB = undefined;
    expect((await openSessionDatabase()).isFailure()).toBe(true);
    expect((await loadSavedSession()).isNone()).toBe(true);
    expect((await saveSessionState({} as any)).isFailure()).toBe(true);
    expect((await clearSessionState()).isFailure()).toBe(true);
    expect(await getPersistencePreference()).toBe(false);
    expect((await setPersistencePreference(true)).isFailure()).toBe(true);
  });
});
