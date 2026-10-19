import { beforeEach, describe, expect, it } from 'bun:test';
import {
  auditEncryptedStorage,
  base64ToBytes,
  bytesToBase64,
  clearSessionState,
  DB_NAME,
  decryptPayload,
  ENCRYPTION_ALGORITHM,
  ENCRYPTION_CIPHER_MODE,
  ENCRYPTION_IV_BYTES,
  ENCRYPTION_KEY_BITS,
  encryptPayload,
  getPersistencePreference,
  isEncryptedEnvelope,
  loadSavedSession,
  openSessionDatabase,
  PREFERENCE_KEY,
  saveSessionState,
  SESSION_KEY,
  setPersistencePreference,
  STORE_NAME
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
  public stores: Record<string, Map<string, any>> = {};

  createObjectStore(name: string, _options?: any) {
    this.stores[name] = new Map();
    return {};
  }

  getRawRecord(storeName: string, key: string): any {
    return this.stores[storeName]?.get(key);
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

let activeMockDb: MockIDBDatabase;

function setupMockIndexedDB() {
  activeMockDb = new MockIDBDatabase();
  activeMockDb.createObjectStore('sanctuary_sessions', { keyPath: 'id' });

  (globalThis as any).indexedDB = {
    open: (_name: string, _version: number) => {
      const req: any = {
        result: activeMockDb
      };
      queueMicrotask(() => {
        req.onsuccess?.({ target: req });
      });
      return req;
    }
  };
}

describe('Encrypted IndexedDB Session Persistence (AES-GCM-256, Functional Monads, No LocalStorage)', () => {
  beforeEach(() => {
    setupMockIndexedDB();
  });

  it('connects to IndexedDB successfully', async () => {
    const dbRes = await openSessionDatabase();
    expect(dbRes.isSuccess()).toBe(true);
  });

  it('encrypts payloads with AES-GCM-256 and unique random IVs, and decrypts back to original value', async () => {
    const sample = { fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR', allowUndo: false };
    const enc1 = await encryptPayload(sample);
    const enc2 = await encryptPayload(sample);

    expect(enc1.isSuccess()).toBe(true);
    expect(enc2.isSuccess()).toBe(true);

    const env1 = enc1.getOrElse({ v: 1, alg: 'AES-GCM-256', iv: '', ciphertext: '' });
    const env2 = enc2.getOrElse({ v: 1, alg: 'AES-GCM-256', iv: '', ciphertext: '' });

    expect(isEncryptedEnvelope(env1)).toBe(true);
    expect(isEncryptedEnvelope(null)).toBe(false);
    expect(isEncryptedEnvelope({ v: 1, alg: 'AES-GCM-256', iv: '', ciphertext: '' })).toBe(false);

    expect(env1.alg).toBe('AES-GCM-256');
    expect(env1.v).toBe(1);
    // Random 12-byte IV ensures semantic security (distinct ciphertexts for identical plaintexts)
    expect(env1.iv).not.toBe(env2.iv);
    expect(env1.ciphertext).not.toBe(env2.ciphertext);

    const dec1 = await decryptPayload<typeof sample>(env1);
    expect(dec1.isSuccess()).toBe(true);
    expect(dec1.getOrElse({ fen: '', allowUndo: true })).toEqual(sample);
  });

  it('rejects tampered ciphertext, invalid Base64, or malformed envelopes during decryption', async () => {
    const validRes = await encryptPayload({ secret: 'checkmate' });
    const validEnv = validRes.getOrElse({ v: 1, alg: 'AES-GCM-256', iv: '', ciphertext: '' });

    // Tamper with ciphertext bytes
    const rawCipher = base64ToBytes(validEnv.ciphertext).getOrElse(new Uint8Array(0));
    rawCipher[0] = (rawCipher[0]! ^ 0xff) & 0xff;
    const tamperedEnv = {
      ...validEnv,
      ciphertext: bytesToBase64(rawCipher)
    };
    const tamperedResult = await decryptPayload(tamperedEnv);
    expect(tamperedResult.isFailure()).toBe(true);

    // Invalid Base64
    expect(base64ToBytes('%%%not-base64%%%').isFailure()).toBe(true);
    const badB64Result = await decryptPayload({
      v: 1,
      alg: 'AES-GCM-256',
      iv: '%%%invalid%%%',
      ciphertext: validEnv.ciphertext
    });
    expect(badB64Result.isFailure()).toBe(true);

    // Null or unencrypted envelope
    expect((await decryptPayload(null)).isFailure()).toBe(true);
    expect((await decryptPayload({ v: 2, alg: 'NONE' })).isFailure()).toBe(true);

    // Simulate Web Crypto encrypt failure and importKey failure
    const origEncrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    const origImportKey = crypto.subtle.importKey.bind(crypto.subtle);

    (crypto.subtle as any).encrypt = async () => {
      throw new Error('Crypto hardware error');
    };
    expect((await encryptPayload({ a: 1 })).isFailure()).toBe(true);
    (crypto.subtle as any).encrypt = origEncrypt;

    (crypto.subtle as any).importKey = async () => {
      throw new Error('Key import blocked');
    };
    expect((await encryptPayload({ a: 1 })).isFailure()).toBe(true);
    (crypto.subtle as any).importKey = origImportKey;
  });

  it('encrypts persistence preference in IndexedDB and decrypts when fetching (defaulting to true)', async () => {
    let pref = await getPersistencePreference();
    expect(pref).toBe(true);

    await setPersistencePreference(false);
    const rawPrefRecord = activeMockDb.getRawRecord('sanctuary_sessions', PREFERENCE_KEY);
    expect(rawPrefRecord).toBeDefined();
    expect(rawPrefRecord.enabled).toBeUndefined(); // Never stored in plaintext!
    expect(rawPrefRecord.envelope?.alg).toBe('AES-GCM-256');

    pref = await getPersistencePreference();
    expect(pref).toBe(false);

    await setPersistencePreference(true);
    pref = await getPersistencePreference();
    expect(pref).toBe(true);
  });


  it('encrypts active chess session state on write and decrypts on load', async () => {
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

    // Verify raw IndexedDB object contains ONLY encrypted envelope, no plaintext FEN or history
    const rawStored = activeMockDb.getRawRecord('sanctuary_sessions', SESSION_KEY);
    expect(rawStored).toBeDefined();
    expect(rawStored.fen).toBeUndefined();
    expect(rawStored.history).toBeUndefined();
    expect(rawStored.allowUndo).toBeUndefined();
    expect(rawStored.envelope?.alg).toBe('AES-GCM-256');
    expect(typeof rawStored.envelope?.ciphertext).toBe('string');

    const loadedOpt = await loadSavedSession();
    expect(loadedOpt.isSome()).toBe(true);

    const loaded = loadedOpt.fold(
      () => {
        throw new Error('Expected decrypted session');
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

  it('audits stored data returning ONLY encrypted AES-GCM-256 envelopes and algorithm metadata (zero plaintext exposed)', async () => {
    // 1. Audit empty database
    const emptyAuditRes = await auditEncryptedStorage();
    expect(emptyAuditRes.isSuccess()).toBe(true);
    const emptyReport = emptyAuditRes.fold(
      err => {
        throw new Error(err);
      },
      r => r
    );
    expect(emptyReport.database).toBe(DB_NAME);
    expect(emptyReport.objectStore).toBe(STORE_NAME);
    expect(emptyReport.algorithm).toBe(ENCRYPTION_ALGORITHM);
    expect(emptyReport.keyLengthBits).toBe(ENCRYPTION_KEY_BITS);
    expect(emptyReport.ivLengthBytes).toBe(ENCRYPTION_IV_BYTES);
    expect(emptyReport.cipherMode).toBe(ENCRYPTION_CIPHER_MODE);
    expect(emptyReport.localStorageUsed).toBe(false);
    expect(emptyReport.plaintextExposed).toBe(false);
    expect(emptyReport.recordCount).toBe(0);
    expect(emptyReport.records).toEqual([]);

    // 2. Store preference + session state, then audit
    await setPersistencePreference(true);
    const secretFen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
    await saveSessionState({
      id: SESSION_KEY,
      enabled: true,
      fen: secretFen,
      history: ['e4', 'e5', 'Nf3', 'Nc6'],
      mode: GameModeEnum.MicroNeural,
      difficulty: OpponentDifficultyEnum.Aggressive,
      allowUndo: false,
      contrast: 120,
      brightness: 115,
      deviceTier: DeviceTierEnum.Desktop,
      timestamp: Date.now()
    });

    const fullAuditRes = await auditEncryptedStorage();
    expect(fullAuditRes.isSuccess()).toBe(true);
    const report = fullAuditRes.fold(
      err => {
        throw new Error(err);
      },
      r => r
    );

    expect(report.algorithm).toBe('AES-GCM-256');
    expect(report.keyLengthBits).toBe(256);
    expect(report.ivLengthBytes).toBe(12);
    expect(report.plaintextExposed).toBe(false);
    expect(report.localStorageUsed).toBe(false);
    expect(report.recordCount).toBe(2);

    const serializedAudit = JSON.stringify(report);
    // Guarantee zero plaintext is present anywhere in the audit report
    expect(serializedAudit).not.toContain(secretFen);
    expect(serializedAudit).not.toContain('Nf3');
    expect(serializedAudit).not.toContain('micro-neural');

    for (const rec of report.records) {
      expect(rec.envelope.v).toBe(1);
      expect(rec.envelope.alg).toBe('AES-GCM-256');
      expect(rec.envelope.iv.length).toBeGreaterThan(0);
      expect(rec.envelope.ciphertext.length).toBeGreaterThan(0);
    }
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

  it('handles onupgradeneeded schema creation, request errors, and missing indexedDB gracefully', async () => {
    // 1. Trigger onupgradeneeded when store does not yet exist, and second time when it already exists
    const freshDb = new MockIDBDatabase();
    (globalThis as any).indexedDB = {
      open: () => {
        const req: any = { result: freshDb };
        queueMicrotask(() => {
          req.onupgradeneeded?.({ target: req });
          req.onupgradeneeded?.({ target: req });
          req.onsuccess?.({ target: req });
        });
        return req;
      }
    };
    const openUpgrade = await openSessionDatabase();
    expect(openUpgrade.isSuccess()).toBe(true);

    // 2. Trigger IDB request error callbacks (open, get, put, delete)
    (globalThis as any).indexedDB = {
      open: () => {
        const req: any = { error: { message: 'Open denied' } };
        queueMicrotask(() => req.onerror?.());
        return req;
      }
    };
    expect((await openSessionDatabase()).isFailure()).toBe(true);

    // DB where get/put/delete trigger onerror
    (globalThis as any).indexedDB = {
      open: () => {
        const req: any = {
          result: {
            transaction: () => ({
              objectStore: () => ({
                get: () => {
                  const r: any = {};
                  queueMicrotask(() => r.onerror?.());
                  return r;
                },
                put: () => {
                  const r: any = {};
                  queueMicrotask(() => r.onerror?.());
                  return r;
                },
                delete: () => {
                  const r: any = {};
                  queueMicrotask(() => r.onerror?.());
                  return r;
                }
              })
            })
          }
        };
        queueMicrotask(() => req.onsuccess?.({ target: req }));
        return req;
      }
    };
    expect((await loadSavedSession()).isNone()).toBe(true);
    expect((await saveSessionState({} as any)).isFailure()).toBe(true);
    expect((await clearSessionState()).isFailure()).toBe(true);
    expect((await auditEncryptedStorage()).isFailure()).toBe(true);

    // 3. Missing indexedDB environment fallback
    (globalThis as any).indexedDB = undefined;
    expect((await openSessionDatabase()).isFailure()).toBe(true);
    expect((await loadSavedSession()).isNone()).toBe(true);
    expect((await saveSessionState({} as any)).isFailure()).toBe(true);
    expect((await clearSessionState()).isFailure()).toBe(true);
    expect(await getPersistencePreference()).toBe(false);
    expect((await setPersistencePreference(true)).isFailure()).toBe(true);
    expect((await auditEncryptedStorage()).isFailure()).toBe(true);
  });
});


