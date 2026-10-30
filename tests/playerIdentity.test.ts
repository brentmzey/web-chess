import { describe, expect, it } from 'bun:test';
import { none, some, success, type Option } from '../src/utils/fp';
import {
  ARCADE_PLAYERS_COLLECTION,
  ensureArcadePlayer,
  newGuestCredentials,
  type PlayerCredentialStore
} from '../src/realtime/playerIdentity';
import type { ArcadePlayerCredentials } from '../src/storage/indexedDbStore';

const BASE = 'https://pb.test';

const memoryStore = (initial: Option<ArcadePlayerCredentials> = none()) => {
  let saved = initial;
  const store: PlayerCredentialStore = {
    load: async () => saved,
    save: async credentials => {
      saved = some(credentials);
      return success(undefined);
    }
  };
  return { store, saved: () => saved };
};

const fakeServer = (accounts: Map<string, string>,
                    options: { readonly registerStatus?: number; readonly malformedAuth?: boolean } = {}) => {
  const calls: string[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (url.endsWith(`/api/collections/${ARCADE_PLAYERS_COLLECTION}/records`)) {
      calls.push('register');
      if (options.registerStatus) return new Response('{}', { status: options.registerStatus });
      accounts.set(body.email, body.password);
      return new Response(JSON.stringify({ id: `id_${accounts.size}` }), { status: 200 });
    }
    calls.push('auth');
    if (accounts.get(body.identity) !== body.password) return new Response('{}', { status: 400 });
    const index = [...accounts.keys()].indexOf(body.identity) + 1;
    return new Response(JSON.stringify(options.malformedAuth ? { token: '' } : { token: `tok_${index}`, record: { id: `id_${index}` } }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
};

describe('Guest arcade player identity', () => {
  it('creates unroutable guest credentials with a bcrypt-safe password', () => {
    const a = newGuestCredentials();
    const b = newGuestCredentials();
    expect(a.email).toMatch(/^guest-[0-9a-f]{24}@players\.sanctuary\.invalid$/);
    expect(a.password).toMatch(/^[0-9a-f]{48}$/);
    expect(a.email).not.toBe(b.email);
  });

  it('registers on first visit, stores the credentials, and reuses them afterwards', async () => {
    const accounts = new Map<string, string>();
    const { store, saved } = memoryStore();
    const { fetchFn, calls } = fakeServer(accounts);

    const first = (await ensureArcadePlayer(`${BASE}/`, 'Ana', store, fetchFn)).getOrThrow();
    expect(first).toEqual({ id: 'id_1', token: 'tok_1' });
    expect(saved().isSome()).toBe(true);
    expect(calls).toEqual(['register', 'auth']);

    const again = (await ensureArcadePlayer(BASE, 'Ana', store, fetchFn)).getOrThrow();
    expect(again.id).toBe('id_1');
    expect(calls).toEqual(['register', 'auth', 'auth']);
  });

  it('replaces stored credentials that no longer sign in', async () => {
    const accounts = new Map<string, string>();
    const { store, saved } = memoryStore(some({ email: 'gone@players.sanctuary.invalid', password: 'x'.repeat(48) }));
    const { fetchFn, calls } = fakeServer(accounts);

    const session = (await ensureArcadePlayer(BASE, 'Bo', store, fetchFn)).getOrThrow();
    expect(session.id).toBe('id_1');
    expect(calls).toEqual(['auth', 'register', 'auth']);
    expect(saved().map(c => c.email).getOrElse('')).not.toBe('gone@players.sanctuary.invalid');
  });

  it('reports registration, malformed responses and network failures', async () => {
    const rejected = fakeServer(new Map(), { registerStatus: 400 });
    const res = await ensureArcadePlayer(BASE, 'Cy', memoryStore().store, rejected.fetchFn);
    expect(res.match({ Ok: () => '', Err: e => e })).toBe('Player registration failed: HTTP 400');

    const malformed = fakeServer(new Map(), { malformedAuth: true });
    const bad = await ensureArcadePlayer(BASE, 'Cy', memoryStore().store, malformed.fetchFn);
    expect(bad.match({ Ok: () => '', Err: e => e })).toContain('Invalid player auth response');

    const offline = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const down = await ensureArcadePlayer(BASE, 'Cy', memoryStore().store, offline);
    expect(down.match({ Ok: () => '', Err: e => e })).toBe('Player sign-in failed: Error: offline');
  });
});
