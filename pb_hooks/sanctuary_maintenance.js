/// <reference path="../pb_data/types.d.ts" />

/**
 * Sanctuary Arcade & Basilica Chess: shared PocketHost maintenance library.
 *
 * Loaded with `require(`${__hooks}/sanctuary_maintenance.js`)` from inside each hook handler, because
 * PocketBase runs every handler in its own isolated scope. Every threshold is DB-driven through
 * `tbl_cfg_system_controls`, with the defaults below used only when a control is missing or inactive.
 *
 * Lifecycle of a game record:
 *   live table/session --(idle >= stale days)--> tbl_archived_<game>_snapshots
 *   archive --(older than rotation days, or past the row cap)--> *_history
 *   *_history --(older than retention days, unless bln_do_not_delete)--> purged
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 200;
const ARCADE_CODE_PATTERN = /^[A-Z0-9]{2,10}-[A-Z0-9]{3,16}$/;

const POLICY_DEFAULTS = {
    "system.stale_session_days": 3,
    "system.archive_rotation_days": 30,
    "system.archive_max_rows": 5000,
    "system.history_retention_days": 365
};

/** Session tables swept for stale games, with the archive each one is snapshotted into. */
const SESSION_FAMILIES = [
    { sessions: "game_sessions", archive: "tbl_archived_game_snapshots", kind: "chess" },
    { sessions: "tbl_bjk_sessions", archive: "tbl_archived_bjk_snapshots", kind: "session" },
    { sessions: "tbl_res_sessions", archive: "tbl_archived_res_snapshots", kind: "session" },
    { sessions: "tbl_uno_sessions", archive: "tbl_archived_uno_snapshots", kind: "session" },
    { sessions: "tbl_p10_sessions", archive: "tbl_archived_p10_snapshots", kind: "session" },
    { sessions: "tbl_pok_sessions", archive: "tbl_archived_pok_snapshots", kind: "session" },
    { sessions: "tbl_skp_sessions", archive: "tbl_archived_skp_snapshots", kind: "session" },
    { sessions: "tbl_set_sessions", archive: "tbl_archived_set_snapshots", kind: "session" },
    { sessions: "tbl_sol_sessions", archive: "tbl_archived_sol_snapshots", kind: "session" },
    { sessions: "tbl_arcade_tables", archive: "tbl_archived_arcade_snapshots", kind: "arcade_table" }
];

/** Archive and audit tables that rotate into a matching `*_history` table. */
const ROTATING_TABLES = [
    "tbl_audit_cleanup_logs",
    "tbl_archived_game_snapshots",
    "tbl_archived_bjk_snapshots",
    "tbl_archived_res_snapshots",
    "tbl_archived_uno_snapshots",
    "tbl_archived_p10_snapshots",
    "tbl_archived_pok_snapshots",
    "tbl_archived_skp_snapshots",
    "tbl_archived_set_snapshots",
    "tbl_archived_sol_snapshots",
    "tbl_archived_arcade_snapshots"
];

const SYSTEM_FIELDS = ["id", "created", "updated"];

function toPbDate(epochMs) {
    return new Date(epochMs).toISOString().replace("T", " ");
}

function findCollection(app, name) {
    try {
        return app.findCollectionByNameOrId(name);
    } catch (_err) {
        return null;
    }
}

function hasField(collection, fieldName) {
    return Boolean(collection && collection.fields && collection.fields.getByName(fieldName));
}

/** Reads one numeric control from tbl_cfg_system_controls, falling back to the default. */
function readNumberControl(app, key) {
    try {
        const rec = app.findFirstRecordByFilter(
            "tbl_cfg_system_controls",
            "txt_config_key = {:key} && bln_is_active = true",
            { key: key }
        );
        const value = rec.getFloat("dec_val_number");
        return value > 0 ? value : POLICY_DEFAULTS[key];
    } catch (_err) {
        return POLICY_DEFAULTS[key];
    }
}

function loadPolicy(app) {
    return {
        staleDays: readNumberControl(app, "system.stale_session_days"),
        rotationDays: readNumberControl(app, "system.archive_rotation_days"),
        maxArchiveRows: readNumberControl(app, "system.archive_max_rows"),
        historyRetentionDays: readNumberControl(app, "system.history_retention_days")
    };
}

/** Copies every same-named field from `source` into a new record of `targetName`. */
function copyRecord(app, targetName, source, overrides) {
    const collection = app.findCollectionByNameOrId(targetName);
    const record = new Record(collection);
    collection.fields.fieldNames()
        .filter(name => SYSTEM_FIELDS.indexOf(name) < 0)
        .forEach(name => {
            const value = source.get(name);
            if (value !== undefined && value !== null) {
                record.set(name, value);
            }
        });
    Object.keys(overrides || {}).forEach(key => record.set(key, overrides[key]));
    app.save(record);
    return record;
}

function parseJsonField(record, fieldName) {
    try {
        return JSON.parse(record.getString(fieldName) || "null");
    } catch (_err) {
        return null;
    }
}

/** Builds the archive row for one stale session, shaped for its archive table. */
function snapshotFields(family, rec) {
    const code = rec.getString("session_code");
    const base = {
        txt_session_code: code,
        bln_do_not_delete: rec.getBool("do_not_delete"),
        txt_pruned_reason: "stale_inactivity"
    };
    if (family.kind === "chess") {
        return Object.assign(base, {
            txt_final_fen: rec.getString("fen"),
            txt_white_player: rec.getString("white_player_name"),
            txt_black_player: rec.getString("black_player_name"),
            txt_winner: rec.getString("winner"),
            txt_status: rec.getString("status"),
            int_total_plies: rec.getInt("ply"),
            txt_pgn: rec.getString("last_move_san"),
            json_snapshot_payload: {
                session: {
                    id: rec.id,
                    session_code: code,
                    fen: rec.getString("fen"),
                    mode: rec.getString("mode"),
                    theme: rec.getString("theme"),
                    status: rec.getString("status"),
                    ply: rec.getInt("ply"),
                    winner: rec.getString("winner"),
                    termination_reason: rec.getString("termination_reason")
                }
            }
        });
    }
    if (family.kind === "arcade_table") {
        return Object.assign(base, {
            txt_game_key: rec.getString("game_key"),
            int_event_count: rec.getInt("int_event_count"),
            json_snapshot_payload: {
                sessionCode: code,
                status: rec.getString("status"),
                hostParticipantId: rec.getString("host_participant_id"),
                lastSnapshot: parseJsonField(rec, "json_last_snapshot")
            }
        });
    }
    return Object.assign(base, {
        json_snapshot_payload: { sessionId: rec.id, sessionCode: code, status: rec.getString("status") }
    });
}

/**
 * Archives and deletes stale sessions of one family. Each session is snapshotted and deleted in
 * one transaction, so a failure never loses a game without its archive (child rows cascade).
 */
function sweepStaleSessions(app, family, cutoff, report) {
    if (!findCollection(app, family.sessions)) return;
    const archive = findCollection(app, family.archive);
    const stale = app.findRecordsByFilter(
        family.sessions,
        "updated < {:cutoff} && do_not_delete != true",
        "updated",
        BATCH_SIZE,
        0,
        { cutoff: cutoff }
    );
    stale.forEach(rec => {
        try {
            app.runInTransaction(txApp => {
                if (archive) {
                    const snapshot = new Record(archive);
                    const fields = snapshotFields(family, rec);
                    Object.keys(fields)
                        .filter(key => hasField(archive, key))
                        .forEach(key => snapshot.set(key, fields[key]));
                    txApp.save(snapshot);
                }
                txApp.delete(rec);
            });
            report.prunedCodes.push(rec.getString("session_code"));
        } catch (err) {
            report.errors.push(`${family.sessions}/${rec.id}: ${err}`);
        }
    });
}

/** Deletes legacy arcade events that were never linked to a table and have gone idle. */
function pruneOrphanArcadeEvents(app, cutoff, report) {
    if (!findCollection(app, "tbl_arcade_events")) return;
    const orphans = app.findRecordsByFilter(
        "tbl_arcade_events",
        "table = '' && updated < {:cutoff} && do_not_delete != true",
        "updated",
        BATCH_SIZE * 5,
        0,
        { cutoff: cutoff }
    );
    orphans.forEach(evt => app.delete(evt));
    report.orphanEvents += orphans.length;
}

function moveToHistory(app, source, history, records, report) {
    records.forEach(rec => {
        try {
            app.runInTransaction(txApp => {
                copyRecord(txApp, history, rec, {});
                txApp.delete(rec);
            });
            report.archivedRows += 1;
        } catch (err) {
            report.errors.push(`${source}->${history}/${rec.id}: ${err}`);
        }
    });
}

/**
 * Rotates one archive/audit table into its *_history twin by age and by row cap, then purges
 * *_history rows past retention (rows flagged bln_do_not_delete are always kept).
 */
function rotateTable(app, source, policy, now, report) {
    const history = `${source}_history`;
    const historyCollection = findCollection(app, history);
    if (!findCollection(app, source) || !historyCollection) return;

    const ageCutoff = toPbDate(now - policy.rotationDays * DAY_MS);
    moveToHistory(app, source, history,
        app.findRecordsByFilter(source, "created < {:cutoff}", "created", BATCH_SIZE, 0, { cutoff: ageCutoff }),
        report);

    const total = app.countRecords(source);
    if (total > policy.maxArchiveRows) {
        const overflow = Math.min(total - policy.maxArchiveRows, BATCH_SIZE);
        moveToHistory(app, source, history,
            app.findRecordsByFilter(source, "id != ''", "created", overflow, 0),
            report);
    }

    const purgeCutoff = toPbDate(now - policy.historyRetentionDays * DAY_MS);
    const purgeFilter = hasField(historyCollection, "bln_do_not_delete")
        ? "created < {:cutoff} && bln_do_not_delete != true"
        : "created < {:cutoff}";
    const expired = app.findRecordsByFilter(history, purgeFilter, "created", BATCH_SIZE, 0, { cutoff: purgeCutoff });
    expired.forEach(rec => app.delete(rec));
    report.historyPurged += expired.length;
}

function writeAuditLog(app, report, source, policy, startedAt) {
    const audit = findCollection(app, "tbl_audit_cleanup_logs");
    if (!audit) return;
    const rec = new Record(audit);
    rec.set("txt_trace_id", report.traceId);
    rec.set("txt_trigger_source", source);
    rec.set("int_deleted_sessions", report.prunedCodes.length);
    rec.set("txt_cutoff_timestamp", report.cutoff);
    rec.set("txt_pruned_codes_json", report.prunedCodes);
    rec.set("int_archived_rows", report.archivedRows);
    rec.set("int_history_purged", report.historyPurged);
    rec.set("int_duration_ms", Date.now() - startedAt);
    rec.set("bln_success", report.errors.length === 0);
    rec.set("txt_error_message", report.errors.slice(0, 20).join("\n"));
    app.save(rec);
}

/** Full maintenance pass: stale games -> archives -> *_history -> retention purge, plus an audit row. */
function runMaintenance(app, source) {
    const startedAt = Date.now();
    const policy = loadPolicy(app);
    const cutoff = toPbDate(startedAt - policy.staleDays * DAY_MS);
    const report = {
        traceId: `trc_${source}_${startedAt}_${Math.random().toString(36).substring(2, 8)}`,
        cutoff: cutoff,
        prunedCodes: [],
        archivedRows: 0,
        historyPurged: 0,
        orphanEvents: 0,
        errors: []
    };

    SESSION_FAMILIES.forEach(family => {
        try {
            sweepStaleSessions(app, family, cutoff, report);
        } catch (err) {
            report.errors.push(`${family.sessions}: ${err}`);
        }
    });
    try {
        pruneOrphanArcadeEvents(app, cutoff, report);
    } catch (err) {
        report.errors.push(`tbl_arcade_events: ${err}`);
    }
    ROTATING_TABLES.forEach(table => {
        try {
            rotateTable(app, table, policy, startedAt, report);
        } catch (err) {
            report.errors.push(`${table}: ${err}`);
        }
    });

    try {
        writeAuditLog(app, report, source, policy, startedAt);
    } catch (err) {
        console.warn(`[SanctuaryMaintenance:${report.traceId}] Could not write audit log: ${err}`);
    }
    console.log(
        `[SanctuaryMaintenance:${report.traceId}] archived ${report.prunedCodes.length} stale games, ` +
        `rotated ${report.archivedRows} rows to history, purged ${report.historyPurged} expired history rows, ` +
        `removed ${report.orphanEvents} orphan events, ${report.errors.length} errors`
    );
    return report;
}

/** Runs maintenance only if the last audit row is older than `hours` (PocketHost may hibernate through cron). */
function runIfOverdue(app, source, hours) {
    try {
        const recent = app.findRecordsByFilter(
            "tbl_audit_cleanup_logs",
            "created >= {:since}",
            "-created",
            1,
            0,
            { since: toPbDate(Date.now() - hours * 60 * 60 * 1000) }
        );
        if (recent.length > 0) return null;
    } catch (_err) {
        // No audit table yet: run
    }
    return runMaintenance(app, source);
}

/**
 * Validates an arcade event and links it to its `tbl_arcade_tables` row, creating the table on the
 * first event for a code. Runs before the event is saved, so clients never handle record ids.
 */
function attachArcadeEventToTable(app, event) {
    const code = String(event.getString("session_code") || "").trim().toUpperCase();
    if (!ARCADE_CODE_PATTERN.test(code)) {
        throw new BadRequestError("Invalid arcade table code.");
    }
    event.set("session_code", code);

    let table = null;
    try {
        table = app.findFirstRecordByFilter("tbl_arcade_tables", "session_code = {:code}", { code: code });
    } catch (_notFound) {
        table = new Record(app.findCollectionByNameOrId("tbl_arcade_tables"));
        table.set("session_code", code);
        table.set("game_key", event.getString("game_key"));
        table.set("host_participant_id", event.getString("participant_id"));
        table.set("status", "open");
        table.set("int_event_count", 0);
        app.save(table);
    }
    if (table.getString("status") === "closed") {
        throw new BadRequestError("This arcade table is closed.");
    }
    event.set("table", table.id);
    return table;
}

/**
 * After an event is stored: bumps the table's activity (which keeps it out of stale cleanup) and
 * keeps the latest full table snapshot so late joiners can load the table even if the host is away.
 */
function recordArcadeTableActivity(app, event) {
    const tableId = event.getString("table");
    if (!tableId) return;
    const table = app.findRecordById("tbl_arcade_tables", tableId);
    table.set("int_event_count", table.getInt("int_event_count") + 1);
    table.set("status", "active");
    table.set("dt_last_event_at", toPbDate(Date.now()));
    if (event.getString("event_type") === "action_dispatched") {
        const payload = parseJsonField(event, "payload");
        if (payload && payload.actionType === "state_sync" && payload.payload) {
            table.set("json_last_snapshot", payload.payload);
        }
    }
    app.save(table);
}

module.exports = {
    ARCADE_CODE_PATTERN,
    POLICY_DEFAULTS,
    ROTATING_TABLES,
    SESSION_FAMILIES,
    attachArcadeEventToTable,
    loadPolicy,
    recordArcadeTableActivity,
    rotateTable,
    runIfOverdue,
    runMaintenance,
    sweepStaleSessions,
    toPbDate
};
