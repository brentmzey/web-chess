import { afterEach, describe, expect, it } from 'bun:test';
import { prunePocketBaseSessions } from '../src/server/pocketbase/pruner';

describe('PocketBase Cascade Pruner Service & Stale Session Maintenance', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('authenticates with _superusers, queries stale sessions, and cascade deletes them', async () => {
    const deletedIds: string[] = [];

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();

      // 1. Superuser Auth
      if (urlStr.includes('/api/collections/_superusers/auth-with-password')) {
        return new Response(JSON.stringify({ token: 'mock-su-token' }), { status: 200 });
      }

      // 2. Query stale sessions
      if (urlStr.includes('/api/collections/game_sessions/records?filter=')) {
        return new Response(
          JSON.stringify({
            items: [
              { id: 'sess_1', session_code: 'SANCT-OLD1', created: '2026-10-01 10:00:00.000Z' },
              { id: 'sess_2', session_code: 'SANCT-OLD2', created: '2026-10-02 10:00:00.000Z' }
            ],
            totalItems: 2
          }),
          { status: 200 }
        );
      }

      // 3. Delete session
      if (urlStr.includes('/api/collections/game_sessions/records/') && init?.method === 'DELETE') {
        const id = urlStr.split('/').pop()!;
        deletedIds.push(id);
        return new Response('', { status: 204 });
      }

      return new Response('Not found', { status: 404 });
    }) as any;

    const res = await prunePocketBaseSessions(
      'https://test.pockethost.io',
      'admin@test.com',
      'password123',
      3
    );

    expect(res.isSuccess()).toBe(true);
    const report = res.getOrThrow();
    expect(report.deletedSessionsCount).toBe(2);
    expect(report.sessionCodes).toEqual(['SANCT-OLD1', 'SANCT-OLD2']);
    expect(deletedIds).toEqual(['sess_1', 'sess_2']);
  });

  it('falls back to admin authentication if _superusers endpoint is unavailable', async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = url.toString();

      if (urlStr.includes('/api/collections/_superusers/auth-with-password')) {
        return new Response('Not Found', { status: 404 });
      }

      if (urlStr.includes('/api/admins/auth-with-password')) {
        return new Response(JSON.stringify({ token: 'mock-admin-token' }), { status: 200 });
      }

      if (urlStr.includes('/api/collections/game_sessions/records?filter=')) {
        return new Response(JSON.stringify({ items: [], totalItems: 0 }), { status: 200 });
      }

      return new Response('Not found', { status: 404 });
    }) as any;

    const res = await prunePocketBaseSessions(
      'https://test.pockethost.io',
      'admin@test.com',
      'password123'
    );

    expect(res.isSuccess()).toBe(true);
    expect(res.getOrThrow().deletedSessionsCount).toBe(0);
  });

  it('fails gracefully when both superuser and admin authentication fail', async () => {
    globalThis.fetch = (async () => {
      return new Response('Unauthorized', { status: 401 });
    }) as any;

    const res = await prunePocketBaseSessions(
      'https://test.pockethost.io',
      'bad@test.com',
      'wrongpass'
    );

    expect(res.isFailure()).toBe(true);
    expect(res.match({ Ok: () => '', Err: err => err })).toBe('Superuser authentication failed');
  });

  it('fails gracefully when stale session query fails', async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('auth-with-password')) {
        return new Response(JSON.stringify({ token: 'mock-token' }), { status: 200 });
      }
      return new Response('Internal Server Error', { status: 500 });
    }) as any;

    const res = await prunePocketBaseSessions(
      'https://test.pockethost.io',
      'admin@test.com',
      'password'
    );

    expect(res.isFailure()).toBe(true);
    expect(res.match({ Ok: () => '', Err: err => err })).toBe('Failed to query stale game sessions');
  });

  it('continues and logs warning when an individual session deletion throws or fails', async () => {
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();

      if (urlStr.includes('auth-with-password')) {
        return new Response(JSON.stringify({ token: 'mock-token' }), { status: 200 });
      }

      if (urlStr.includes('/api/collections/game_sessions/records?filter=')) {
        return new Response(
          JSON.stringify({
            items: [
              { id: 'sess_fail', session_code: 'SANCT-FAIL', created: '2026-10-01 10:00:00.000Z' },
              { id: 'sess_ok', session_code: 'SANCT-OK', created: '2026-10-02 10:00:00.000Z' }
            ],
            totalItems: 2
          }),
          { status: 200 }
        );
      }

      if (urlStr.includes('/sess_fail') && init?.method === 'DELETE') {
        return new Response('Locked', { status: 423 });
      }

      if (urlStr.includes('/sess_ok') && init?.method === 'DELETE') {
        return new Response('', { status: 204 });
      }

      return new Response('Not found', { status: 404 });
    }) as any;

    const res = await prunePocketBaseSessions(
      'https://test.pockethost.io',
      'admin@test.com',
      'password'
    );

    expect(res.isSuccess()).toBe(true);
    const report = res.getOrThrow();
    expect(report.deletedSessionsCount).toBe(1);
    expect(report.sessionCodes).toEqual(['SANCT-OK']);
  });
});
