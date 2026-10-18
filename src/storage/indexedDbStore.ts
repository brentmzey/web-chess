import type { StoredSessionState } from '../types';
import {
  failure,
  fromNullable,
  none,
  tryCatchAsync,
  type Optional,
  type Result
} from '../utils/fp';

const DB_NAME = 'WizardChessSessionDB';
const DB_VERSION = 1;
const STORE_NAME = 'sanctuary_sessions';
export const SESSION_KEY = 'active_session';
export const PREFERENCE_KEY = 'persistence_preference';

/**
 * Opens or upgrades the IndexedDB instance for lightweight session state persistence.
 * Completely independent of localStorage.
 */
export async function openSessionDatabase(): Promise<Result<IDBDatabase, string>> {
  return tryCatchAsync(async () => {
    if (typeof indexedDB === 'undefined') {
      throw new Error('IndexedDB is not available in this environment');
    }

    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error?.message || 'Failed to open IndexedDB');
    });
  }, (err) => (err as Error)?.message || 'IndexedDB connection failed');
}

/**
 * Loads the saved session state from IndexedDB if it exists.
 */
export async function loadSavedSession(): Promise<Optional<StoredSessionState>> {
  const dbResult = await openSessionDatabase();
  if (dbResult.isFailure()) {
    return none<StoredSessionState>();
  }

  const db = dbResult.value;

  const readResult = await tryCatchAsync(async () => {
    return new Promise<Optional<StoredSessionState>>((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(SESSION_KEY);

      request.onsuccess = () => {
        const result = fromNullable(request.result as StoredSessionState | undefined);
        resolve(result);
      };

      request.onerror = () => reject(request.error?.message || 'Read error');
    });
  }, (err) => (err as Error)?.message || 'Read exception');

  return readResult.fold(
    () => none<StoredSessionState>(),
    (opt) => opt
  );
}

/**
 * Persists the game session state to IndexedDB.
 */
export async function saveSessionState(session: StoredSessionState): Promise<Result<void, string>> {
  const dbResult = await openSessionDatabase();
  if (dbResult.isFailure()) {
    return failure(dbResult.error);
  }

  const db = dbResult.value;

  return tryCatchAsync(async () => {
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put({ ...session, id: SESSION_KEY });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error?.message || 'Write error');
    });
  }, (err) => (err as Error)?.message || 'Failed to save session to IndexedDB');
}

/**
 * Clears the persisted session from IndexedDB.
 */
export async function clearSessionState(): Promise<Result<void, string>> {
  const dbResult = await openSessionDatabase();
  if (dbResult.isFailure()) {
    return failure(dbResult.error);
  }

  const db = dbResult.value;

  return tryCatchAsync(async () => {
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(SESSION_KEY);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error?.message || 'Delete error');
    });
  }, (err) => (err as Error)?.message || 'Failed to clear session from IndexedDB');
}

/**
 * Retrieves the user's preference for whether session persistence is enabled.
 */
export async function getPersistencePreference(): Promise<boolean> {
  const dbResult = await openSessionDatabase();
  if (dbResult.isFailure()) return false;

  const db = dbResult.value;

  const prefResult = await tryCatchAsync(async () => {
    return new Promise<boolean>((resolve) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(PREFERENCE_KEY);

      request.onsuccess = () => {
        resolve(Boolean(request.result?.enabled));
      };

      request.onerror = () => resolve(false);
    });
  }, () => false);

  return prefResult.fold(() => false, (val) => val);
}

/**
 * Saves the user's checkbox preference for session persistence to IndexedDB.
 */
export async function setPersistencePreference(enabled: boolean): Promise<Result<void, string>> {
  const dbResult = await openSessionDatabase();
  if (dbResult.isFailure()) {
    return failure(dbResult.error);
  }

  const db = dbResult.value;

  return tryCatchAsync(async () => {
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put({ id: PREFERENCE_KEY, enabled, updatedAt: Date.now() });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error?.message || 'Failed to save preference');
    });
  }, (err) => (err as Error)?.message || 'Failed to set preference in IndexedDB');
}
