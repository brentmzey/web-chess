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

  it('runs schema migration updating existing collections and creating missing collections (including 28 multi-game and 4 config tables)', async () => {
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
      if (u.includes('/records?perPage=1')) {
        return new Response(JSON.stringify({ totalItems: 1 }), { status: 200 });
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
    expect(res.applied.length).toBe(39);
    expect(res.errors.length).toBe(0);
  });

  it('handles admin auth fallback when _superusers endpoint is 404 and supports includeMultiGame=false', async () => {
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
      if (u.includes('/records?perPage=1')) {
        return new Response(JSON.stringify({ totalItems: 1 }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: 'created' }), { status: 200 });
    }) as any;

    const res = await runPocketBaseMigration('https://web-chess.pockethost.io', 'admin@example.com', 'password', false);
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

    const res = await runPocketBaseMigration('https://web-chess.pockethost.io', 'admin@example.com', 'pass', false);
    expect(res.success).toBe(false);
    expect(res.errors.length).toBe(8);
  });

  it('seeds default arcade games and system controls when collections are newly created and empty', async () => {
    const seededEndpoints: string[] = [];
    globalThis.fetch = mock(async (url: any, init?: any) => {
      const u = String(url);
      if (u.includes('_superusers/auth-with-password')) {
        return new Response(JSON.stringify({ token: 'test-token' }), { status: 200 });
      }
      if (u.includes('/api/collections?perPage=200')) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }
      if (u.includes('/records?perPage=1')) {
        // Table is empty, triggers seeding
        return new Response(JSON.stringify({ totalItems: 0 }), { status: 200 });
      }
      if (init?.method === 'POST') {
        if (u.includes('/records')) {
          seededEndpoints.push(u);
        }
        return new Response(JSON.stringify({ id: 'seeded_rec' }), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    }) as any;

    const res = await runPocketBaseMigration('https://web-chess.pockethost.io', 'admin@example.com', 'password', true);
    expect(res.success).toBe(true);
    // 39 collections created + 9 games seeded + 11 controls seeded = 59
    expect(res.applied.length).toBe(59);
    expect(res.applied).toContain('seeded: chess');
    expect(res.applied).toContain('seeded: blackjack');
    expect(res.applied).toContain('seeded: solitaire');
    expect(res.applied).toContain('seeded: ui.app_title');
    expect(res.applied).toContain('seeded: system.wake_lock_default');
    expect(seededEndpoints.length).toBe(20);
  });

  it('handles seed network exceptions and failed record creation gracefully', async () => {
    // 1. Partial seed creation failure (createRes returns 400)
    globalThis.fetch = mock(async (url: any, init?: any) => {
      const u = String(url);
      if (u.includes('auth-with-password')) {
        return new Response(JSON.stringify({ token: 'test-token' }), { status: 200 });
      }
      if (u.includes('/api/collections?perPage=200')) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }
      if (u.includes('/records?perPage=1')) {
        return new Response(JSON.stringify({ totalItems: 0 }), { status: 200 });
      }
      if (u.includes('/records') && init?.method === 'POST') {
        return new Response('Seed validation error', { status: 400 });
      }
      return new Response(JSON.stringify({ id: 'col_id' }), { status: 200 });
    }) as any;

    const resFailRecord = await runPocketBaseMigration('https://web-chess.pockethost.io', 'admin@example.com', 'pass', true);
    expect(resFailRecord.success).toBe(true);
    expect(resFailRecord.applied.length).toBe(39); // Only collections, no seeded records added

    // 2. Network error during seed check triggers catch (seedErr)
    globalThis.fetch = mock(async (url: any) => {
      const u = String(url);
      if (u.includes('auth-with-password')) {
        return new Response(JSON.stringify({ token: 'test-token' }), { status: 200 });
      }
      if (u.includes('/api/collections?perPage=200')) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }
      if (u.includes('/records?perPage=1')) {
        throw new Error('Connection reset by peer');
      }
      return new Response(JSON.stringify({ id: 'col_id' }), { status: 200 });
    }) as any;

    const resThrow = await runPocketBaseMigration('https://web-chess.pockethost.io', 'admin@example.com', 'pass', true);
    expect(resThrow.success).toBe(true);
    expect(resThrow.applied.length).toBe(39);
  });
});
