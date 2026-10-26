import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

describe('PocketBase Goja JavaScript Cron Hook (pb_hooks/cleanup.pb.js)', () => {
  const hookSource = fs.readFileSync(path.resolve(__dirname, '../pb_hooks/cleanup.pb.js'), 'utf8');

  class MockRecord {
    public data: Record<string, any> = {};
    constructor(public collection: any) {}
    set(key: string, value: any) {
      this.data[key] = value;
    }
    get(key: string) {
      return this.data[key];
    }
    getString(key: string): string {
      return String(this.data[key] ?? '');
    }
    getInt(key: string): number {
      return Number(this.data[key] ?? 0);
    }
    getBool(key: string): boolean {
      return Boolean(this.data[key]);
    }
  }

  it('registers the cron job with correct schedule (0 3,15 * * *) and identifier', () => {
    let registeredName = '';
    let registeredCron = '';
    let registeredCallback: Function | null = null;

    const sandbox = {
      cronAdd: (name: string, cron: string, cb: Function) => {
        registeredName = name;
        registeredCron = cron;
        registeredCallback = cb;
      },
      console,
      Date,
      Math
    };

    vm.runInNewContext(hookSource, sandbox);

    expect(registeredName).toBe('cleanup_stale_chess_sessions');
    expect(registeredCron).toBe('0 3,15 * * *');
    expect(typeof registeredCallback).toBe('function');
  });

  it('successfully purges stale game sessions and records audit log in Goja environment', () => {
    let registeredCallback: Function | null = null;

    const deletedRecords: any[] = [];
    const savedRecords: any[] = [];

    const mockStaleSession = new MockRecord({ id: 'col_sessions', name: 'game_sessions' });
    mockStaleSession.set('session_code', 'SANCT-STALE1');
    mockStaleSession.set('fen', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    mockStaleSession.set('white_player_name', 'HostGrandmaster');
    mockStaleSession.set('black_player_name', 'GuestChallenger');
    mockStaleSession.set('status', 'in_progress');
    mockStaleSession.set('ply', 12);
    mockStaleSession.set('last_move_san', 'Nf3');

    const mockOldAuditLog = new MockRecord({ id: 'col_audit', name: 'tbl_audit_cleanup_logs' });
    mockOldOldAuditLog(mockOldAuditLog);

    const mockOldSnapshot = new MockRecord({ id: 'col_old_snap', name: 'tbl_archived_game_snapshots' });
    mockOldSnapshot.set('txt_session_code', 'SANCT-OLD-SNAP');
    mockOldSnapshot.set('txt_final_fen', 'start');
    mockOldSnapshot.set('txt_status', 'in_progress');
    mockOldSnapshot.set('int_total_plies', 4);

    function mockOldOldAuditLog(rec: MockRecord) {
      rec.set('txt_trace_id', 'trc_old_123');
      rec.set('txt_trigger_source', 'cron_hook');
      rec.set('int_deleted_sessions', 1);
      rec.set('txt_cutoff_timestamp', '2026-09-01 00:00:00');
      rec.set('txt_pruned_codes_json', ['SANCT-OLD']);
      rec.set('int_duration_ms', 50);
      rec.set('bln_success', true);
      rec.set('txt_error_message', '');
    }

    const mockApp = {
      findRecordsByFilter: (colName: string, filter: string, _sort: string, _limit: number, _offset: number, params: any) => {
        if (colName === 'game_sessions') {
          expect(filter).toBe('updated < {:cutoff} && do_not_delete != true');
          expect(params.cutoff).toBeDefined();
          return [mockStaleSession];
        }
        if (colName === 'tbl_audit_cleanup_logs') {
          expect(filter).toBe('created < {:cutoff}');
          return [mockOldAuditLog];
        }
        if (colName === 'tbl_archived_game_snapshots') {
          expect(filter).toBe('created < {:cutoff}');
          return [mockOldSnapshot];
        }
        return [];
      },
      delete: (record: any) => {
        deletedRecords.push(record);
      },
      findCollectionByNameOrId: (name: string) => {
        return { id: `id_${name}`, name };
      },
      save: (record: any) => {
        savedRecords.push(record);
      }
    };

    const sandbox = {
      cronAdd: (_name: string, _cron: string, cb: Function) => {
        registeredCallback = cb;
      },
      $app: mockApp,
      Record: MockRecord,
      console: {
        log: () => {},
        error: () => {},
        warn: () => {}
      },
      Date,
      Math
    };

    vm.runInNewContext(hookSource, sandbox);
    expect(registeredCallback).not.toBeNull();

    // Execute the hook callback
    registeredCallback!();

    // Verify snapshot was created before deleting session
    const snapshotRecord = savedRecords.find(r => r.collection.name === 'tbl_archived_game_snapshots');
    expect(snapshotRecord).toBeDefined();
    expect(snapshotRecord.getString('txt_session_code')).toBe('SANCT-STALE1');
    expect(snapshotRecord.getString('txt_white_player')).toBe('HostGrandmaster');
    expect(snapshotRecord.getString('txt_black_player')).toBe('GuestChallenger');
    expect(snapshotRecord.getInt('int_total_plies')).toBe(12);

    // Verify game_sessions record was cascade deleted
    expect(deletedRecords).toContain(mockStaleSession);

    // Verify audit log record was saved to tbl_audit_cleanup_logs
    const auditRecord = savedRecords.find(r => r.collection.name === 'tbl_audit_cleanup_logs');
    expect(auditRecord).toBeDefined();
    expect(auditRecord.getString('txt_trigger_source')).toBe('cron_hook');
    expect(auditRecord.getString('txt_trace_id')).toContain('trc_hook_');
    expect(auditRecord.getInt('int_deleted_sessions')).toBe(1);
    expect(auditRecord.getBool('bln_success')).toBe(true);

    // Verify partition rollover: historical audit record saved to tbl_audit_cleanup_logs_history
    const historyRecord = savedRecords.find(r => r.collection.name === 'tbl_audit_cleanup_logs_history');
    expect(historyRecord).toBeDefined();
    expect(historyRecord.getString('txt_trace_id')).toBe('trc_old_123');

    // Verify snapshot partition rollover: historical snapshot saved to tbl_archived_game_snapshots_history
    const snapshotHistory = savedRecords.find(r => r.collection.name === 'tbl_archived_game_snapshots_history');
    expect(snapshotHistory).toBeDefined();
    expect(snapshotHistory.getString('txt_session_code')).toBe('SANCT-OLD-SNAP');

    // Verify old logs and snapshots were deleted from active tables
    expect(deletedRecords).toContain(mockOldAuditLog);
    expect(deletedRecords).toContain(mockOldSnapshot);
  });

  it('handles errors gracefully in Goja environment without throwing', () => {
    let registeredCallback: Function | null = null;
    let loggedError = '';

    const mockApp = {
      findRecordsByFilter: () => {
        throw new Error('Database locked by concurrent transaction');
      },
      findCollectionByNameOrId: (name: string) => {
        return { id: `id_${name}`, name };
      },
      save: (record: any) => {
        expect(record.getString('txt_error_message')).toContain('Database locked');
        expect(record.getBool('bln_success')).toBe(false);
      },
      delete: () => {}
    };

    const sandbox = {
      cronAdd: (_name: string, _cron: string, cb: Function) => {
        registeredCallback = cb;
      },
      $app: mockApp,
      Record: MockRecord,
      console: {
        log: () => {},
        error: (msg: string) => { loggedError = msg; },
        warn: () => {}
      },
      Date,
      Math
    };

    vm.runInNewContext(hookSource, sandbox);
    expect(() => registeredCallback!()).not.toThrow();
    expect(loggedError).toContain('Database locked');
  });

  it('handles audit log write failure gracefully without failing the cron execution', () => {
    let registeredCallback: Function | null = null;
    let loggedWarn = '';

    const mockApp = {
      findRecordsByFilter: () => [],
      findCollectionByNameOrId: () => {
        throw new Error('Disk full');
      },
      save: () => {},
      delete: () => {}
    };

    const sandbox = {
      cronAdd: (_name: string, _cron: string, cb: Function) => {
        registeredCallback = cb;
      },
      $app: mockApp,
      Record: MockRecord,
      console: {
        log: () => {},
        error: () => {},
        warn: (msg: string) => { loggedWarn = msg; }
      },
      Date,
      Math
    };

    vm.runInNewContext(hookSource, sandbox);
    expect(() => registeredCallback!()).not.toThrow();
    expect(loggedWarn).toContain('Disk full');
  });

  it('strictly excludes games with do_not_delete = true from being queried or pruned', () => {
    let registeredCallback: Function | null = null;
    let queryFilterExecuted = '';
    const deletedRecords: any[] = [];

    const mockApp = {
      findRecordsByFilter: (colName: string, filter: string) => {
        if (colName === 'game_sessions') {
          queryFilterExecuted = filter;
        }
        return []; // Filter excluded do_not_delete records, so 0 records returned
      },
      findCollectionByNameOrId: (name: string) => ({ id: name, name }),
      save: () => {},
      delete: (rec: any) => { deletedRecords.push(rec); }
    };

    const sandbox = {
      cronAdd: (_name: string, _cron: string, cb: Function) => {
        registeredCallback = cb;
      },
      $app: mockApp,
      Record: MockRecord,
      console: { log: () => {}, error: () => {}, warn: () => {} },
      Date,
      Math
    };

    vm.runInNewContext(hookSource, sandbox);
    registeredCallback!();

    expect(queryFilterExecuted).toBe('updated < {:cutoff} && do_not_delete != true');
    expect(deletedRecords.length).toBe(0);
  });
});
