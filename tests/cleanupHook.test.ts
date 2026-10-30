import { describe, expect, it } from 'bun:test';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const hooksDir = path.resolve(__dirname, '../pb_hooks');
const libSource = fs.readFileSync(path.join(hooksDir, 'sanctuary_maintenance.js'), 'utf8');
const cleanupSource = fs.readFileSync(path.join(hooksDir, 'cleanup.pb.js'), 'utf8');
const tablesSource = fs.readFileSync(path.join(hooksDir, 'arcade_tables.pb.js'), 'utf8');

const DAY = 24 * 60 * 60 * 1000;
const pbDate = (ms: number) => new Date(ms).toISOString().replace('T', ' ');

class BadRequestError extends Error {}

/** Minimal in-memory stand-in for the PocketBase JSVM app, records and collections. */
class FakeCollection {
  constructor(public readonly name: string,
              public readonly fieldList: readonly string[]) {}
  public get fields() {
    const names = ['id', ...this.fieldList, 'created', 'updated'];
    return {
      fieldNames: () => names,
      getByName: (n: string) => (names.includes(n) ? { name: n } : null)
    };
  }
}

let idSeq = 0;
class FakeRecord {
  public id: string;
  public data: Record<string, any>;
  constructor(public readonly collection: FakeCollection,
              data: Record<string, any> = {}) {
    this.id = data.id ?? `rec_${++idSeq}`;
    this.data = { created: pbDate(Date.now()), updated: pbDate(Date.now()), ...data };
  }
  get(k: string) { return this.data[k]; }
  set(k: string, v: any) { this.data[k] = v; }
  getString(k: string) {
    const v = this.data[k];
    return v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  }
  getBool(k: string) { return Boolean(this.data[k]); }
  getInt(k: string) { return Number(this.data[k] ?? 0) | 0; }
  getFloat(k: string) { return Number(this.data[k] ?? 0); }
}

interface FakeAppOptions {
  readonly failTransactionsFor?: string;
  readonly throwOnFind?: string;
}

const createApp = (schema: Record<string, readonly string[]>,
                   options: FakeAppOptions = {}) => {
  const collections = new Map(Object.entries(schema).map(([n, f]) => [n, new FakeCollection(n, f)]));
  const rows = new Map<string, FakeRecord[]>([...collections.keys()].map(n => [n, []]));
  const matches = (r: FakeRecord, filter: string, p: Record<string, any>) => {
    switch (filter) {
      case 'updated < {:cutoff} && do_not_delete != true':
        return r.data.updated < p.cutoff && !r.data.do_not_delete;
      case "table = '' && updated < {:cutoff} && do_not_delete != true":
        return !r.data.table && r.data.updated < p.cutoff && !r.data.do_not_delete;
      case 'created < {:cutoff}':
        return r.data.created < p.cutoff;
      case 'created < {:cutoff} && bln_do_not_delete != true':
        return r.data.created < p.cutoff && !r.data.bln_do_not_delete;
      case 'created >= {:since}':
        return r.data.created >= p.since;
      case "id != ''":
        return true;
      case 'txt_config_key = {:key} && bln_is_active = true':
        return r.data.txt_config_key === p.key && r.data.bln_is_active === true;
      case 'session_code = {:code}':
        return r.data.session_code === p.code;
      case 'participant_id = {:id}':
        return r.data.participant_id === p.id;
      default:
        throw new Error(`unsupported filter ${filter}`);
    }
  };
  const app: any = {
    rows,
    findCollectionByNameOrId: (n: string) => {
      const c = collections.get(n);
      if (!c) throw new Error(`missing collection ${n}`);
      return c;
    },
    findRecordsByFilter: (n: string, filter: string, sort: string, limit: number, _o: number, p: Record<string, any> = {}) => {
      if (options.throwOnFind === n) throw new Error(`find failed for ${n}`);
      const key = sort.replace('-', '');
      const list = (rows.get(n) ?? []).filter(r => matches(r, filter, p))
        .sort((a, b) => (a.data[key] < b.data[key] ? -1 : 1));
      return (sort.startsWith('-') ? list.reverse() : list).slice(0, limit);
    },
    findFirstRecordByFilter: (n: string, filter: string, p: Record<string, any>) => {
      const hit = app.findRecordsByFilter(n, filter, 'created', 1, 0, p)[0];
      if (!hit) throw new Error('not found');
      return hit;
    },
    findRecordById: (n: string, id: string) => {
      const hit = (rows.get(n) ?? []).find(r => r.id === id);
      if (!hit) throw new Error('not found');
      return hit;
    },
    countRecords: (n: string) => (rows.get(n) ?? []).length,
    save: (r: FakeRecord) => {
      const list = rows.get(r.collection.name)!;
      if (!list.includes(r)) list.push(r);
      r.data.updated = r.data.updated ?? pbDate(Date.now());
    },
    delete: (r: FakeRecord) => {
      const list = rows.get(r.collection.name)!;
      list.splice(list.indexOf(r), 1);
    },
    runInTransaction: (fn: (tx: any) => void) => {
      if (options.failTransactionsFor && JSON.stringify([...rows.keys()]).includes(options.failTransactionsFor)) {
        throw new Error('transaction aborted');
      }
      fn(app);
    },
    insert: (n: string, data: Record<string, any>) => {
      const rec = new FakeRecord(collections.get(n)!, data);
      rows.get(n)!.push(rec);
      return rec;
    }
  };
  return app;
};

const loadLib = () => {
  const module = { exports: {} as any };
  vm.runInNewContext(libSource, {
    module,
    Record: FakeRecord,
    BadRequestError,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    Date,
    Math,
    JSON,
    Object,
    String,
    Boolean
  });
  return module.exports;
};

const AUDIT_FIELDS = ['txt_trace_id', 'txt_trigger_source', 'int_deleted_sessions', 'txt_cutoff_timestamp', 'txt_pruned_codes_json',
                      'int_duration_ms', 'bln_success', 'txt_error_message', 'int_archived_rows', 'int_history_purged'];
const SNAPSHOT_FIELDS = ['txt_session_code', 'txt_game_key', 'int_event_count', 'json_snapshot_payload', 'txt_pruned_reason', 'bln_do_not_delete'];
const CHESS_SNAPSHOT_FIELDS = ['txt_session_code', 'txt_final_fen', 'txt_white_player', 'txt_black_player', 'txt_winner', 'txt_status',
                               'int_total_plies', 'txt_pgn', 'json_snapshot_payload', 'txt_pruned_reason', 'bln_do_not_delete'];

const fullSchema = () => ({
  tbl_cfg_system_controls: ['txt_config_key', 'dec_val_number', 'bln_is_active'],
  tbl_audit_cleanup_logs: AUDIT_FIELDS,
  tbl_audit_cleanup_logs_history: AUDIT_FIELDS,
  game_sessions: ['session_code', 'fen', 'status', 'ply', 'do_not_delete'],
  tbl_archived_game_snapshots: CHESS_SNAPSHOT_FIELDS,
  tbl_archived_game_snapshots_history: CHESS_SNAPSHOT_FIELDS,
  tbl_uno_sessions: ['session_code', 'status', 'do_not_delete'],
  tbl_archived_uno_snapshots: ['txt_session_code', 'json_snapshot_payload', 'bln_do_not_delete'],
  tbl_archived_uno_snapshots_history: ['txt_session_code', 'json_snapshot_payload'],
  tbl_arcade_tables: ['session_code', 'game_key', 'host_participant_id', 'status', 'int_event_count', 'dt_last_event_at', 'json_last_snapshot', 'do_not_delete'],
  tbl_arcade_events: ['table', 'session_code', 'game_key', 'participant_id', 'event_type', 'event_seq', 'payload', 'do_not_delete'],
  tbl_arcade_players: ['email', 'txt_display_name'],
  tbl_archived_arcade_snapshots: SNAPSHOT_FIELDS,
  tbl_archived_arcade_snapshots_history: SNAPSHOT_FIELDS
});

describe('PocketHost maintenance library (sanctuary_maintenance.js)', () => {
  it('reads the retention policy from tbl_cfg_system_controls with safe defaults', () => {
    const lib = loadLib();
    const app = createApp(fullSchema());
    expect(lib.loadPolicy(app)).toEqual({ staleDays: 3, rotationDays: 30, maxArchiveRows: 5000, historyRetentionDays: 365, guestPlayerDays: 30 });

    app.insert('tbl_cfg_system_controls', { txt_config_key: 'system.stale_session_days', dec_val_number: 7, bln_is_active: true });
    app.insert('tbl_cfg_system_controls', { txt_config_key: 'system.archive_max_rows', dec_val_number: 0, bln_is_active: true });
    app.insert('tbl_cfg_system_controls', { txt_config_key: 'system.archive_rotation_days', dec_val_number: 9, bln_is_active: false });
    const policy = lib.loadPolicy(app);
    expect(policy.staleDays).toBe(7);
    expect(policy.maxArchiveRows).toBe(5000);
    expect(policy.rotationDays).toBe(30);
  });

  it('archives stale games into their snapshot tables and keeps pinned or active ones', () => {
    const lib = loadLib();
    const app = createApp(fullSchema());
    const old = pbDate(Date.now() - 10 * DAY);
    app.insert('game_sessions', { session_code: 'SANCT-OLD', fen: 'fen1', status: 'in_progress', ply: 12, updated: old });
    app.insert('game_sessions', { session_code: 'SANCT-PIN', fen: 'fen2', status: 'in_progress', do_not_delete: true, updated: old });
    app.insert('game_sessions', { session_code: 'SANCT-NEW', fen: 'fen3', status: 'in_progress' });
    app.insert('tbl_uno_sessions', { session_code: 'UNO-OLD', status: 'playing', updated: old });
    app.insert('tbl_arcade_tables', { session_code: 'UNO-TBL1', game_key: 'uno', status: 'active', int_event_count: 4,
                                      json_last_snapshot: { version: 1 }, updated: old });

    const report = lib.runMaintenance(app, 'test');
    expect([...report.prunedCodes].sort()).toEqual(['SANCT-OLD', 'UNO-OLD', 'UNO-TBL1']);
    expect(app.rows.get('game_sessions').map((r: FakeRecord) => r.data.session_code).sort()).toEqual(['SANCT-NEW', 'SANCT-PIN']);

    const chessSnap = app.rows.get('tbl_archived_game_snapshots')[0];
    expect(chessSnap.data.txt_final_fen).toBe('fen1');
    expect(chessSnap.data.int_total_plies).toBe(12);
    expect(chessSnap.data.txt_pruned_reason).toBe('stale_inactivity');

    const tableSnap = app.rows.get('tbl_archived_arcade_snapshots')[0];
    expect(tableSnap.data.txt_game_key).toBe('uno');
    expect(tableSnap.data.json_snapshot_payload.lastSnapshot).toEqual({ version: 1 });

    const audit = app.rows.get('tbl_audit_cleanup_logs')[0];
    expect(audit.data.bln_success).toBe(true);
    expect(audit.data.int_deleted_sessions).toBe(3);
  });

  it('rotates archives to *_history by age and by row cap, then purges expired history', () => {
    const lib = loadLib();
    const app = createApp(fullSchema());
    app.insert('tbl_cfg_system_controls', { txt_config_key: 'system.archive_max_rows', dec_val_number: 2, bln_is_active: true });
    const now = Date.now();
    app.insert('tbl_archived_uno_snapshots', { txt_session_code: 'UNO-AGED', created: pbDate(now - 40 * DAY) });
    ['UNO-A', 'UNO-B', 'UNO-C', 'UNO-D'].forEach((code, i) =>
      app.insert('tbl_archived_uno_snapshots', { txt_session_code: code, created: pbDate(now - (10 - i) * DAY) }));
    app.insert('tbl_archived_uno_snapshots_history', { txt_session_code: 'UNO-ANCIENT', created: pbDate(now - 400 * DAY) });
    app.insert('tbl_archived_game_snapshots_history', { txt_session_code: 'SANCT-KEEP', bln_do_not_delete: true, created: pbDate(now - 400 * DAY) });
    app.insert('tbl_archived_game_snapshots_history', { txt_session_code: 'SANCT-GONE', created: pbDate(now - 400 * DAY) });

    const report = lib.runMaintenance(app, 'test');
    const remaining = app.rows.get('tbl_archived_uno_snapshots').map((r: FakeRecord) => r.data.txt_session_code);
    expect(remaining).toEqual(['UNO-C', 'UNO-D']);
    const history = app.rows.get('tbl_archived_uno_snapshots_history').map((r: FakeRecord) => r.data.txt_session_code).sort();
    expect(history).toEqual(['UNO-A', 'UNO-AGED', 'UNO-B']);
    expect(app.rows.get('tbl_archived_game_snapshots_history').map((r: FakeRecord) => r.data.txt_session_code)).toEqual(['SANCT-KEEP']);
    expect(report.archivedRows).toBe(3);
    expect(report.historyPurged).toBe(2);
  });

  it('prunes idle orphan arcade events and records per-table failures without aborting', () => {
    const lib = loadLib();
    const app = createApp(fullSchema(), { throwOnFind: 'tbl_uno_sessions' });
    const old = pbDate(Date.now() - 10 * DAY);
    app.insert('tbl_arcade_events', { session_code: 'UNO-LEGACY', updated: old });
    app.insert('tbl_arcade_events', { session_code: 'UNO-LINKED', table: 'tbl_1', updated: old });

    const report = lib.runMaintenance(app, 'test');
    expect(report.orphanEvents).toBe(1);
    expect(app.rows.get('tbl_arcade_events').length).toBe(1);
    expect(report.errors.some((e: string) => e.includes('tbl_uno_sessions'))).toBe(true);
    expect(app.rows.get('tbl_audit_cleanup_logs')[0].data.bln_success).toBe(false);
  });

  it('removes idle guest players but keeps new ones and players with live table events', () => {
    const lib = loadLib();
    const app = createApp(fullSchema());
    const old = pbDate(Date.now() - 45 * DAY);
    app.insert('tbl_arcade_players', { id: 'gone', created: old });
    app.insert('tbl_arcade_players', { id: 'seated', created: old });
    app.insert('tbl_arcade_players', { id: 'fresh' });
    app.insert('tbl_arcade_events', { session_code: 'UNO-LIVE', table: 'tbl_1', participant_id: 'seated' });

    const report = lib.runMaintenance(app, 'test');
    expect(report.prunedPlayers).toBe(1);
    expect(app.rows.get('tbl_arcade_players').map((r: FakeRecord) => r.id).sort()).toEqual(['fresh', 'seated']);
  });

  it('records a failed guest player lookup without aborting maintenance', () => {
    const lib = loadLib();
    const app = createApp(fullSchema(), { throwOnFind: 'tbl_arcade_players' });
    const report = lib.runMaintenance(app, 'test');
    expect(report.errors.some((e: string) => e.startsWith('tbl_arcade_players:'))).toBe(true);

    const perPlayer = createApp(fullSchema(), { throwOnFind: 'tbl_arcade_events' });
    perPlayer.insert('tbl_arcade_players', { id: 'p1', created: pbDate(Date.now() - 45 * DAY) });
    const perPlayerReport = lib.runMaintenance(perPlayer, 'test');
    expect(perPlayerReport.errors.some((e: string) => e.startsWith('tbl_arcade_players/p1'))).toBe(true);
    expect(perPlayer.rows.get('tbl_arcade_players').length).toBe(1);
  });

  it('keeps a stale game when its archive transaction fails', () => {
    const lib = loadLib();
    const app = createApp(fullSchema(), { failTransactionsFor: 'game_sessions' });
    app.insert('game_sessions', { session_code: 'SANCT-OLD', updated: pbDate(Date.now() - 10 * DAY) });
    const report = lib.runMaintenance(app, 'test');
    expect(app.rows.get('game_sessions').length).toBe(1);
    expect(report.errors.length).toBeGreaterThan(0);
  });

  it('only runs opportunistic maintenance when the last audit is overdue', () => {
    const lib = loadLib();
    const app = createApp(fullSchema());
    expect(lib.runIfOverdue(app, 'wake_hook', 12)).not.toBeNull();
    expect(lib.runIfOverdue(app, 'wake_hook', 12)).toBeNull();
    expect(app.rows.get('tbl_audit_cleanup_logs').length).toBe(1);
  });

  it('validates arcade event codes, links events to their table, and records activity', () => {
    const lib = loadLib();
    const app = createApp(fullSchema());
    const event = (data: Record<string, any>) => new FakeRecord(app.findCollectionByNameOrId('tbl_arcade_events'), data);

    expect(() => lib.attachArcadeEventToTable(app, event({ session_code: 'not a code' }))).toThrow('Invalid arcade table code.');

    const first = event({ session_code: 'uno-abc123', game_key: 'uno', participant_id: 'usr_host', event_type: 'seat_claimed', payload: {} });
    const table = lib.attachArcadeEventToTable(app, first);
    expect(first.data.session_code).toBe('UNO-ABC123');
    expect(first.data.table).toBe(table.id);
    expect(table.data.host_participant_id).toBe('usr_host');
    app.save(first);
    lib.recordArcadeTableActivity(app, first);
    expect(table.data.status).toBe('active');
    expect(table.data.int_event_count).toBe(1);

    const sync = event({ session_code: 'UNO-ABC123', participant_id: 'usr_guest', event_type: 'action_dispatched',
                         payload: { actionType: 'state_sync', payload: { version: 1, state: { n: 2 } } } });
    expect(lib.attachArcadeEventToTable(app, sync).id).toBe(table.id);
    lib.recordArcadeTableActivity(app, sync);
    expect(table.data.json_last_snapshot).toEqual({ version: 1, state: { n: 2 } });
    expect(table.data.host_participant_id).toBe('usr_host');

    lib.recordArcadeTableActivity(app, event({ event_type: 'seat_left' }));
    lib.recordArcadeTableActivity(app, event({ table: table.id, event_type: 'action_dispatched', payload: '{not json' }));
    expect(table.data.json_last_snapshot).toEqual({ version: 1, state: { n: 2 } });

    table.data.status = 'closed';
    expect(() => lib.attachArcadeEventToTable(app, event({ session_code: 'UNO-ABC123' }))).toThrow('This arcade table is closed.');
  });
});

describe('PocketHost hook registration', () => {
  const sandboxFor = (lib: any) => {
    const registered: Record<string, any[]> = { cron: [], afterCreate: [], create: [] };
    const sandbox = {
      __hooks: '/hooks',
      require: () => lib,
      cronAdd: (...args: any[]) => registered.cron.push(args),
      onRecordAfterCreateSuccess: (...args: any[]) => registered.afterCreate.push(args),
      onRecordCreate: (...args: any[]) => registered.create.push(args),
      $app: { marker: 'app' },
      console: { log: () => {}, warn: () => {}, error: () => {} }
    };
    return { sandbox, registered };
  };

  it('schedules the twice-daily maintenance cron and the hibernation catch-up', () => {
    const calls: any[] = [];
    const lib = {
      runMaintenance: (...a: any[]) => calls.push(['run', ...a]),
      runIfOverdue: (...a: any[]) => {
        calls.push(['overdue', ...a]);
        throw new Error('boom');
      }
    };
    const { sandbox, registered } = sandboxFor(lib);
    vm.runInNewContext(cleanupSource, sandbox);

    const [name, schedule, cronFn] = registered.cron[0];
    expect(name).toBe('cleanup_stale_chess_sessions');
    expect(schedule).toBe('0 3,15 * * *');
    cronFn();
    expect(calls[0]).toEqual(['run', { marker: 'app' }, 'cron_hook']);

    const [handler, ...collections] = registered.afterCreate[0];
    expect(collections).toEqual(['game_sessions', 'tbl_arcade_tables']);
    let nextCalled = false;
    expect(() => handler({ next: () => { nextCalled = true; }, app: { marker: 'tx' } })).not.toThrow();
    expect(nextCalled).toBe(true);
    expect(calls[1]).toEqual(['overdue', { marker: 'tx' }, 'wake_hook', 12]);
  });

  it('links each arcade event to its table before saving and records activity after', () => {
    const order: string[] = [];
    const lib = {
      attachArcadeEventToTable: () => order.push('attach'),
      recordArcadeTableActivity: () => {
        order.push('activity');
        throw new Error('soft failure');
      }
    };
    const { sandbox, registered } = sandboxFor(lib);
    vm.runInNewContext(tablesSource, sandbox);

    const [handler, collection] = registered.create[0];
    expect(collection).toBe('tbl_arcade_events');
    handler({ app: {}, record: {}, next: () => order.push('save') });
    expect(order).toEqual(['attach', 'save', 'activity']);
  });
});
