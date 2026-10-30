import { z } from 'zod';
import { failure, success, tryCatchAsync, type Option, type Result } from '../utils/fp';
import { parseWith } from '../validation/realtimeSchemas';
import {
  loadArcadePlayerCredentials,
  saveArcadePlayerCredentials,
  type ArcadePlayerCredentials
} from '../storage/indexedDbStore';

export const ARCADE_PLAYERS_COLLECTION = 'tbl_arcade_players';
const GUEST_EMAIL_DOMAIN = 'players.sanctuary.invalid';

/** An authenticated guest player: the id is the realtime participant id, the token authorizes writes. */
export interface ArcadePlayerSession {
  readonly id: string;
  readonly token: string;
}

const AuthResponseSchema = z.object({
  token: z.string().min(1),
  record: z.object({ id: z.string().min(1) })
});

/** Storage for the encrypted guest credentials; injectable for tests. */
export interface PlayerCredentialStore {
  readonly load: () => Promise<Option<ArcadePlayerCredentials>>;
  readonly save: (credentials: ArcadePlayerCredentials) => Promise<Result<void, string>>;
}

export const encryptedCredentialStore: PlayerCredentialStore = {
  load: loadArcadePlayerCredentials,
  save: saveArcadePlayerCredentials
};

const randomHex = (bytes: number): string =>
  Array.from(globalThis.crypto.getRandomValues(new Uint8Array(bytes)), b => b.toString(16).padStart(2, '0')).join('');

/** Fresh guest credentials: an unroutable email and a 48-character random password (bcrypt allows up to 71). */
export const newGuestCredentials = (): ArcadePlayerCredentials => ({
  email: `guest-${randomHex(12)}@${GUEST_EMAIL_DOMAIN}`,
  password: randomHex(24)
});

const authenticate = async (baseUrl: string,
                            credentials: ArcadePlayerCredentials,
                            fetchFn: typeof fetch): Promise<Result<ArcadePlayerSession, string>> => {
  const res = await fetchFn(`${baseUrl}/api/collections/${ARCADE_PLAYERS_COLLECTION}/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: credentials.email, password: credentials.password })
  });
  if (!res.ok) return failure(`Player sign-in failed: HTTP ${res.status}`);
  return parseWith(AuthResponseSchema, await res.json(), 'player auth response')
    .map(auth => ({ id: auth.record.id, token: auth.token }));
};

const register = async (baseUrl: string,
                        credentials: ArcadePlayerCredentials,
                        displayName: string,
                        fetchFn: typeof fetch): Promise<Result<void, string>> => {
  const res = await fetchFn(`${baseUrl}/api/collections/${ARCADE_PLAYERS_COLLECTION}/records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: credentials.email,
      password: credentials.password,
      passwordConfirm: credentials.password,
      txt_display_name: displayName.slice(0, 40)
    })
  });
  return res.ok ? success(undefined) : failure(`Player registration failed: HTTP ${res.status}`);
};

/**
 * Signs this browser in as its guest arcade player, creating the account on first use. Stored
 * credentials are reused; if they no longer work (e.g. the account was removed) a new account is made.
 */
export async function ensureArcadePlayer(baseUrl: string,
                                         displayName: string = 'Cathedral Player',
                                         store: PlayerCredentialStore = encryptedCredentialStore,
                                         fetchFn: typeof fetch = fetch): Promise<Result<ArcadePlayerSession, string>> {
  const url = baseUrl.replace(/\/+$/, '');
  const fresh = async (): Promise<Result<ArcadePlayerSession, string>> => {
    const credentials = newGuestCredentials();
    const registered = await register(url, credentials, displayName, fetchFn);
    if (registered.isFailure()) return registered.map(() => ({ id: '', token: '' }));
    const session = await authenticate(url, credentials, fetchFn);
    if (session.isSuccess()) await store.save(credentials);
    return session;
  };

  return tryCatchAsync(async () => {
    const stored = await store.load();
    const resumed = await stored.match({
      Some: credentials => authenticate(url, credentials, fetchFn),
      None: async () => failure<ArcadePlayerSession, string>('No stored player')
    });
    return resumed.isSuccess() ? resumed : await fresh();
  }, err => `Player sign-in failed: ${String(err)}`).then(res => res.flatMap(inner => inner));
}
