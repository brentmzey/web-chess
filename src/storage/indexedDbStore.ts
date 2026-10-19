import type {
  EncryptedEnvelope,
  EncryptedStorageAuditReport,
  EncryptedStorageRecord,
  StoredSessionState
} from '../types';
import {
  fromNullable,
  fromResult,
  none,
  success,
  toResult,
  tryCatch,
  tryCatchAsync,
  type Option,
  type Result
} from '../utils/fp';

export const DB_NAME = 'WizardChessSessionDB';
export const DB_VERSION = 1;
export const STORE_NAME = 'sanctuary_sessions';
export const SESSION_KEY = 'active_session';
export const PREFERENCE_KEY = 'persistence_preference';
export const ENCRYPTION_ALGORITHM = 'AES-GCM-256' as const;
export const ENCRYPTION_KEY_BITS = 256 as const;
export const ENCRYPTION_IV_BYTES = 12 as const;
export const ENCRYPTION_CIPHER_MODE =
  'Galois/Counter Mode (AEAD, 128-bit Auth Tag)' as const;

interface PreferencePayload {
  enabled: boolean;
  updatedAt: number;
}

// 256-bit (32-byte) key material for Web Crypto AES-GCM authenticated storage encryption
const STORAGE_KEY_MATERIAL = new TextEncoder().encode('SanctaBasilicaWizardChessAES256!');

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

async function getStorageCryptoKey(): Promise<Result<CryptoKey, string>> {
  return tryCatchAsync(
    async () =>
      crypto.subtle.importKey(
        'raw',
        STORAGE_KEY_MATERIAL,
        { name: 'AES-GCM', length: ENCRYPTION_KEY_BITS },
        false,
        ['encrypt', 'decrypt']
      ),
    () => 'Web Crypto API unavailable for storage encryption'
  );
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
 * with a fresh 12-byte random IV before writing to IndexedDB.
 */
export async function encryptPayload<T>(payload: T): Promise<Result<EncryptedEnvelope, string>> {
  const keyResult = await getStorageCryptoKey();
  return keyResult.flatMapAsync(key =>
    tryCatchAsync(
      async () => {
        const iv = crypto.getRandomValues(new Uint8Array(ENCRYPTION_IV_BYTES));
        const plaintextBytes = new TextEncoder().encode(JSON.stringify(payload));
        const cipherBuffer = await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv },
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
 * Validates and decrypts an AES-GCM-256 envelope fetched from IndexedDB.
 */
export async function decryptPayload<T>(candidate: unknown): Promise<Result<T, string>> {
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
            const plainBuffer = await crypto.subtle.decrypt(
              { name: 'AES-GCM', iv: iv as Uint8Array<ArrayBuffer> },
              key,
              ciphertext as Uint8Array<ArrayBuffer>
            );
            const jsonText = new TextDecoder().decode(plainBuffer);
            return JSON.parse(jsonText) as T;
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
          record => decryptPayload<StoredSessionState>(record.envelope)
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
    encryptPayload({ ...session, id: SESSION_KEY }).then(envResult =>
      envResult.flatMapAsync(envelope =>
        writeEncryptedRecord(db, {
          id: SESSION_KEY,
          envelope,
          updatedAt: Date.now()
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
  const prefResult = await dbResult
    .flatMapAsync(db => readEncryptedRecord(db, PREFERENCE_KEY))
    .then(recResult =>
      recResult.flatMapAsync(recordOpt =>
        recordOpt.match({
          None: async () => success<PreferencePayload, string>({ enabled: true, updatedAt: 0 }),
          Some: record => decryptPayload<PreferencePayload>(record.envelope)
        })
      )
    );

  return prefResult.map(pref => Boolean(pref.enabled)).getOrElse(false);
}



/**
 * Encrypts and saves the user's checkbox preference for session persistence to IndexedDB.
 */
export async function setPersistencePreference(
  enabled: boolean
): Promise<Result<void, string>> {
  const dbResult = await openSessionDatabase();
  return dbResult.flatMapAsync(db =>
    encryptPayload<PreferencePayload>({ enabled, updatedAt: Date.now() }).then(envResult =>
      envResult.flatMapAsync(envelope =>
        writeEncryptedRecord(db, {
          id: PREFERENCE_KEY,
          envelope,
          updatedAt: Date.now()
        })
      )
    )
  );
}

/**
 * Generates an encrypted-only audit report of all records stored in IndexedDB.
 * Never decrypts or exposes plaintext; returns only the raw AES-GCM-256 envelopes
 * (v, alg, iv, ciphertext) alongside algorithm and cipher specification metadata.
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
              cipherMode: ENCRYPTION_CIPHER_MODE,
              localStorageUsed: false as const,
              plaintextExposed: false as const,
              auditedAt: new Date().toISOString(),
              recordCount: records.length,
              records
            };
          })
        )
      )
    )
  );
}


