/// <reference path="../pb_data/types.d.ts" />

/**
 * Sanctuary Chess: Semi-Daily Stale Game Session Cleanup Cron & Observability Logger
 * 
 * Runs twice daily at 03:00 and 15:00 UTC (every 12 hours).
 * Automatically queries game_sessions that have not had a move made in 3 days (updated < 3 days ago).
 * Since cascadeDelete: true is configured on session_participants, game_moves,
 * and session_events, PocketBase automatically cascade-deletes all associated
 * records in SQLite, keeping the database lean, fast, and free of bloat.
 * 
 * Logs full observability, metrics, and trace IDs to `tbl_audit_cleanup_logs`.
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
        // Find sessions with no moves or updates in the last 3 days (ignoring do_not_delete sessions)
        const records = $app.findRecordsByFilter(
            "game_sessions",
            "updated < {:cutoff} && do_not_delete != true",
            "-updated",
            100, // Process in batches of 100 to avoid transaction locks
            0,
            { cutoff: cutoffDate }
        );

        const snapCol = $app.findCollectionByNameOrId("tbl_archived_game_snapshots");

        for (const record of records) {
            const code = record.getString("session_code");

            // Snapshot compact recovery state before cascade delete
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

            $app.delete(record); // Triggers cascade deletion of related child records (participants, moves, events)
            deletedCodes.push(code);
            count++;
        }

        console.log(`[SanctuaryChess Cron:${traceId}] Cleanup completed. Cascade deleted ${count} stale game sessions.`);
    } catch (err) {
        errorMessage = String(err);
        console.error(`[SanctuaryChess Cron:${traceId}] Cleanup error: ${err}`);
    }

    const durationMs = Date.now() - startTime;

    // Write structured observability record to tbl_audit_cleanup_logs
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

            // Partitioned Archival Maintenance: move audit logs older than 30 days to tbl_audit_cleanup_logs_history
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
            // Partitioned Snapshot Maintenance: move snapshots older than 30 days to tbl_archived_game_snapshots_history
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
