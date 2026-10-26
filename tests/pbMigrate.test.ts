import { describe, expect, it, mock, beforeEach, afterEach } from 'bun:test';
import { runPocketBaseMigration } from '../src/server/pocketbase/migrator';

describe('PocketBase Schema Migration Runner (scripts/pb-migrate.ts)', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('runs schema migration updating existing collections and creating missing collections', async () => {
    globalThis.fetch = mock(async (url: any, init?: any) => {
      const u = String(url);
      if (u.includes('_superusers/auth-with-password')) {
        return new Response(JSON.stringify({ token: 'test-token' }), { status: 200 });
      }
      if (u.includes('/api/collections?perPage=200')) {
        return new Response(JSON.stringify({
          items: [
            { id: 'pbc_sess', name: 'game_sessions' }
          ]
        }), { status: 200 });
      }
      if (init?.method === 'PATCH') {
        return new Response(JSON.stringify({ id: 'updated' }), { status: 200 });
      }
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'created' }), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    }) as any;

    const res = await runPocketBaseMigration('https://web-chess.pockethost.io', 'admin@example.com', 'password');
    expect(res.success).toBe(true);
    expect(res.applied.length).toBe(8);
    expect(res.errors.length).toBe(0);
  });

  it('handles admin auth fallback when _superusers endpoint is 404', async () => {
    globalThis.fetch = mock(async (url: any) => {
      const u = String(url);
      if (u.includes('_superusers/auth-with-password')) {
        return new Response('Not found', { status: 404 });
      }
      if (u.includes('admins/auth-with-password')) {
        return new Response(JSON.stringify({ token: 'admin-token' }), { status: 200 });
      }
      if (u.includes('/api/collections?perPage=200')) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: 'created' }), { status: 200 });
    }) as any;

    const res = await runPocketBaseMigration('https://web-chess.pockethost.io', 'admin@example.com', 'password');
    expect(res.success).toBe(true);
    expect(res.applied.length).toBe(8);
  });

  it('handles authentication failure gracefully', async () => {
    globalThis.fetch = mock(async () => {
      return new Response('Unauthorized', { status: 401 });
    }) as any;

    const res = await runPocketBaseMigration('https://web-chess.pockethost.io', 'admin@example.com', 'wrong-pass');
    expect(res.success).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
  });

  it('handles collection listing failure gracefully', async () => {
    globalThis.fetch = mock(async (url: any) => {
      const u = String(url);
      if (u.includes('auth-with-password')) {
        return new Response(JSON.stringify({ token: 'test-token' }), { status: 200 });
      }
      return new Response('Server error', { status: 500, statusText: 'Internal Error' });
    }) as any;

    const res = await runPocketBaseMigration('https://web-chess.pockethost.io', 'admin@example.com', 'pass');
    expect(res.success).toBe(false);
    expect(res.errors.length).toBe(1);
  });

  it('records errors when PATCH or POST fails on collections', async () => {
    globalThis.fetch = mock(async (url: any, _init?: any) => {
      const u = String(url);
      if (u.includes('auth-with-password')) {
        return new Response(JSON.stringify({ token: 'test-token' }), { status: 200 });
      }
      if (u.includes('/api/collections?perPage=200')) {
        return new Response(JSON.stringify({
          items: [{ id: 'pbc_sess', name: 'game_sessions' }]
        }), { status: 200 });
      }
      return new Response('Constraint error', { status: 400 });
    }) as any;

    const res = await runPocketBaseMigration('https://web-chess.pockethost.io', 'admin@example.com', 'pass');
    expect(res.success).toBe(false);
    expect(res.errors.length).toBe(8);
  });
});
