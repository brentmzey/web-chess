import { afterEach, describe, expect, it } from 'bun:test';
import {
  prunePocketBaseSessions,
  restoreArchivedPocketBaseSession,
  triggerPocketBaseServerCron
} from '../src/server/pocketbase/pruner';

describe('PocketBase Cascade Pruner Service & Stale Session Maintenance', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('authenticates with _superusers, snapshots stale sessions, cascade deletes them, and writes audit record', async () => {
    const deletedIds: string[] = [];
    let auditBody: any = null;
    let historyBody: any = null;
    const deletedOldAuditLogs: string[] = [];
    const savedSnapshots: any[] = [];

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
              { id: 'sess_1', session_code: 'SANCT-OLD1', fen: 'start', ply: 2, created: '2026-10-01 10:00:00.000Z', updated: '2026-10-01 10:00:00.000Z', status: 'in_progress' },
              { id: 'sess_2', session_code: 'SANCT-OLD2', fen: 'start', ply: 4, created: '2026-10-02 10:00:00.000Z', updated: '2026-10-02 10:00:00.000Z', status: 'in_progress' }
            ],
            totalItems: 2
          }),
          { status: 200 }
        );
      }

      // Query child moves
      if (urlStr.includes('/api/collections/game_moves/records?filter=')) {
        return new Response(JSON.stringify({ items: [{ san: 'e4' }, { san: 'e5' }] }), { status: 200 });
      }

      // Query child participants
      if (urlStr.includes('/api/collections/session_participants/records?filter=')) {
        return new Response(
          JSON.stringify({
            items: [
              { role: 'white', player_name: 'WhiteMaster' },
              { role: 'black', player_name: 'BlackMaster' }
            ]
          }),
          { status: 200 }
        );
      }

      // Create snapshot in tbl_archived_game_snapshots
      if (urlStr.includes('/api/collections/tbl_archived_game_snapshots/records') && init?.method === 'POST') {
        const body = JSON.parse(init.body as string);
        savedSnapshots.push(body);
        return new Response(JSON.stringify({ id: 'snap_rec_123' }), { status: 200 });
      }

      // 3. Delete session
      if (urlStr.includes('/api/collections/game_sessions/records/') && init?.method === 'DELETE') {
        const id = urlStr.split('/').pop()!;
        deletedIds.push(id);
        return new Response('', { status: 204 });
      }

      // 4. Create audit record in tbl_audit_cleanup_logs
      if (urlStr.includes('/api/collections/tbl_audit_cleanup_logs/records') && init?.method === 'POST') {
        auditBody = JSON.parse(init.body as string);
        return new Response(JSON.stringify({ id: 'audit_rec_123' }), { status: 200 });
      }

      // 5. Query old audit logs for partition archival
      if (urlStr.includes('/api/collections/tbl_audit_cleanup_logs/records?filter=')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'old_log_1',
                txt_trace_id: 'trc_old_001',
                txt_trigger_source: 'cron_hook',
                int_deleted_sessions: 3,
                txt_cutoff_timestamp: '2026-09-01 00:00:00',
                txt_pruned_codes_json: ['SANCT-OLD1'],
                int_duration_ms: 120,
                bln_success: true,
                txt_error_message: ''
              }
            ]
          }),
          { status: 200 }
        );
      }

      // 6. Partition rollover: copy to tbl_audit_cleanup_logs_history
      if (urlStr.includes('/api/collections/tbl_audit_cleanup_logs_history/records') && init?.method === 'POST') {
        historyBody = JSON.parse(init.body as string);
        return new Response(JSON.stringify({ id: 'hist_rec_123' }), { status: 200 });
      }

      // 7. Delete old audit log from active tbl_audit_cleanup_logs
      if (urlStr.includes('/api/collections/tbl_audit_cleanup_logs/records/') && init?.method === 'DELETE') {
        const id = urlStr.split('/').pop()!;
        deletedOldAuditLogs.push(id);
        return new Response('', { status: 204 });
      }

      // Query old snapshots for partition archival
      if (urlStr.includes('/api/collections/tbl_archived_game_snapshots/records?filter=')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'old_snap_1',
                txt_session_code: 'SANCT-OLD-ROLLOVER',
                txt_final_fen: 'fen1',
                txt_white_player: 'W',
                txt_black_player: 'B',
                txt_winner: '',
                txt_status: 'in_progress',
                int_total_plies: 10,
                txt_pgn: 'e4',
                json_snapshot_payload: {},
                txt_pruned_reason: 'stale'
              }
            ]
          }),
          { status: 200 }
        );
      }

      if (urlStr.includes('/api/collections/tbl_archived_game_snapshots_history/records') && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'hist_snap_1' }), { status: 200 });
      }

      if (urlStr.includes('/api/collections/tbl_archived_game_snapshots/records/') && init?.method === 'DELETE') {
        return new Response('', { status: 204 });
      }

      // Purge config audit records
      if (urlStr.includes('/api/collections/tbl_audit_config_history/records?filter=')) {
        return new Response(JSON.stringify({ items: [{ id: 'old_cfg_log_1' }] }), { status: 200 });
      }

      if (urlStr.includes('/api/collections/tbl_audit_config_history/records/') && init?.method === 'DELETE') {
        return new Response('', { status: 204 });
      }

      return new Response('Not found', { status: 404 });
    }) as any;

    const res = await prunePocketBaseSessions(
      'https://test.pockethost.io',
      'admin@test.com',
      'password123',
      3,
      100,
      'cli_manual'
    );

    expect(res.isSuccess()).toBe(true);
    const report = res.getOrThrow();
    expect(report.deletedSessionsCount).toBe(2);
    expect(report.sessionCodes).toEqual(['SANCT-OLD1', 'SANCT-OLD2']);
    expect(deletedIds).toEqual(['sess_1', 'sess_2']);
    expect(report.auditLogId).toBe('audit_rec_123');
    expect(report.traceId).toContain('trc_cln_');
    expect(report.triggerSource).toBe('cli_manual');
    expect(auditBody.int_deleted_sessions).toBe(2);
    expect(auditBody.bln_success).toBe(true);

    // Verify snapshot records were created before deletion
    expect(savedSnapshots.length).toBe(2);
    expect(savedSnapshots[0].txt_session_code).toBe('SANCT-OLD1');
    expect(savedSnapshots[0].txt_white_player).toBe('WhiteMaster');
    expect(savedSnapshots[0].txt_black_player).toBe('BlackMaster');
    expect(savedSnapshots[0].txt_pgn).toBe('e4 e5');

    // Verify partition archival
    expect(historyBody).not.toBeNull();
    expect(historyBody.txt_trace_id).toBe('trc_old_001');
    expect(historyBody.int_deleted_sessions).toBe(3);
    expect(deletedOldAuditLogs).toEqual(['old_log_1']);
  });

  it('falls back to admin authentication if _superusers endpoint is unavailable', async () => {
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
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

      if (urlStr.includes('/api/collections/tbl_audit_cleanup_logs/records') && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'audit_rec_fallback' }), { status: 200 });
      }

      if (urlStr.includes('/api/collections/tbl_audit_cleanup_logs/records?filter=')) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
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
    expect(res.getOrThrow().auditLogId).toBe('audit_rec_fallback');
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
              { id: 'sess_fail', session_code: 'SANCT-FAIL', created: '2026-10-01 10:00:00.000Z', updated: '2026-10-01 10:00:00.000Z' },
              { id: 'sess_ok', session_code: 'SANCT-OK', created: '2026-10-02 10:00:00.000Z', updated: '2026-10-02 10:00:00.000Z' }
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

      if (urlStr.includes('/api/collections/tbl_audit_cleanup_logs/records') && init?.method === 'POST') {
        return new Response('Audit write failed', { status: 500 }); // simulate audit log warning
      }

      if (urlStr.includes('/api/collections/tbl_audit_cleanup_logs/records?filter=')) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
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
    expect(report.auditLogId).toBeUndefined(); // Handled audit failure gracefully
  });

  it('restores an archived session from tbl_archived_game_snapshots', async () => {
    let createdSessionBody: any = null;

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();

      if (urlStr.includes('/tbl_archived_game_snapshots/records?filter=')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'snap_1',
                txt_session_code: 'SANCT-RESTORE',
                json_snapshot_payload: {
                  session: {
                    session_code: 'SANCT-RESTORE',
                    mode: 'live',
                    theme: 'high-gothic',
                    timer_rule: 'standard',
                    strict_mode: false,
                    status: 'in_progress',
                    current_turn: 'w',
                    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
                    ply: 0
                  }
                }
              }
            ]
          }),
          { status: 200 }
        );
      }

      if (urlStr.includes('/game_sessions/records') && init?.method === 'POST') {
        createdSessionBody = JSON.parse(init.body as string);
        return new Response(JSON.stringify({ id: 'restored_sess_id' }), { status: 200 });
      }

      return new Response('Not found', { status: 404 });
    }) as any;

    const res = await restoreArchivedPocketBaseSession('https://test.pockethost.io', 'token123', 'SANCT-RESTORE');
    expect(res.isSuccess()).toBe(true);
    expect(res.getOrThrow().session_code).toBe('SANCT-RESTORE');
    expect(createdSessionBody.session_code).toBe('SANCT-RESTORE');
    expect(createdSessionBody.status).toBe('in_progress');
  });

  it('returns failure when snapshot is not found during restoration', async () => {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }) as any;

    const res = await restoreArchivedPocketBaseSession('https://test.pockethost.io', 'token123', 'SANCT-UNKNOWN');
    expect(res.isFailure()).toBe(true);
    expect(res.match({ Ok: () => '', Err: (e: any) => e?.message || String(e) })).toContain('not found');
  });

  it('restores an archived session from tbl_archived_game_snapshots_history when not in active table', async () => {
    let createdSessionBody: any = null;

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();

      if (urlStr.includes('/tbl_archived_game_snapshots/records?filter=')) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 }); // not in active table
      }

      if (urlStr.includes('/tbl_archived_game_snapshots_history/records?filter=')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'snap_hist_1',
                txt_session_code: 'SANCT-FROM-HIST',
                json_snapshot_payload: {
                  session: {
                    session_code: 'SANCT-FROM-HIST',
                    mode: 'live',
                    theme: 'high-gothic',
                    timer_rule: 'standard',
                    strict_mode: false,
                    status: 'concluded',
                    current_turn: 'b',
                    fen: 'start',
                    ply: 20
                  }
                }
              }
            ]
          }),
          { status: 200 }
        );
      }

      if (urlStr.includes('/game_sessions/records') && init?.method === 'POST') {
        createdSessionBody = JSON.parse(init.body as string);
        return new Response(JSON.stringify({ id: 'restored_hist_sess' }), { status: 200 });
      }

      return new Response('Not found', { status: 404 });
    }) as any;

    const res = await restoreArchivedPocketBaseSession('https://test.pockethost.io', 'token123', 'SANCT-FROM-HIST');
    expect(res.isSuccess()).toBe(true);
    expect(res.getOrThrow().session_code).toBe('SANCT-FROM-HIST');
    expect(createdSessionBody.session_code).toBe('SANCT-FROM-HIST');
  });

  it('prune query explicitly requires do_not_delete != true to protect pinned matches', async () => {
    let capturedFilter = '';

    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('auth-with-password')) {
        return new Response(JSON.stringify({ token: 'mock-token' }), { status: 200 });
      }
      if (urlStr.includes('/api/collections/game_sessions/records?filter=')) {
        capturedFilter = decodeURIComponent(urlStr.split('filter=')[1].split('&')[0]);
        return new Response(JSON.stringify({ items: [], totalItems: 0 }), { status: 200 });
      }
      if (urlStr.includes('tbl_audit_cleanup_logs')) {
        return new Response(JSON.stringify({ id: 'audit_1' }), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    }) as any;

    const res = await prunePocketBaseSessions('https://test.pockethost.io', 'admin@test.com', 'password');
    expect(res.isSuccess()).toBe(true);
    expect(capturedFilter).toContain('do_not_delete != true');
  });

  it('updates do_not_delete on session via PocketBaseChessClient', async () => {
    const { PocketBaseChessClient } = require('../src/realtime/pocketbaseClient');
    let patchedBody: any = null;

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/collections/game_sessions/records/sess_123') && init?.method === 'PATCH') {
        patchedBody = JSON.parse(init.body as string);
        return new Response(JSON.stringify({ id: 'sess_123', do_not_delete: true }), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    }) as any;

    const res = await PocketBaseChessClient.setSessionDoNotDelete('https://test.pockethost.io', 'sess_123', true);
    expect(res.isSuccess()).toBe(true);
    expect(patchedBody).toEqual({ do_not_delete: true });

    // Instance method test
    const client = new PocketBaseChessClient({ sessionId: 'sess_123' });
    const instanceRes = await client.setDoNotDelete(false);
    expect(instanceRes.isSuccess()).toBe(true);
    expect(patchedBody).toEqual({ do_not_delete: false });
  });

  it('sweeps multi-game arcade session collections and triggers server-side PocketBase cron hook', async () => {
    const deletedArcadeIds: string[] = [];
    const savedArcadeSnapshots: any[] = [];

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();

      if (urlStr.includes('/api/collections/_superusers/auth-with-password')) {
        return new Response(JSON.stringify({ token: 'mock-su-token' }), { status: 200 });
      }
      if (urlStr.includes('/api/crons/cleanup_stale_chess_sessions') && init?.method === 'POST') {
        return new Response('', { status: 204 });
      }
      if (urlStr.includes('/api/collections/game_sessions/records?filter=')) {
        return new Response(JSON.stringify({ items: [], totalItems: 0 }), { status: 200 });
      }
      if (urlStr.includes('/api/collections/tbl_set_sessions/records?filter=')) {
        return new Response(
          JSON.stringify({
            items: [
              { id: 'set_stale_1', session_code: 'SET-OLD1', status: 'playing', do_not_delete: false, created: '2026-10-01', updated: '2026-10-01' }
            ],
            totalItems: 1
          }),
          { status: 200 }
        );
      }
      if (urlStr.includes('/api/collections/tbl_archived_set_snapshots/records') && init?.method === 'POST') {
        savedArcadeSnapshots.push(JSON.parse(init.body as string));
        return new Response(JSON.stringify({ id: 'snap_set_1' }), { status: 200 });
      }
      if (urlStr.includes('/api/collections/tbl_set_sessions/records/set_stale_1') && init?.method === 'DELETE') {
        deletedArcadeIds.push('set_stale_1');
        return new Response('', { status: 204 });
      }
      if (urlStr.includes('/api/collections/tbl_audit_cleanup_logs/records') && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'audit_arc_1' }), { status: 200 });
      }
      if (urlStr.includes('/api/collections/') && urlStr.includes('/records?filter=')) {
        return new Response(JSON.stringify({ items: [], totalItems: 0 }), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    }) as any;

    const cronRes = await triggerPocketBaseServerCron('https://test.pockethost.io', 'admin@test.com', 'pass');
    expect(cronRes.isSuccess()).toBe(true);
    expect(cronRes.getOrThrow().cronId).toBe('cleanup_stale_chess_sessions');

    const pruneRes = await prunePocketBaseSessions('https://test.pockethost.io', 'admin@test.com', 'pass', 3);
    expect(pruneRes.isSuccess()).toBe(true);
    expect(pruneRes.getOrThrow().sessionCodes).toEqual(['SET-OLD1']);
    expect(deletedArcadeIds).toEqual(['set_stale_1']);
    expect(savedArcadeSnapshots.length).toBe(1);
    expect(savedArcadeSnapshots[0].txt_session_code).toBe('SET-OLD1');
  });

  it('handles triggerPocketBaseServerCron admin fallback, auth failure, and cron failure', async () => {
    // 1. Admin fallback + cron failure
    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('_superusers')) return new Response('Not Found', { status: 404 });
      if (urlStr.includes('admins/auth-with-password')) return new Response(JSON.stringify({ token: 'adm' }), { status: 200 });
      if (urlStr.includes('/api/crons/')) return new Response('Cron error', { status: 500, statusText: 'Cron Error' });
      return new Response('Not found', { status: 404 });
    }) as any;

    const failCron = await triggerPocketBaseServerCron('https://test.pockethost.io', 'admin@test.com', 'pass');
    expect(failCron.isFailure()).toBe(true);

    // 2. Auth failure
    globalThis.fetch = (async () => new Response('Unauthorized', { status: 401 })) as any;
    const failAuth = await triggerPocketBaseServerCron('https://test.pockethost.io', 'admin@test.com', 'bad');
    expect(failAuth.isFailure()).toBe(true);
  });
});
