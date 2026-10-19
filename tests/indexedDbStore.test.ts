import { beforeEach, describe, expect, it } from 'bun:test';
import {
  auditEncryptedStorage,
  base64ToBytes,
  buildAdditionalAuthenticatedData,
  bytesToBase64,
  clearCachedCryptoKey,
  clearSessionState,
  CRYPTO_KEY_RECORD_ID,
  DB_NAME,
  decryptPayload,
  ENCRYPTION_ALGORITHM,
  ENCRYPTION_AUTH_TAG_BITS,
  ENCRYPTION_CIPHER_MODE,
  ENCRYPTION_IV_BYTES,
  ENCRYPTION_KEY_BITS,
  ENCRYPTION_KEY_MANAGEMENT,
  encryptPayload,
  getPersistencePreference,
  getStorageCryptoKey,
  isEncryptedEnvelope,
  loadSavedSession,
  openSessionDatabase,
  PREFERENCE_KEY,
  rotateMasterCryptoKey,
  safeJsonParse,
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

    // Simulate Web Crypto encrypt failure and key generation failure (fresh DB => no stored key)
    const origEncrypt = crypto.subtle.encrypt.bind(crypto.subtle);

    (crypto.subtle as any).encrypt = async () => {
      throw new Error('Crypto hardware error');
    };
    expect((await encryptPayload({ a: 1 })).isFailure()).toBe(true);
    (crypto.subtle as any).encrypt = origEncrypt;

    setupMockIndexedDB();
    const origGenerateKey = crypto.subtle.generateKey.bind(crypto.subtle);
    (crypto.subtle as any).generateKey = async () => {
      throw new Error('Key generation blocked');
    };
    expect((await encryptPayload({ a: 1 })).isFailure()).toBe(true);
    (crypto.subtle as any).generateKey = origGenerateKey;
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



function installIndexedDbWithRequestBehavior(behavior: {
  getResult?: unknown;
  getFails?: boolean;
  putFails?: boolean;
  onPut?: () => void;
}) {
  const fakeDb = {
    objectStoreNames: { contains: () => true },
    transaction: () => ({
      objectStore: () => ({
        get: () => {
          const req: any = {};
          queueMicrotask(() => {
            if (behavior.getFails) {
              req.onerror?.();
            } else {
              req.result = behavior.getResult;
              req.onsuccess?.({ target: req });
            }
          });
          return req;
        },
        put: () => {
          behavior.onPut?.();
          const req: any = {};
          queueMicrotask(() => (behavior.putFails ? req.onerror?.() : req.onsuccess?.()));
          return req;
        }
      })
    })
  };
  (globalThis as any).indexedDB = {
    open: () => {
      const req: any = { result: fakeDb };
      queueMicrotask(() => req.onsuccess?.({ target: req }));
      return req;
    }
  };
}

describe('Hardened key management, AEAD context binding & fail-closed behaviour', () => {
  beforeEach(() => {
    setupMockIndexedDB();
    clearCachedCryptoKey();
  });

  it('uses a CSPRNG-generated NON-extractable AES-GCM-256 key that is persisted once and reused', async () => {
    const first = (await getStorageCryptoKey()).getOrThrow('expected key');
    expect(first.extractable).toBe(false);
    expect(first.algorithm as AesKeyAlgorithm).toEqual({
      name: 'AES-GCM',
      length: ENCRYPTION_KEY_BITS
    });
    expect([...first.usages].sort()).toEqual(['decrypt', 'encrypt']);

    // Raw key bytes can never be exported, even by code running in the page
    let exportRejected = false;
    try {
      await crypto.subtle.exportKey('raw', first);
    } catch {
      exportRejected = true;
    }
    expect(exportRejected).toBe(true);

    // Only the opaque CryptoKey handle is stored; a fresh cache reuses the same persisted key
    const rawKeyRecord = activeMockDb.getRawRecord(STORE_NAME, CRYPTO_KEY_RECORD_ID);
    expect(rawKeyRecord.cryptoKey).toBe(first);
    clearCachedCryptoKey();
    const second = (await getStorageCryptoKey()).getOrThrow('expected key');
    expect(second).toBe(first);
  });

  it('contains no hardcoded key material or raw key import anywhere in the storage module source', async () => {
    const source = await Bun.file(
      new URL('../src/storage/indexedDbStore.ts', import.meta.url)
    ).text();
    expect(source).not.toContain('SanctaBasilicaWizardChessAES256');
    expect(source).not.toContain('importKey(');
    expect(source).toContain('extractable: FALSE');
  });

  it('never exposes the key record or plaintext in the audit report and reports hardened metadata', async () => {
    await saveSessionState({
      id: SESSION_KEY,
      enabled: true,
      fen: 'start-fen-secret',
      history: ['e4'],
      mode: GameModeEnum.Minimax,
      difficulty: OpponentDifficultyEnum.Balanced,
      allowUndo: true,
      contrast: 100,
      brightness: 100,
      deviceTier: DeviceTierEnum.Desktop,
      timestamp: Date.now()
    });
    const report = (await auditEncryptedStorage()).getOrThrow('expected audit');
    expect(report.recordCount).toBe(1);
    expect(report.records.map(r => r.id)).toEqual([SESSION_KEY]);
    expect(JSON.stringify(report)).not.toContain(CRYPTO_KEY_RECORD_ID);
    expect(JSON.stringify(report)).not.toContain('start-fen-secret');
    expect(report.authTagBits).toBe(ENCRYPTION_AUTH_TAG_BITS);
    expect(report.keyManagement).toBe(ENCRYPTION_KEY_MANAGEMENT);
    expect(report.keyExtractable).toBe(false);
    expect(report.hardcodedBundleKey).toBe(false);
    expect(report.aadContextBound).toBe(true);
  });

  it('binds ciphertext to its record context via AAD (wrong or missing context fails authentication)', async () => {
    const env = (await encryptPayload({ s: 1 }, 'ctx-a')).getOrThrow('expected envelope');
    expect((await decryptPayload<{ s: number }>(env, 'ctx-a')).getOrThrow('dec')).toEqual({ s: 1 });
    expect((await decryptPayload(env, 'ctx-b')).isFailure()).toBe(true);
    expect((await decryptPayload(env)).isFailure()).toBe(true);

    const aad = new TextDecoder().decode(buildAdditionalAuthenticatedData());
    expect(aad).toContain('ctx=default');
    expect(aad).toContain(`tag=${ENCRYPTION_AUTH_TAG_BITS}`);
  });

  it('rejects cross-record envelope transplant attacks (session envelope swapped into preference slot)', async () => {
    await setPersistencePreference(true);
    await saveSessionState({
      id: SESSION_KEY,
      enabled: true,
      fen: 'f',
      history: [],
      mode: GameModeEnum.Minimax,
      difficulty: OpponentDifficultyEnum.Balanced,
      allowUndo: true,
      contrast: 100,
      brightness: 100,
      deviceTier: DeviceTierEnum.Desktop,
      timestamp: Date.now()
    });
    const sessionRec = activeMockDb.getRawRecord(STORE_NAME, SESSION_KEY);
    const prefRec = activeMockDb.getRawRecord(STORE_NAME, PREFERENCE_KEY);
    activeMockDb.stores[STORE_NAME]!.set(SESSION_KEY, { ...sessionRec, envelope: prefRec.envelope });
    activeMockDb.stores[STORE_NAME]!.set(PREFERENCE_KEY, { ...prefRec, envelope: sessionRec.envelope });

    expect((await loadSavedSession()).isNone()).toBe(true);
    expect(await getPersistencePreference()).toBe(false);
  });

  it('strips prototype-pollution keys when parsing decrypted JSON', () => {
    const parsed = safeJsonParse<Record<string, unknown>>(
      '{"a":1,"__proto__":{"polluted":true},"constructor":2,"prototype":3}'
    );
    expect(Object.keys(parsed)).toEqual(['a']);
    expect(({} as any).polluted).toBeUndefined();
  });

  it('key rotation cryptographically invalidates previously written ciphertext', async () => {
    const oldKey = (await getStorageCryptoKey()).getOrThrow('old key');
    const oldEnv = (await encryptPayload({ v: 'old' }, 'rot')).getOrThrow('old env');

    const newKey = (await rotateMasterCryptoKey()).getOrThrow('new key');
    expect(newKey).not.toBe(oldKey);
    expect(newKey.extractable).toBe(false);

    expect((await decryptPayload(oldEnv, 'rot')).isFailure()).toBe(true);
    const newEnv = (await encryptPayload({ v: 'new' }, 'rot')).getOrThrow('new env');
    expect((await decryptPayload<{ v: string }>(newEnv, 'rot')).getOrThrow('dec')).toEqual({
      v: 'new'
    });
  });

  it('FAILS CLOSED on key read errors and never overwrites the stored key', async () => {
    let putCalls = 0;
    installIndexedDbWithRequestBehavior({ getFails: true, onPut: () => putCalls++ });
    expect((await getStorageCryptoKey()).isFailure()).toBe(true);
    expect((await encryptPayload({ a: 1 })).isFailure()).toBe(true);
    expect(putCalls).toBe(0);
  });

  it('surfaces data-record write failures when the key is available', async () => {
    const key = (await getStorageCryptoKey()).getOrThrow('key');
    installIndexedDbWithRequestBehavior({ getResult: { cryptoKey: key }, putFails: true });
    const res = await saveSessionState({} as any);
    expect(res.isFailure()).toBe(true);
    expect((await setPersistencePreference(true)).isFailure()).toBe(true);
  });

  it('refuses to hand out a key it could not persist (so no undecryptable data is written)', async () => {
    installIndexedDbWithRequestBehavior({ getResult: undefined, putFails: true });
    expect((await getStorageCryptoKey()).isFailure()).toBe(true);
    expect((await rotateMasterCryptoKey()).isFailure()).toBe(true);

    (globalThis as any).indexedDB = undefined;
    expect((await rotateMasterCryptoKey()).isFailure()).toBe(true);
  });

  it('falls back to a session-only in-memory non-extractable key when IndexedDB is unavailable', async () => {
    (globalThis as any).indexedDB = undefined;
    const first = (await getStorageCryptoKey()).getOrThrow('fallback key');
    const second = (await getStorageCryptoKey()).getOrThrow('cached fallback key');
    expect(first.extractable).toBe(false);
    expect(second).toBe(first);
  });
});
