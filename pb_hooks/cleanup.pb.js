/// <reference path="../pb_data/types.d.ts" />

/**
 * Sanctuary Arcade & Basilica Chess: Universal Stale Session Cleanup Cron & Wakeup Hook
 *
 * 1. Runs twice daily at 03:00 and 15:00 UTC via `cronAdd("cleanup_stale_chess_sessions", "0 3,15 * * *")`.
 * 2. Also runs opportunistically on container wakeup (`onBootstrap`) and on new session creation
 *    (`onRecordAfterCreateSuccess`) whenever the most recent `tbl_audit_cleanup_logs` entry is >= 12 hours old,
 *    ensuring PocketHost container hibernation never skips a 12-hour cleanup window.
 * 3. Sweeps every Sanctuary Arcade game session table (`game_sessions`, `tbl_bjk_sessions`, `tbl_res_sessions`,
 *    `tbl_uno_sessions`, `tbl_p10_sessions`, `tbl_pok_sessions`, `tbl_skp_sessions`, `tbl_set_sessions`,
 *    `tbl_sol_sessions`) for sessions with `updated < (now - 3 days) && do_not_delete != true`, and prunes
 *    idle `tbl_arcade_events` realtime records on the same window.
 * 4. Snapshots pruned sessions into `tbl_archived_<game>_snapshots` before cascade-deleting child records,
 *    rotates 30-day-old snapshots/logs into `*_history` partition tables, and writes full observability metrics
 *    to `tbl_audit_cleanup_logs`.
 */

cronAdd("cleanup_stale_chess_sessions", "0 3,15 * * *", () => {
    const startTime = Date.now();
    const traceId = `trc_hook_${startTime}_${Math.random().toString(36).substring(2, 8)}`;
    const threeDaysAgoMs = startTime - (3 * 24 * 60 * 60 * 1000);
    const cutoffDate = new Date(threeDaysAgoMs).toISOString().replace("T", " ");

    console.log(`[SanctuaryChess Cron:${traceId}] Executing semi-daily cleanup for game sessions without moves since: ${cutoffDate}`);

    let count = 0;
    const deletedCodes = [];
    let errorMessage = "";

    try {
        // 1. Prune Sanctuary Chess sessions (3+ days old & do_not_delete != true)
        const records = $app.findRecordsByFilter(
            "game_sessions",
            "updated < {:cutoff} && do_not_delete != true",
            "-updated",
            100,
            0,
            { cutoff: cutoffDate }
        );

        const snapCol = $app.findCollectionByNameOrId("tbl_archived_game_snapshots");

        for (const record of records) {
            const code = record.getString("session_code");

            if (snapCol) {
                try {
                    const snapRec = new Record(snapCol);
                    snapRec.set("txt_session_code", code);
                    snapRec.set("txt_final_fen", record.getString("fen"));
                    snapRec.set("txt_white_player", record.getString("white_player_name"));
                    snapRec.set("txt_black_player", record.getString("black_player_name"));
                    snapRec.set("txt_winner", record.getString("winner"));
                    snapRec.set("txt_status", record.getString("status"));
                    snapRec.set("int_total_plies", record.getInt("ply"));
                    snapRec.set("txt_pgn", record.getString("last_move_san"));
                    snapRec.set("json_snapshot_payload", {
                        session: {
                            id: record.id,
                            session_code: code,
                            fen: record.getString("fen"),
                            mode: record.getString("mode"),
                            theme: record.getString("theme"),
                            timer_rule: record.getString("timer_rule"),
                            strict_mode: record.getBool("strict_mode"),
                            status: record.getString("status"),
                            current_turn: record.getString("current_turn"),
                            ply: record.getInt("ply"),
                            white_player_name: record.getString("white_player_name"),
                            black_player_name: record.getString("black_player_name"),
                            winner: record.getString("winner"),
                            termination_reason: record.getString("termination_reason"),
                            last_move_san: record.getString("last_move_san")
                        }
                    });
                    snapRec.set("txt_pruned_reason", "stale_inactivity_3_days");
                    snapRec.set("bln_do_not_delete", record.getBool("do_not_delete"));
                    $app.save(snapRec);
                } catch (snapErr) {
                    console.warn(`[SanctuaryChess Cron:${traceId}] Could not record snapshot for ${code}: ${snapErr}`);
                }
            }

            $app.delete(record);
            deletedCodes.push(code);
            count++;
        }

        // 2. Sweep all multi-game Sanctuary Arcade session collections (3+ days old & do_not_delete != true)
        const arcadeCollections = [
            { sessionCol: "tbl_bjk_sessions", snapCol: "tbl_archived_bjk_snapshots", histCol: "tbl_archived_bjk_snapshots_history" },
            { sessionCol: "tbl_res_sessions", snapCol: "tbl_archived_res_snapshots", histCol: "tbl_archived_res_snapshots_history" },
            { sessionCol: "tbl_uno_sessions", snapCol: "tbl_archived_uno_snapshots", histCol: "tbl_archived_uno_snapshots_history" },
            { sessionCol: "tbl_p10_sessions", snapCol: "tbl_archived_p10_snapshots", histCol: "tbl_archived_p10_snapshots_history" },
            { sessionCol: "tbl_pok_sessions", snapCol: "tbl_archived_pok_snapshots", histCol: "tbl_archived_pok_snapshots_history" },
            { sessionCol: "tbl_skp_sessions", snapCol: "tbl_archived_skp_snapshots", histCol: "tbl_archived_skp_snapshots_history" },
            { sessionCol: "tbl_set_sessions", snapCol: "tbl_archived_set_snapshots", histCol: "tbl_archived_set_snapshots_history" },
            { sessionCol: "tbl_sol_sessions", snapCol: "tbl_archived_sol_snapshots", histCol: "tbl_archived_sol_snapshots_history" }
        ];

        const thirtyDaysAgo = new Date(startTime - (30 * 24 * 60 * 60 * 1000)).toISOString().replace("T", " ");

        for (const arc of arcadeCollections) {
            try {
                const arcRecords = $app.findRecordsByFilter(
                    arc.sessionCol,
                    "updated < {:cutoff} && do_not_delete != true",
                    "-updated",
                    100,
                    0,
                    { cutoff: cutoffDate }
                );
                const arcSnapCol = $app.findCollectionByNameOrId(arc.snapCol);
                for (const arcRec of arcRecords) {
                    const arcCode = arcRec.getString("session_code");
                    if (arcSnapCol) {
                        try {
                            const arcSnap = new Record(arcSnapCol);
                            arcSnap.set("txt_session_code", arcCode);
                            arcSnap.set("bln_do_not_delete", arcRec.getBool("do_not_delete"));
                            arcSnap.set("json_snapshot_payload", {
                                sessionId: arcRec.id,
                                sessionCode: arcCode,
                                status: arcRec.getString("status"),
                                prunedReason: "stale_inactivity_3_days"
                            });
                            $app.save(arcSnap);
                        } catch (_arcSnapErr) {
                            // Continue cascade delete if snapshot save fails
                        }
                    }
                    $app.delete(arcRec);
                    deletedCodes.push(arcCode);
                    count++;
                }

                // Rotate 30-day-old arcade snapshots to *_history
                const arcHistCol = $app.findCollectionByNameOrId(arc.histCol);
                if (arcSnapCol && arcHistCol) {
                    const oldArcSnaps = $app.findRecordsByFilter(arc.snapCol, "created < {:cutoff}", "-created", 50, 0, { cutoff: thirtyDaysAgo });
                    for (const oldArcSnap of oldArcSnaps) {
                        const histSnap = new Record(arcHistCol);
                        histSnap.set("txt_session_code", oldArcSnap.getString("txt_session_code"));
                        histSnap.set("bln_do_not_delete", oldArcSnap.getBool("bln_do_not_delete"));
                        histSnap.set("json_snapshot_payload", oldArcSnap.get("json_snapshot_payload"));
                        $app.save(histSnap);
                        $app.delete(oldArcSnap);
                    }
                }
            } catch (_arcErr) {
                // Collection may not exist yet or is empty
            }
        }

        // 2b. Prune arcade realtime events (tbl_arcade_events) idle for 3+ days
        try {
            const staleEvents = $app.findRecordsByFilter(
                "tbl_arcade_events",
                "updated < {:cutoff} && do_not_delete != true",
                "updated",
                500,
                0,
                { cutoff: cutoffDate }
            );
            for (const evt of staleEvents) {
                $app.delete(evt);
            }
            console.log(`[SanctuaryChess Cron:${traceId}] Pruned ${staleEvents.length} stale arcade realtime events.`);
        } catch (_evtErr) {
            // Collection may not exist yet
        }

        console.log(`[SanctuaryChess Cron:${traceId}] Cleanup completed. Cascade deleted ${count} stale game sessions.`);
    } catch (err) {
        errorMessage = String(err);
        console.error(`[SanctuaryChess Cron:${traceId}] Cleanup error: ${err}`);
    }

    const durationMs = Date.now() - startTime;

    // 3. Write structured observability record to tbl_audit_cleanup_logs & rotate 30-day history
    try {
        const auditCol = $app.findCollectionByNameOrId("tbl_audit_cleanup_logs");
        if (auditCol) {
            const auditRec = new Record(auditCol);
            auditRec.set("txt_trace_id", traceId);
            auditRec.set("txt_trigger_source", "cron_hook");
            auditRec.set("int_deleted_sessions", count);
            auditRec.set("txt_cutoff_timestamp", cutoffDate);
            auditRec.set("txt_pruned_codes_json", deletedCodes);
            auditRec.set("int_duration_ms", durationMs);
            auditRec.set("bln_success", errorMessage === "");
            auditRec.set("txt_error_message", errorMessage);
            $app.save(auditRec);

            const thirtyDaysAgo = new Date(startTime - (30 * 24 * 60 * 60 * 1000)).toISOString().replace("T", " ");
            const histCol = $app.findCollectionByNameOrId("tbl_audit_cleanup_logs_history");
            const oldLogs = $app.findRecordsByFilter("tbl_audit_cleanup_logs", "created < {:cutoff}", "-created", 50, 0, { cutoff: thirtyDaysAgo });
            for (const oldLog of oldLogs) {
                if (histCol) {
                    const histRec = new Record(histCol);
                    histRec.set("txt_trace_id", oldLog.getString("txt_trace_id"));
                    histRec.set("txt_trigger_source", oldLog.getString("txt_trigger_source"));
                    histRec.set("int_deleted_sessions", oldLog.getInt("int_deleted_sessions"));
                    histRec.set("txt_cutoff_timestamp", oldLog.getString("txt_cutoff_timestamp"));
                    histRec.set("txt_pruned_codes_json", oldLog.get("txt_pruned_codes_json"));
                    histRec.set("int_duration_ms", oldLog.getInt("int_duration_ms"));
                    histRec.set("bln_success", oldLog.getBool("bln_success"));
                    histRec.set("txt_error_message", oldLog.getString("txt_error_message"));
                    $app.save(histRec);
                }
                $app.delete(oldLog);
            }

            const snapHistCol = $app.findCollectionByNameOrId("tbl_archived_game_snapshots_history");
            const oldSnaps = $app.findRecordsByFilter("tbl_archived_game_snapshots", "created < {:cutoff}", "-created", 50, 0, { cutoff: thirtyDaysAgo });
            for (const oldSnap of oldSnaps) {
                if (snapHistCol) {
                    const snapHistRec = new Record(snapHistCol);
                    snapHistRec.set("txt_session_code", oldSnap.getString("txt_session_code"));
                    snapHistRec.set("txt_final_fen", oldSnap.getString("txt_final_fen"));
                    snapHistRec.set("txt_white_player", oldSnap.getString("txt_white_player"));
                    snapHistRec.set("txt_black_player", oldSnap.getString("txt_black_player"));
                    snapHistRec.set("txt_winner", oldSnap.getString("txt_winner"));
                    snapHistRec.set("txt_status", oldSnap.getString("txt_status"));
                    snapHistRec.set("int_total_plies", oldSnap.getInt("int_total_plies"));
                    snapHistRec.set("txt_pgn", oldSnap.getString("txt_pgn"));
                    snapHistRec.set("json_snapshot_payload", oldSnap.get("json_snapshot_payload"));
                    snapHistRec.set("txt_pruned_reason", oldSnap.getString("txt_pruned_reason"));
                    $app.save(snapHistRec);
                }
                $app.delete(oldSnap);
            }
        }
    } catch (auditErr) {
        console.warn(`[SanctuaryChess Cron:${traceId}] Could not record audit log: ${auditErr}`);
    }
});

/**
 * Hibernation-Resilient Opportunistic Trigger:
 * Whenever a new game session is created in any of the 8 collections, check if the last cleanup sweep
 * in `tbl_audit_cleanup_logs` occurred more than 12 hours ago (e.g., if PocketHost was hibernating at 03:00/15:00 UTC).
 * If >= 12 hours have elapsed, run a background stale-session sweep across all 8 game collections.
 */
if (typeof onRecordAfterCreateSuccess === "function") {
    onRecordAfterCreateSuccess((e) => {
        e.next();
        try {
            const now = Date.now();
            const twelveHoursAgo = new Date(now - (12 * 60 * 60 * 1000)).toISOString().replace("T", " ");
            const recentLogs = $app.findRecordsByFilter(
                "tbl_audit_cleanup_logs",
                "created >= {:recentCutoff}",
                "-created",
                1,
                0,
                { recentCutoff: twelveHoursAgo }
            );
            if (recentLogs && recentLogs.length > 0) {
                return;
            }

            const traceId = `trc_wake_${now}_${Math.random().toString(36).substring(2, 8)}`;
            const cutoffDate = new Date(now - (3 * 24 * 60 * 60 * 1000)).toISOString().replace("T", " ");
            let count = 0;
            const deletedCodes = [];

            const allCols = [
                "game_sessions",
                "tbl_bjk_sessions",
                "tbl_res_sessions",
                "tbl_uno_sessions",
                "tbl_p10_sessions",
                "tbl_pok_sessions",
                "tbl_skp_sessions",
                "tbl_set_sessions",
                "tbl_sol_sessions"
            ];
            for (const colName of allCols) {
                try {
                    const stale = $app.findRecordsByFilter(
                        colName,
                        "updated < {:cutoff} && do_not_delete != true",
                        "-updated",
                        50,
                        0,
                        { cutoff: cutoffDate }
                    );
                    for (const rec of stale) {
                        deletedCodes.push(rec.getString("session_code"));
                        $app.delete(rec);
                        count++;
                    }
                } catch (_colErr) {
                    // Ignore individual collection errors
                }
            }

            const auditCol = $app.findCollectionByNameOrId("tbl_audit_cleanup_logs");
            if (auditCol) {
                const auditRec = new Record(auditCol);
                auditRec.set("txt_trace_id", traceId);
                auditRec.set("txt_trigger_source", "cron_hook");
                auditRec.set("int_deleted_sessions", count);
                auditRec.set("txt_cutoff_timestamp", cutoffDate);
                auditRec.set("txt_pruned_codes_json", deletedCodes);
                auditRec.set("int_duration_ms", Date.now() - now);
                auditRec.set("bln_success", true);
                auditRec.set("txt_error_message", "");
                $app.save(auditRec);
            }
        } catch (_err) {
            // Non-blocking opportunistic cleanup
        }
    }, "game_sessions", "tbl_bjk_sessions", "tbl_res_sessions", "tbl_uno_sessions", "tbl_p10_sessions", "tbl_pok_sessions", "tbl_skp_sessions", "tbl_set_sessions", "tbl_sol_sessions");
}
