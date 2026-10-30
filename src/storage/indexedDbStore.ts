import {
  StorageLoadStatusEnum,
  type EncryptedEnvelope,
  type EncryptedStorageAuditReport,
  type EncryptedStorageRecord,
  type StorageLoadOutcome,
  type StoredSessionState
} from '../types';
import {
  failure,
  fromNullable,
  fromResult,
  matchBool,
  none,
  some,
  success,
  toResult,
  tryCatch,
  tryCatchAsync,
  type Option,
  type Result
} from '../utils/fp';
import { logger } from '../utils/logger';
import { currentEpochMs, nowIso } from '../utils/dateTime';

export const DB_NAME = 'WizardChessSessionDB';
export const DB_VERSION = 1;
export const STORE_NAME = 'sanctuary_sessions';
export const SESSION_KEY = 'active_session';
export const PREFERENCE_KEY = 'persistence_preference';
export const ARCADE_RESUME_KEY = 'active_arcade_table';
export const ARCADE_PLAYER_KEY = 'arcade_player_identity';
export const CRYPTO_KEY_RECORD_ID = '__origin_bound_non_extractable_key__' as const;
export const ENCRYPTION_ALGORITHM = 'AES-GCM-256' as const;
export const ENCRYPTION_KEY_BITS = 256 as const;
export const ENCRYPTION_IV_BYTES = 12 as const;
export const ENCRYPTION_AUTH_TAG_BITS = 128 as const;
export const ENCRYPTION_CIPHER_MODE =
  'Galois/Counter Mode (AEAD, 128-bit Auth Tag)' as const;
export const ENCRYPTION_KEY_MANAGEMENT =
  'Web Crypto CSPRNG Non-Extractable CryptoKey (extractable: false)' as const;

interface PreferencePayload {
  enabled: boolean;
  updatedAt: number;
}

interface StoredCryptoKeyRecord {
  id: typeof CRYPTO_KEY_RECORD_ID;
  cryptoKey: CryptoKey;
  createdAt: number;
}

/**
 * Private closure reference to the origin-bound, non-extractable 256-bit Web Crypto key.
 * ZERO hardcoded key material exists anywhere in the source code or bundle.
 */
let fallbackMasterKeyOpt: Option<CryptoKey> = none();

import {
  type DevModeEnvProbe,
  detectDevMode,
  isDevMode,
  setDevModeOverride
} from '../utils/env';

export {
  type DevModeEnvProbe,
  detectDevMode,
  isDevMode,
  setDevModeOverride
};

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Result<Uint8Array, string> {
  return tryCatch(
    () => {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    },
    () => 'Invalid Base64 encoding in encrypted record'
  );
}

/**
 * Builds canonical Additional Authenticated Data (AAD) binding each AES-GCM-256
 * 128-bit authentication tag to the specific record context (`active_session` vs `persistence_preference`).
 * Prevents cross-record transplant attacks or envelope metadata tampering.
 */
export function buildAdditionalAuthenticatedData(
  context: string = 'default'
): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    `SanctaBasilica:v1:${ENCRYPTION_ALGORITHM}:tag=${ENCRYPTION_AUTH_TAG_BITS}:ctx=${context}`
  ) as Uint8Array<ArrayBuffer>;
}

/**
 * Parses decrypted JSON while stripping prototype pollution keys (`__proto__`, `constructor`, `prototype`).
 */
export function safeJsonParse<T>(jsonText: string): T {
  return JSON.parse(jsonText, (key, value) =>
    matchBool(key === '__proto__' || key === 'constructor' || key === 'prototype', {
      true: () => undefined,
      false: () => value
    })
  ) as T;
}

async function generateNonExtractableCryptoKey(): Promise<Result<CryptoKey, string>> {
  return tryCatchAsync(
    async () => {
      const key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: ENCRYPTION_KEY_BITS },
        false, // extractable: FALSE — raw key bytes can NEVER be exported by JS or external tools
        ['encrypt', 'decrypt']
      );
      fallbackMasterKeyOpt = some(key);
      return key;
    },
    () => 'Web Crypto API unavailable for non-extractable key generation'
  );
}

/**
 * Drops the in-memory reference to the master key (e.g. on explicit lock/wipe).
 * The persisted non-extractable key record in IndexedDB is untouched.
 */
export function clearCachedCryptoKey(): void {
  fallbackMasterKeyOpt = none();
}

function readStoredCryptoKey(db: IDBDatabase): Promise<Result<Option<CryptoKey>, string>> {
  return tryCatchAsync(
    async () =>
      new Promise<Option<CryptoKey>>((resolve, reject) => {
        const request = db
          .transaction([STORE_NAME], 'readonly')
          .objectStore(STORE_NAME)
          .get(CRYPTO_KEY_RECORD_ID);
        request.onsuccess = () =>
          resolve(fromNullable((request.result as StoredCryptoKeyRecord | undefined)?.cryptoKey));
        request.onerror = () => reject(new Error('IndexedDB crypto key read error'));
      }),
    err => (err as Error).message
  );
}

function persistStoredCryptoKey(
  db: IDBDatabase,
  cryptoKey: CryptoKey
): Promise<Result<void, string>> {
  return tryCatchAsync(
    async () =>
      new Promise<void>((resolve, reject) => {
        const record: StoredCryptoKeyRecord = {
          id: CRYPTO_KEY_RECORD_ID,
          cryptoKey,
          createdAt: currentEpochMs()
        };
        const request = db
          .transaction([STORE_NAME], 'readwrite')
          .objectStore(STORE_NAME)
          .put(record);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(new Error('IndexedDB crypto key write error'));
      }),
    err => (err as Error).message
  );
}

/**
 * Rotates the non-extractable 256-bit AES-GCM master key in Web Crypto and IndexedDB,
 * cryptographically invalidating any previously exported or copied ciphertexts.
 * Fails (rather than silently continuing) if the new key cannot be persisted, so we never
 * write ciphertext that could not be decrypted after a refresh.
 */
export async function rotateMasterCryptoKey(): Promise<Result<CryptoKey, string>> {
  const dbRes = await openSessionDatabase();
  return dbRes.flatMapAsync(async db => {
    const generatedRes = await generateNonExtractableCryptoKey();
    return generatedRes.flatMapAsync(async newKey =>
      (await persistStoredCryptoKey(db, newKey)).map(() => newKey)
    );
  });
}

/**
 * Resolves the origin-bound, non-extractable (`extractable: false`) 256-bit `CryptoKey`.
 * Persists only the opaque `CryptoKey` handle via IndexedDB Structured Clone so legitimate
 * tab/browser refreshes in the same browser profile can decrypt session state, while offline
 * attackers who copy the IndexedDB JSON or inspect the bundle have zero access to key bytes.
 * A read error FAILS CLOSED — the stored key is never overwritten by a transient failure.
 */
export async function getStorageCryptoKey(): Promise<Result<CryptoKey, string>> {
  const dbRes = await openSessionDatabase();
  return dbRes.match({
    Err: () =>
      fallbackMasterKeyOpt.match({
        Some: async key => success<CryptoKey, string>(key),
        None: () => generateNonExtractableCryptoKey()
      }),
    Ok: async db =>
      (await readStoredCryptoKey(db)).match({
        Err: async message => failure<CryptoKey, string>(message),
        Ok: storedOpt =>
          storedOpt.match({
            Some: async storedKey => {
              fallbackMasterKeyOpt = some(storedKey);
              return success<CryptoKey, string>(storedKey);
            },
            None: () => rotateMasterCryptoKey()
          })
      })
  });
}

export function isEncryptedEnvelope(candidate: unknown): candidate is EncryptedEnvelope {
  return fromNullable(candidate as EncryptedEnvelope | null | undefined)
    .filter(
      env =>
        typeof env === 'object' &&
        env.v === 1 &&
        env.alg === ENCRYPTION_ALGORITHM &&
        typeof env.iv === 'string' &&
        env.iv.length > 0 &&
        typeof env.ciphertext === 'string' &&
        env.ciphertext.length > 0
    )
    .isSome();
}

/**
 * Encrypts any serializable payload into an authenticated AES-GCM-256 envelope
 * with a fresh 12-byte random IV, 128-bit auth tag, and context-bound AAD before writing to IndexedDB.
 */
export async function encryptPayload<T>(
  payload: T,
  context: string = 'default'
): Promise<Result<EncryptedEnvelope, string>> {
  matchBool(isDevMode(), {
    true: () => {
      logger.info(
        `[DEV STORAGE ENCRYPT] Plaintext storage payload before AES-GCM-256 encryption (${context}):`,
        {
          context,
          payload
        }
      );
    },
    false: () => {}
  });

  const keyResult = await getStorageCryptoKey();
  return keyResult.flatMapAsync(key =>
    tryCatchAsync(
      async () => {
        const iv = crypto.getRandomValues(new Uint8Array(ENCRYPTION_IV_BYTES));
        const additionalData = buildAdditionalAuthenticatedData(context);
        const plaintextBytes = new TextEncoder().encode(JSON.stringify(payload));
        const cipherBuffer = await crypto.subtle.encrypt(
          {
            name: 'AES-GCM',
            iv,
            additionalData,
            tagLength: ENCRYPTION_AUTH_TAG_BITS
          },
          key,
          plaintextBytes
        );
        return {
          v: 1 as const,
          alg: ENCRYPTION_ALGORITHM,
          iv: bytesToBase64(iv),
          ciphertext: bytesToBase64(new Uint8Array(cipherBuffer))
        };
      },
      () => 'Failed to encrypt storage payload'
    )
  );
}

/**
 * Validates and decrypts an AES-GCM-256 envelope fetched from IndexedDB,
 * enforcing 128-bit AEAD tag authentication and context-bound AAD verification.
 */
export async function decryptPayload<T>(
  candidate: unknown,
  context: string = 'default'
): Promise<Result<T, string>> {
  const envelopeOpt: Option<EncryptedEnvelope> = fromNullable(
    candidate as EncryptedEnvelope | null | undefined
  ).filter(isEncryptedEnvelope);

  const decodedResult = toResult(envelopeOpt, () => 'Invalid or unencrypted storage envelope').flatMap(
    env =>
      base64ToBytes(env.iv).flatMap(iv =>
        base64ToBytes(env.ciphertext).map(ciphertext => ({ iv, ciphertext }))
      )
  );

  return decodedResult.flatMapAsync(({ iv, ciphertext }) =>
    getStorageCryptoKey().then(keyResult =>
      keyResult.flatMapAsync(key =>
        tryCatchAsync(
          async () => {
            const additionalData = buildAdditionalAuthenticatedData(context);
            const plainBuffer = await crypto.subtle.decrypt(
              {
                name: 'AES-GCM',
                iv: iv as Uint8Array<ArrayBuffer>,
                additionalData,
                tagLength: ENCRYPTION_AUTH_TAG_BITS
              },
              key,
              ciphertext as Uint8Array<ArrayBuffer>
            );
            const jsonText = new TextDecoder().decode(plainBuffer);
            return safeJsonParse<T>(jsonText);
          },
          () => 'Failed to decrypt or authenticate storage payload'
        )
      )
    )
  );
}

/**
 * Opens or upgrades the IndexedDB instance for lightweight encrypted session persistence.
 * Completely independent of localStorage.
 */
export async function openSessionDatabase(): Promise<Result<IDBDatabase, string>> {
  return tryCatchAsync(
    async () => {
      const idbOpt = fromNullable(
        typeof indexedDB !== 'undefined' ? indexedDB : null
      );
      return idbOpt.fold(
        () => Promise.reject(new Error('IndexedDB is not available in this environment')),
        idb =>
          new Promise<IDBDatabase>((resolve, reject) => {
            const request = idb.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
              const db = (event.target as IDBOpenDBRequest).result;
              if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
              }
            };

            request.onsuccess = () => resolve(request.result);
            request.onerror = () =>
              reject(new Error(request.error?.message ?? 'Failed to open IndexedDB'));
          })
      );
    },
    err => (err as Error).message
  );
}

async function readEncryptedRecord(
  db: IDBDatabase,
  key: string
): Promise<Result<Option<EncryptedStorageRecord>, string>> {
  return tryCatchAsync(
    async () =>
      new Promise<Option<EncryptedStorageRecord>>((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(key);

        request.onsuccess = () =>
          resolve(fromNullable(request.result as EncryptedStorageRecord | undefined));
        request.onerror = () =>
          reject(new Error(request.error?.message ?? 'IndexedDB read error'));
      }),
    err => (err as Error).message
  );
}

async function writeEncryptedRecord(
  db: IDBDatabase,
  record: EncryptedStorageRecord
): Promise<Result<void, string>> {
  return tryCatchAsync(
    async () =>
      new Promise<void>((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(record);

        request.onsuccess = () => resolve();
        request.onerror = () =>
          reject(new Error(request.error?.message ?? 'IndexedDB write error'));
      }),
    err => (err as Error).message
  );
}

/**
 * Loads and decrypts the saved session state from IndexedDB if it exists.
 */
export async function loadSavedSession(): Promise<Option<StoredSessionState>> {
  const dbResult = await openSessionDatabase();
  const decryptedResult = await dbResult
    .flatMapAsync(db => readEncryptedRecord(db, SESSION_KEY))
    .then(recResult =>
      recResult.flatMapAsync(recordOpt =>
        recordOpt.fold(
          async () => toResult(none<StoredSessionState>(), () => 'No saved session found'),
          record => decryptPayload<StoredSessionState>(record.envelope, SESSION_KEY)
        )
      )
    );

  return fromResult(decryptedResult);
}

/**
 * Encrypts and persists the game session state to IndexedDB.
 */
export async function saveSessionState(
  session: StoredSessionState
): Promise<Result<void, string>> {
  const dbResult = await openSessionDatabase();
  return dbResult.flatMapAsync(db =>
    encryptPayload({ ...session, id: SESSION_KEY }, SESSION_KEY).then(envResult =>
      envResult.flatMapAsync(envelope =>
        writeEncryptedRecord(db, {
          id: SESSION_KEY,
          envelope,
          updatedAt: currentEpochMs()
        })
      )
    )
  );
}

/**
 * Clears the persisted session from IndexedDB.
 */
export async function clearSessionState(): Promise<Result<void, string>> {
  const dbResult = await openSessionDatabase();
  return dbResult.flatMapAsync(db =>
    tryCatchAsync(
      async () =>
        new Promise<void>((resolve, reject) => {
          const transaction = db.transaction([STORE_NAME], 'readwrite');
          const store = transaction.objectStore(STORE_NAME);
          const request = store.delete(SESSION_KEY);

          request.onsuccess = () => resolve();
          request.onerror = () =>
            reject(new Error(request.error?.message ?? 'Delete error'));
        }),
      err => (err as Error).message
    )
  );
}

/**
 * Retrieves and decrypts the user's preference for whether session persistence is enabled.
 * Defaults to `true` when IndexedDB is available and no preference record has been written yet
 * (so session state survives tab/browser refreshes out-of-the-box), or `false` if IndexedDB is unavailable.
 */
export async function getPersistencePreference(): Promise<boolean> {
  const dbResult = await openSessionDatabase();
  return dbResult.match({
    Err: async () => false,
    Ok: async db =>
      (await readEncryptedRecord(db, PREFERENCE_KEY)).match({
        Err: async () => false,
        Ok: recordOpt =>
          recordOpt.match({
            None: async () => true,
            Some: async record =>
              (await decryptPayload<PreferencePayload>(record.envelope, PREFERENCE_KEY)).match({
                Ok: pref => Boolean(pref.enabled),
                // Unreadable (e.g. written under a previous key): fall back to the default (on);
                // the user can opt out or wipe from the Storage Audit panel.
                Err: () => true
              })
          })
      })
  });
}

const outcomeOf = (
  status: StorageLoadStatusEnum,
  session?: StoredSessionState
): StorageLoadOutcome => ({ status, session });

/**
 * Restores the saved session as an exhaustive outcome (restored / empty / unreadable / unavailable)
 * so callers can `match` on it and tell the user exactly what happened.
 */
export async function loadSessionOutcome(): Promise<StorageLoadOutcome> {
  const dbResult = await openSessionDatabase();
  return dbResult.match({
    Err: async () => outcomeOf(StorageLoadStatusEnum.Unavailable),
    Ok: async db =>
      (await readEncryptedRecord(db, SESSION_KEY)).match({
        Err: async () => outcomeOf(StorageLoadStatusEnum.Unavailable),
        Ok: recordOpt =>
          recordOpt.match({
            None: async () => outcomeOf(StorageLoadStatusEnum.Empty),
            Some: async record =>
              (await decryptPayload<StoredSessionState>(record.envelope, SESSION_KEY)).match({
                Ok: session => outcomeOf(StorageLoadStatusEnum.Restored, session),
                Err: () => outcomeOf(StorageLoadStatusEnum.Unreadable)
              })
          })
      })
  });
}

/**
 * The arcade table a player was in, so a refresh returns them to the same game on this device.
 */
export interface ArcadeResumeState {
  readonly game: string;
  readonly isLive: boolean;
  readonly sessionCode: string;
  readonly isHost: boolean;
  readonly participantId: string;
  readonly playerName: string;
  readonly snapshot: unknown;
  readonly savedAt: number;
}

/**
 * Encrypts and persists the active arcade table (AES-GCM-256, AAD bound to `ARCADE_RESUME_KEY`).
 */
export async function saveArcadeResumeState(state: ArcadeResumeState): Promise<Result<void, string>> {
  const dbResult = await openSessionDatabase();
  return dbResult.flatMapAsync(db =>
    encryptPayload(state, ARCADE_RESUME_KEY).then(envResult =>
      envResult.flatMapAsync(envelope =>
        writeEncryptedRecord(db, {
          id: ARCADE_RESUME_KEY,
          envelope,
          updatedAt: currentEpochMs()
        })
      )
    )
  );
}

/**
 * Loads and decrypts the active arcade table, if one was saved and is still readable.
 */
export async function loadArcadeResumeState(): Promise<Option<ArcadeResumeState>> {
  const dbResult = await openSessionDatabase();
  const decrypted = await dbResult
    .flatMapAsync(db => readEncryptedRecord(db, ARCADE_RESUME_KEY))
    .then(recResult =>
      recResult.flatMapAsync(recordOpt =>
        recordOpt.fold(
          async () => toResult(none<ArcadeResumeState>(), () => 'No arcade table saved'),
          record => decryptPayload<ArcadeResumeState>(record.envelope, ARCADE_RESUME_KEY)
        )
      )
    );
  return fromResult(decrypted);
}

/**
 * Forgets the active arcade table (the player left it on purpose).
 */
export async function clearArcadeResumeState(): Promise<Result<void, string>> {
  const dbResult = await openSessionDatabase();
  return dbResult.flatMapAsync(db =>
    tryCatchAsync(
      async () =>
        new Promise<void>((resolve, reject) => {
          const request = db
            .transaction([STORE_NAME], 'readwrite')
            .objectStore(STORE_NAME)
            .delete(ARCADE_RESUME_KEY);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(new Error(request.error?.message ?? 'Delete error'));
        }),
      err => (err as Error).message
    )
  );
}

/**
 * Encrypts and stores one value under its own record key (AES-GCM-256, AAD bound to `key`).
 */
async function saveEncryptedValue<T>(key: string,
                                     value: T): Promise<Result<void, string>> {
  const dbResult = await openSessionDatabase();
  return dbResult.flatMapAsync(db =>
    encryptPayload(value, key).then(envResult =>
      envResult.flatMapAsync(envelope =>
        writeEncryptedRecord(db, {
          id: key,
          envelope,
          updatedAt: currentEpochMs()
        })
      )
    )
  );
}

/**
 * Loads and decrypts the value stored under `key`, if present and readable.
 */
async function loadEncryptedValue<T>(key: string): Promise<Option<T>> {
  const dbResult = await openSessionDatabase();
  const decrypted = await dbResult
    .flatMapAsync(db => readEncryptedRecord(db, key))
    .then(recResult =>
      recResult.flatMapAsync(recordOpt =>
        recordOpt.fold(
          async () => toResult(none<T>(), () => `No record stored under ${key}`),
          record => decryptPayload<T>(record.envelope, key)
        )
      )
    );
  return fromResult(decrypted);
}

/** Credentials of this browser's guest arcade player account (tbl_arcade_players). */
export interface ArcadePlayerCredentials {
  readonly email: string;
  readonly password: string;
}

export async function saveArcadePlayerCredentials(credentials: ArcadePlayerCredentials): Promise<Result<void, string>> {
  return saveEncryptedValue(ARCADE_PLAYER_KEY, credentials);
}

export async function loadArcadePlayerCredentials(): Promise<Option<ArcadePlayerCredentials>> {
  return loadEncryptedValue<ArcadePlayerCredentials>(ARCADE_PLAYER_KEY);
}

/**
 * Irreversibly wipes EVERY record (session, preference, and the encryption key itself)
 * and drops the in-memory key, so the next write starts from a brand-new key.
 */
export async function wipeAllStorage(): Promise<Result<void, string>> {
  clearCachedCryptoKey();
  const dbResult = await openSessionDatabase();
  return dbResult.flatMapAsync(db =>
    tryCatchAsync(
      async () =>
        new Promise<void>((resolve, reject) => {
          const request = db
            .transaction([STORE_NAME], 'readwrite')
            .objectStore(STORE_NAME)
            .clear();
          request.onsuccess = () => resolve();
          request.onerror = () => reject(new Error('IndexedDB wipe error'));
        }),
      err => (err as Error).message
    )
  );
}

/**
 * Encrypts and saves the user's checkbox preference for session persistence to IndexedDB.
 */
export async function setPersistencePreference(
  enabled: boolean
): Promise<Result<void, string>> {
  const dbResult = await openSessionDatabase();
  return dbResult.flatMapAsync(db =>
    encryptPayload<PreferencePayload>({ enabled, updatedAt: currentEpochMs() }, PREFERENCE_KEY).then(
      envResult =>
        envResult.flatMapAsync(envelope =>
          writeEncryptedRecord(db, {
            id: PREFERENCE_KEY,
            envelope,
            updatedAt: currentEpochMs()
          })
        )
    )
  );
}

/**
 * Generates an encrypted-only audit report of all records stored in IndexedDB.
 * Never decrypts or exposes plaintext, and never exposes the non-extractable CryptoKey handle;
 * returns only the raw AES-GCM-256 envelopes (v, alg, iv, ciphertext) alongside algorithm and
 * non-extractable key management metadata.
 */
export async function auditEncryptedStorage(): Promise<
  Result<EncryptedStorageAuditReport, string>
> {
  const dbResult = await openSessionDatabase();
  return dbResult.flatMapAsync(db =>
    readEncryptedRecord(db, PREFERENCE_KEY).then(prefRecRes =>
      prefRecRes.flatMapAsync(prefOpt =>
        readEncryptedRecord(db, SESSION_KEY).then(sessRecRes =>
          sessRecRes.map(sessOpt => {
            const records: EncryptedStorageRecord[] = [];
            prefOpt
              .filter(rec => isEncryptedEnvelope(rec.envelope))
              .map(rec =>
                records.push({
                  id: rec.id,
                  updatedAt: rec.updatedAt,
                  envelope: {
                    v: 1,
                    alg: ENCRYPTION_ALGORITHM,
                    iv: rec.envelope.iv,
                    ciphertext: rec.envelope.ciphertext
                  }
                })
              );
            sessOpt
              .filter(rec => isEncryptedEnvelope(rec.envelope))
              .map(rec =>
                records.push({
                  id: rec.id,
                  updatedAt: rec.updatedAt,
                  envelope: {
                    v: 1,
                    alg: ENCRYPTION_ALGORITHM,
                    iv: rec.envelope.iv,
                    ciphertext: rec.envelope.ciphertext
                  }
                })
              );

            return {
              database: DB_NAME,
              objectStore: STORE_NAME,
              algorithm: ENCRYPTION_ALGORITHM,
              keyLengthBits: ENCRYPTION_KEY_BITS,
              ivLengthBytes: ENCRYPTION_IV_BYTES,
              authTagBits: ENCRYPTION_AUTH_TAG_BITS,
              cipherMode: ENCRYPTION_CIPHER_MODE,
              keyManagement: ENCRYPTION_KEY_MANAGEMENT,
              keyExtractable: false as const,
              hardcodedBundleKey: false as const,
              aadContextBound: true as const,
              localStorageUsed: false as const,
              plaintextExposed: false as const,
              auditedAt: nowIso(),
              recordCount: records.length,
              records
            };
          })
        )
      )
    )
  );
}


