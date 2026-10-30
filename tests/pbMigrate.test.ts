import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_ARCADE_GAME_CONFIGS, DEFAULT_SYSTEM_CONTROLS } from '../src/constants/defaultConfigs';
import { describe, expect, it, mock, beforeEach, afterEach } from 'bun:test';
import { runPocketBaseMigration } from '../src/server/pocketbase/migrator';

const COLLECTION_COUNT =
  (JSON.parse(readFileSync(join(import.meta.dir, '../src/server/pocketbase/schema.json'), 'utf-8')) as unknown[]).length +
  (JSON.parse(readFileSync(join(import.meta.dir, '../src/server/pocketbase/multiGameSchema.json'), 'utf-8')) as { collections: unknown[] }).collections.length;

const ALL_CONFIG_KEYS = [
  ...DEFAULT_ARCADE_GAME_CONFIGS.map(g => ({ txt_game_key: g.txt_game_key })),
  ...DEFAULT_SYSTEM_CONTROLS.map(c => ({ txt_config_key: c.txt_config_key }))
];

describe('PocketBase Schema Migration Runner (scripts/pb-migrate.ts)', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('runs schema migration updating existing collections and creating missing collections (including 28 multi-game tables, the arcade event stream, and config tables)', async () => {
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
      if (u.includes('/records?perPage=500')) {
        // Every default key already exists, so nothing is seeded
        return new Response(JSON.stringify({ items: ALL_CONFIG_KEYS }), { status: 200 });
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
    expect(res.applied.length).toBe(COLLECTION_COUNT);
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
      if (u.includes('/records?perPage=500')) {
        // Every default key already exists, so nothing is seeded
        return new Response(JSON.stringify({ items: ALL_CONFIG_KEYS }), { status: 200 });
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
      if (u.includes('/records?perPage=500')) {
        // Tables are empty, so every default key is seeded
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
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
    expect(res.applied.length).toBe(COLLECTION_COUNT + DEFAULT_ARCADE_GAME_CONFIGS.length + DEFAULT_SYSTEM_CONTROLS.length);
    expect(res.applied).toContain('seeded: chess');
    expect(res.applied).toContain('seeded: blackjack');
    expect(res.applied).toContain('seeded: solitaire');
    expect(res.applied).toContain('seeded: ui.app_title');
    expect(res.applied).toContain('seeded: system.wake_lock_default');
    expect(seededEndpoints.length).toBe(DEFAULT_ARCADE_GAME_CONFIGS.length + DEFAULT_SYSTEM_CONTROLS.length);
    expect(res.applied).toContain('seeded: system.history_retention_days');
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
      if (u.includes('/records?perPage=500')) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      if (u.includes('/records') && init?.method === 'POST') {
        return new Response('Seed validation error', { status: 400 });
      }
      return new Response(JSON.stringify({ id: 'col_id' }), { status: 200 });
    }) as any;

    const resFailRecord = await runPocketBaseMigration('https://web-chess.pockethost.io', 'admin@example.com', 'pass', true);
    expect(resFailRecord.success).toBe(true);
    expect(resFailRecord.applied.length).toBe(COLLECTION_COUNT); // Only collections, no seeded records added

    // 2. Network error during seed check triggers catch (seedErr)
    globalThis.fetch = mock(async (url: any) => {
      const u = String(url);
      if (u.includes('auth-with-password')) {
        return new Response(JSON.stringify({ token: 'test-token' }), { status: 200 });
      }
      if (u.includes('/api/collections?perPage=200')) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }
      if (u.includes('/records?perPage=500')) {
        throw new Error('Connection reset by peer');
      }
      return new Response(JSON.stringify({ id: 'col_id' }), { status: 200 });
    }) as any;

    const resThrow = await runPocketBaseMigration('https://web-chess.pockethost.io', 'admin@example.com', 'pass', true);
    expect(resThrow.success).toBe(true);
    expect(resThrow.applied.length).toBe(COLLECTION_COUNT);
  });

  it('upserts only missing configuration keys and never overwrites tuned values', async () => {
    const posted: string[] = [];
    globalThis.fetch = mock(async (url: any, init?: any) => {
      const u = String(url);
      if (u.includes('auth-with-password')) {
        return new Response(JSON.stringify({ token: 'test-token' }), { status: 200 });
      }
      if (u.includes('/api/collections?perPage=200')) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }
      if (u.includes('tbl_cfg_arcade_games/records?perPage=500')) {
        return new Response(JSON.stringify({ items: ALL_CONFIG_KEYS.filter(k => 'txt_game_key' in k) }), { status: 200 });
      }
      if (u.includes('tbl_cfg_system_controls/records?perPage=500')) {
        return new Response(JSON.stringify({ items: [{ txt_config_key: 'ui.app_title' }] }), { status: 200 });
      }
      if (u.includes('/records') && init?.method === 'POST') {
        posted.push(JSON.parse(init.body).txt_config_key);
        return new Response(JSON.stringify({ id: 'seeded' }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: 'col_id' }), { status: 200 });
    }) as any;

    const res = await runPocketBaseMigration('https://web-chess.pockethost.io', 'admin@example.com', 'pass', true);
    expect(res.success).toBe(true);
    expect(posted).not.toContain('ui.app_title');
    expect(posted).toContain('arcade.bot_turn_delay_ms');
    expect(posted.length).toBe(DEFAULT_SYSTEM_CONTROLS.length - 1);
  });
});
