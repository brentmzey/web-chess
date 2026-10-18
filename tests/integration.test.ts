import { beforeEach, describe, expect, it } from 'bun:test';
import { Chess } from 'chess.js';
import {
  DIFFICULTY_PROFILES,
  GAME_MODES,
  getDifficultyProfile,
  getGameModeConfig
} from '../src/constants/board';
import { computeMinimaxMove, evaluateBoard } from '../src/engine/ai';
import {
  checkGeminiNanoStatus,
  computeGeminiNanoAIMove
} from '../src/engine/geminiNanoAI';
import { computeMicroNeuralAIMove, evaluateBoardNeural } from '../src/engine/neuralAI';
import {
  detectDeviceTier,
  getDeviceProfileConfig,
  setActiveDeviceTier
} from '../src/graphics/deviceTier';
import {
  auditEncryptedStorage,
  clearSessionState,
  getPersistencePreference,
  loadSavedSession,
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
import { UIController } from '../src/ui/uiController';

// Setup Mock IndexedDB and DOM for Full Integration Flows
class IntegrationIDB {
  public objectStoreNames = {
    contains: (name: string) => name in this.stores
  };
  private stores: Record<string, Map<string, any>> = {};

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
        }
      })
    };
  }
}

class MockDOMEl {
  public className = '';
  public textContent = '';
  public innerHTML = '';
  public title = '';
  public scrollTop = 0;
  public scrollHeight = 100;
  public attrs: Record<string, string> = {};
  public classList = {
    classes: new Set<string>(),
    add: (...cls: string[]) => cls.forEach(c => this.classList.classes.add(c)),
    remove: (...cls: string[]) => cls.forEach(c => this.classList.classes.delete(c)),
    contains: (c: string) => this.classList.classes.has(c)
  };
  setAttribute(k: string, v: string) {
    this.attrs[k] = v;
  }
  getAttribute(k: string) {
    return this.attrs[k] ?? null;
  }
}

describe('End-to-End Integration Suite: Pre-Game Rules, Play Styles, Difficulties, Mobile Tier & IndexedDB', () => {
  let domElements: Record<string, MockDOMEl>;

  beforeEach(() => {
    const db = new IntegrationIDB();
    db.createObjectStore('sanctuary_sessions');
    (globalThis as any).indexedDB = {
      open: () => {
        const req: any = { result: db };
        queueMicrotask(() => req.onsuccess?.({ target: req }));
        return req;
      }
    };

    domElements = {
      'turn-dot': new MockDOMEl(),
      'turn-text': new MockDOMEl(),
      'game-mode-badge': new MockDOMEl(),
      'difficulty-badge': new MockDOMEl(),
      'device-tier-badge': new MockDOMEl(),
      'mobile-lite-banner': new MockDOMEl(),
      'mobile-lite-banner-text': new MockDOMEl(),
      'status-banner': new MockDOMEl(),
      'status-banner-text': new MockDOMEl(),
      'captured-by-white': new MockDOMEl(),
      'captured-by-black': new MockDOMEl(),
      'shattered-black-list': new MockDOMEl(),
      'shattered-white-list': new MockDOMEl(),
      'move-count-pill': new MockDOMEl(),
      'move-history-container': new MockDOMEl(),
      'log-drawer': new MockDOMEl(),
      'gameover-modal': new MockDOMEl(),
      'gameover-title': new MockDOMEl(),
      'gameover-subtitle': new MockDOMEl(),
      'promotion-modal': new MockDOMEl(),
      'pregame-modal': new MockDOMEl(),
      'storage-audit-modal': new MockDOMEl(),
      'storage-audit-algo': new MockDOMEl(),
      'storage-audit-summary': new MockDOMEl(),
      'storage-audit-json': new MockDOMEl(),
      'btn-undo': new MockDOMEl(),
      'undo-icon': new MockDOMEl(),
      'undo-label': new MockDOMEl(),
      'undo-rule-status-pill': new MockDOMEl()
    };

    (globalThis as any).document = {
      getElementById: (id: string) => domElements[id] || null
    };
  });

  it('Integration Flow 1: Pre-Game Strict Mode (allowUndo=false) + Aggressive Minimax + Encrypted IndexedDB Persistence, Audit & Reload', async () => {
    const ui = new UIController();
    const chess = new Chess();

    // 1. User configures Game Settings: Minimax, Aggressive, allowUndo = false, Persistence = true
    const mode = GameModeEnum.Minimax;
    const difficulty = OpponentDifficultyEnum.Aggressive;
    const allowUndo = false;

    await setPersistencePreference(true);
    expect(await getPersistencePreference()).toBe(true);

    // 2. White plays 1. e4, Black replies with Aggressive Minimax
    chess.move('e4');
    const blackReply = computeMinimaxMove(chess, difficulty);
    expect(blackReply).not.toBeNull();
    chess.move(blackReply!);

    ui.update(chess, mode, undefined, difficulty, allowUndo);
    expect(domElements['btn-undo']?.getAttribute('aria-disabled')).toBe('true');
    expect(domElements['undo-icon']?.textContent).toBe('lock');
    expect(domElements['move-count-pill']?.textContent).toBe('2');

    // 3. Encrypt and persist state to IndexedDB
    const savedState: StoredSessionState = {
      id: SESSION_KEY,
      enabled: true,
      fen: chess.fen(),
      history: chess.history(),
      mode,
      difficulty,
      allowUndo,
      contrast: 120,
      brightness: 135,
      deviceTier: DeviceTierEnum.Desktop,
      timestamp: Date.now()
    };
    await saveSessionState(savedState);

    // 4. User audits stored data: receives ONLY encrypted ciphertext & AES-GCM-256 algorithm metadata
    const auditRes = await auditEncryptedStorage();
    expect(auditRes.isSuccess()).toBe(true);
    ui.renderStorageAudit(auditRes);
    expect(domElements['storage-audit-algo']?.textContent).toContain('AES-GCM-256');
    expect(domElements['storage-audit-summary']?.textContent).toContain('Plaintext Exposed: false');
    expect(domElements['storage-audit-json']?.textContent).not.toContain(chess.fen());

    // 5. Simulate browser refresh: new Chess instance decrypts and restores from IndexedDB
    const restoredChess = new Chess();
    const loadedOpt = await loadSavedSession();
    expect(loadedOpt.isSome()).toBe(true);

    const restored = loadedOpt.getOrElse(savedState);
    for (const san of restored.history) {
      restoredChess.move(san);
    }

    expect(restoredChess.fen()).toBe(chess.fen());
    expect(restoredChess.history().length).toBe(2);
    expect(restored.allowUndo).toBe(false);
    expect(restored.difficulty).toBe(OpponentDifficultyEnum.Aggressive);

    ui.update(restoredChess, restored.mode, undefined, restored.difficulty, restored.allowUndo);
    expect(domElements['undo-rule-status-pill']?.textContent).toBe('Undo: Locked (Strict)');
  });

  it('Integration Flow 2: Standard Mode (allowUndo=true) + Micro-Neural AI across all Difficulties + Round-Trip Undo', async () => {
    const ui = new UIController();
    const chess = new Chess();
    const mode = GameModeEnum.MicroNeural;
    const allowUndo = true;

    for (const diff of [
      OpponentDifficultyEnum.Cautious,
      OpponentDifficultyEnum.Balanced,
      OpponentDifficultyEnum.Aggressive
    ]) {
      const diffProfile = getDifficultyProfile(diff);
      expect(diffProfile.styleDescriptions[mode]).toBeTruthy();

      // White move
      const wMoves = chess.moves();
      chess.move(wMoves[0]!);

      // Black Micro-Neural AI reply
      const aiMove = computeMicroNeuralAIMove(chess, diff);
      expect(aiMove).not.toBeNull();
      chess.move(aiMove!);
    }

    expect(chess.history().length).toBe(6);
    ui.update(chess, mode, undefined, OpponentDifficultyEnum.Balanced, allowUndo);
    expect(domElements['btn-undo']?.getAttribute('aria-disabled')).toBe('false');

    // Perform round-trip undo (undoes Black AI reply + White move)
    chess.undo();
    chess.undo();
    expect(chess.history().length).toBe(4);
    expect(chess.turn()).toBe('w');
  });

  it('Integration Flow 3: Gemini Nano Local LLM lifecycle (ready, downloadable, prompt match, invalid fallback, error fallback)', async () => {
    const chess = new Chess();
    chess.move('e4');

    // Case A: window.ai ready and returns valid move
    (globalThis as any).window = {
      ai: {
        languageModel: {
          capabilities: async () => ({ available: 'readily' }),
          create: async () => ({
            prompt: async () => 'c5',
            destroy: () => {}
          })
        }
      }
    };

    const readyStatus = await checkGeminiNanoStatus();
    expect(readyStatus.available).toBe(true);
    expect(readyStatus.status).toBe('ready');

    const resA = await computeGeminiNanoAIMove(
      chess,
      undefined,
      OpponentDifficultyEnum.Balanced
    );
    expect(resA.source).toBe('nano');
    expect(resA.move?.san).toBe('c5');

    // Case B: window.ai downloadable and returns conversational invalid move -> falls back to Neural AI
    (globalThis as any).window = {
      ai: {
        languageModel: {
          capabilities: async () => ({ available: 'after-download' }),
          create: async () => ({
            prompt: async () => 'I cannot decide on a legal move',
            destroy: () => {}
          })
        }
      }
    };

    const dlStatus = await checkGeminiNanoStatus();
    expect(dlStatus.available).toBe(true);
    expect(dlStatus.status).toBe('downloadable');

    const resB = await computeGeminiNanoAIMove(
      chess,
      undefined,
      OpponentDifficultyEnum.Cautious
    );
    expect(resB.source).toBe('fallback');
    expect(resB.move).not.toBeNull();

    // Case C: window.ai prompt throws exception -> falls back to Neural AI
    (globalThis as any).window = {
      ai: {
        assistant: {
          capabilities: async () => ({ available: 'readily' }),
          create: async () => ({
            prompt: async () => {
              throw new Error('GPU context busy');
            }
          })
        }
      }
    };

    const resC = await computeGeminiNanoAIMove(
      chess,
      undefined,
      OpponentDifficultyEnum.Aggressive
    );
    expect(resC.source).toBe('fallback');
    expect(resC.move).not.toBeNull();

    // Case D: capabilities returns 'no' or throws error
    (globalThis as any).window = {
      ai: {
        languageModel: {
          capabilities: async () => ({ available: 'no' })
        }
      }
    };
    const noStatus = await checkGeminiNanoStatus();
    expect(noStatus.available).toBe(false);

    (globalThis as any).window = {
      ai: {
        languageModel: {
          capabilities: async () => {
            throw new Error('Capabilities rejected');
          }
        }
      }
    };
    const errStatus = await checkGeminiNanoStatus();
    expect(errStatus.available).toBe(false);
    expect(errStatus.message).toContain('Capabilities rejected');
  });

  it('Integration Flow 4: Mobile Sanctuary Lite strips desktop-only modes and adapts UI & Engine edge states', async () => {
    (globalThis as any).window = { innerWidth: 360, innerHeight: 640 };
    (globalThis as any).navigator = {
      hardwareConcurrency: 2,
      deviceMemory: 2,
      maxTouchPoints: 5
    };

    const tier = detectDeviceTier();
    expect(tier).toBe(DeviceTierEnum.MobileLite);
    const profile = setActiveDeviceTier(tier);
    expect(getDeviceProfileConfig(tier).antialias).toBe(false);

    const mobileModes = GAME_MODES.filter(
      m => !(profile.tier === DeviceTierEnum.MobileLite && m.desktopOnly)
    );
    expect(mobileModes.some(m => m.id === GameModeEnum.GeminiNano)).toBe(false);
    expect(mobileModes.length).toBe(3);

    expect(getGameModeConfig('unknown' as any).id).toBe(GameModeEnum.Minimax);
    expect(getDifficultyProfile('unknown' as any).id).toBe(
      OpponentDifficultyEnum.Balanced
    );
    expect(DIFFICULTY_PROFILES.length).toBe(3);

    // Verify mate-in-1 (oppMoves.length === 0) and draw / zero-legal-moves edge cases in engines
    const mateInOneFen = 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2';
    const mateGame1 = new Chess(mateInOneFen);
    expect(computeMinimaxMove(mateGame1, OpponentDifficultyEnum.Balanced)?.san).toBe('Qh4#');
    const mateGame2 = new Chess(mateInOneFen);
    expect(computeMicroNeuralAIMove(mateGame2, OpponentDifficultyEnum.Balanced)?.san).toBe('Qh4#');

    const stalemateFen = '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1';
    const drawGame = new Chess(stalemateFen);
    expect(drawGame.in_draw()).toBe(true);
    expect(evaluateBoard(drawGame)).toBe(0);
    expect(evaluateBoardNeural(drawGame)).toBe(0);
    expect(computeMinimaxMove(drawGame)).toBeNull();
    expect(computeMicroNeuralAIMove(drawGame)).toBeNull();
    const nanoNoMoves = await computeGeminiNanoAIMove(drawGame);
    expect(nanoNoMoves.move).toBeNull();

    // Headless window === undefined fallback for detectDeviceTier
    (globalThis as any).window = undefined;
    expect(detectDeviceTier()).toBe(DeviceTierEnum.Desktop);

    await clearSessionState();
  });
});
