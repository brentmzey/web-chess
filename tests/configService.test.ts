import { describe, expect, it, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigService } from '../src/server/services/configService';
import { DEFAULT_ARCADE_GAME_CONFIGS } from '../src/constants/defaultConfigs';

describe('ConfigService & Hungarian Master Configuration Tables', () => {
  let db: Database;
  let service: ConfigService;

  beforeEach(() => {
    db = new Database(':memory:');
    const schemaSql = readFileSync(resolve(__dirname, '../src/server/db/schema.sql'), 'utf8');
    db.exec(schemaSql);
    service = new ConfigService(db);
  });

  it('seeds default canonical configurations for all 8 arcade games and system controls', () => {
    const seedResult = service.seedDefaultConfigurations();
    expect(seedResult.isSuccess()).toBe(true);
    const { gamesSeeded, controlsSeeded } = seedResult.getOrThrow();

    expect(gamesSeeded).toBe(8);
    expect(controlsSeeded).toBeGreaterThanOrEqual(10);

    // Re-seeding without force should not re-insert
    const reseed = service.seedDefaultConfigurations(false);
    expect(reseed.getOrThrow()).toEqual({ gamesSeeded: 0, controlsSeeded: 0 });

    // Re-seeding with force should re-insert
    const forceSeed = service.seedDefaultConfigurations(true);
    expect(forceSeed.getOrThrow().gamesSeeded).toBe(8);
  });

  it('retrieves and queries arcade games by key and active status', () => {
    service.seedDefaultConfigurations();

    const chessOpt = service.getArcadeGame('chess');
    expect(chessOpt.isSome()).toBe(true);
    const chess = chessOpt.getOrThrow();
    expect(chess.txt_title).toContain("Wizard's Chess 3D");
    expect(chess.txt_real_life_name).toBe('Classical Chess (FIDE)');
    expect(chess.txt_prefix).toBe('SANCT-');
    expect(chess.bln_is_active).toBe(true);
    expect(chess.int_version).toBe(1);

    const nonExistent = service.getArcadeGame('unreal_game');
    expect(nonExistent.isNone()).toBe(true);

    const allGames = service.getAllArcadeGames(false);
    expect(allGames.length).toBe(8);

    const activeGames = service.getAllArcadeGames(true);
    expect(activeGames.length).toBe(8);
  });

  it('upserts arcade game configuration, increments version, and logs audit trail', () => {
    service.seedDefaultConfigurations();

    const updatedResult = service.upsertArcadeGame(
      {
        ...DEFAULT_ARCADE_GAME_CONFIGS[1], // blackjack
        txt_title: 'Gothic High Roller Blackjack 21',
        int_max_players: 7,
        bln_is_active: true
      },
      'admin_tester',
      'VIP table upgrade'
    );

    expect(updatedResult.isSuccess()).toBe(true);
    const updated = updatedResult.getOrThrow();
    expect(updated.txt_title).toBe('Gothic High Roller Blackjack 21');
    expect(updated.int_version).toBe(2);
    expect(updated.txt_updated_by).toBe('admin_tester');

    // Verify audit record was created
    const audits = service.getConfigAuditHistory('tbl_cfg_arcade_games', 'blackjack');
    expect(audits.length).toBeGreaterThanOrEqual(1);
    const latestAudit = audits[0];
    expect(latestAudit.txt_action).toBe('UPDATE');
    expect(latestAudit.txt_performed_by).toBe('admin_tester');
    expect(latestAudit.txt_change_reason).toBe('VIP table upgrade');
    expect(latestAudit.json_previous_state).toBeDefined();
    expect(latestAudit.json_new_state).toContain('Gothic High Roller Blackjack 21');
  });

  it('manages system controls across multiple value types and retrieves typed values', () => {
    service.seedDefaultConfigurations();

    // String control
    expect(service.getSystemControlValue('ui.app_title', 'fallback')).toContain("Wizard's Chess 3D");

    // Boolean control
    expect(service.getSystemControlValue('ui.rules_modal_enabled', false)).toBe(true);

    // Number control
    expect(service.getSystemControlValue('system.stale_session_days', 0)).toBe(3);

    // Inactive control should return fallback
    service.upsertSystemControl({
      txt_config_key: 'test.inactive_key',
      txt_category: 'test',
      txt_label: 'Inactive Test',
      txt_val_type: 'string',
      txt_val_string: 'active_val',
      bln_is_active: false
    });
    expect(service.getSystemControlValue('test.inactive_key', 'default_fallback')).toBe('default_fallback');

    // JSON control
    service.upsertSystemControl({
      txt_config_key: 'test.json_key',
      txt_category: 'test',
      txt_label: 'JSON Test',
      txt_val_type: 'json',
      json_val_payload: { foo: 'bar', num: 42 },
      bln_is_active: true
    });
    const jsonVal = service.getSystemControlValue<any>('test.json_key', null);
    expect(jsonVal).toEqual({ foo: 'bar', num: 42 });

    // Category filter query
    const uiControls = service.getAllSystemControls('ui');
    expect(uiControls.length).toBeGreaterThanOrEqual(3);
    for (const ctrl of uiControls) {
      expect(ctrl.txt_category).toBe('ui');
    }
  });

  it('creates configuration snapshots and records audit trail', () => {
    service.seedDefaultConfigurations();

    const snapshotRes = service.createConfigSnapshot('v1.2.0-rc.31-golden-master', true);
    expect(snapshotRes.isSuccess()).toBe(true);
    const snap = snapshotRes.getOrThrow();

    expect(snap.txt_snapshot_label).toBe('v1.2.0-rc.31-golden-master');
    expect(snap.int_total_configs).toBeGreaterThanOrEqual(18);
    expect(snap.bln_do_not_delete).toBe(true);
    expect(snap.json_games_payload).toContain('chess');
    expect(snap.json_controls_payload).toContain('ui.app_title');

    // Snapshot audit log recorded
    const snapAudits = service.getConfigAuditHistory('tbl_archived_cfg_snapshots', 'v1.2.0-rc.31-golden-master');
    expect(snapAudits.length).toBe(1);
    expect(snapAudits[0].txt_action).toBe('MIGRATE');
  });

  it('prunes stale audit history while respecting bln_do_not_delete', () => {
    service.seedDefaultConfigurations();

    // Insert old deletable audit record (timestamp 10 days ago)
    const tenDaysAgo = Date.now() - 10 * 86400 * 1000;
    db.prepare(
      `INSERT INTO tbl_audit_config_history (
        id, txt_audit_id, txt_target_table, txt_record_key, txt_action,
        txt_performed_by, bln_do_not_delete, created_at, updated_at
      ) VALUES ('old_1', 'aud_old_1', 'tbl_cfg_arcade_games', 'chess', 'UPDATE', 'tester', 0, ?, ?)`
    ).run(tenDaysAgo, tenDaysAgo);

    // Insert old protected audit record (bln_do_not_delete = 1)
    db.prepare(
      `INSERT INTO tbl_audit_config_history (
        id, txt_audit_id, txt_target_table, txt_record_key, txt_action,
        txt_performed_by, bln_do_not_delete, created_at, updated_at
      ) VALUES ('old_protected', 'aud_old_prot', 'tbl_cfg_arcade_games', 'chess', 'UPDATE', 'tester', 1, ?, ?)`
    ).run(tenDaysAgo, tenDaysAgo);

    const pruneRes = service.pruneConfigAuditHistory(3);
    expect(pruneRes.isSuccess()).toBe(true);
    const report = pruneRes.getOrThrow();
    expect(report.totalPruned).toBeGreaterThanOrEqual(1);

    // Protected record must still exist
    const protectedRow = db.prepare('SELECT * FROM tbl_audit_config_history WHERE id = ?').get('old_protected');
    expect(protectedRow).toBeDefined();

    // Unprotected old record must be purged
    const deletedRow = db.prepare('SELECT * FROM tbl_audit_config_history WHERE id = ?').get('old_1');
    expect(deletedRow).toBeNull();
  });
});
