/// <reference path="../pb_data/types.d.ts" />

/**
 * Sanctuary Chess: Semi-Daily Stale Game Session Cleanup Cron
 * 
 * Runs twice daily at 03:00 and 15:00 UTC (every 12 hours).
 * Automatically queries game_sessions that have not had a move made in 3 days (updated < 3 days ago).
 * Since cascadeDelete: true is configured on session_participants, game_moves,
 * and session_events, PocketBase automatically cascade-deletes all associated
 * records in SQLite, keeping the database lean, fast, and free of bloat.
 */
cronAdd("cleanup_stale_chess_sessions", "0 3,15 * * *", () => {
    const threeDaysAgoMs = Date.now() - (3 * 24 * 60 * 60 * 1000);
    const cutoffDate = new Date(threeDaysAgoMs).toISOString().replace("T", " ");

    console.log(`[SanctuaryChess Cron] Executing semi-daily cleanup for game sessions without moves since: ${cutoffDate}`);

    try {
        // Find sessions with no moves or updates in the last 3 days
        const records = $app.findRecordsByFilter(
            "game_sessions",
            "updated < {:cutoff}",
            "-updated",
            100, // Process in batches of 100 to avoid transaction locks
            0,
            { cutoff: cutoffDate }
        );

        let count = 0;
        for (const record of records) {
            $app.delete(record); // Triggers cascade deletion of related child records (participants, moves, events)
            count++;
        }

        console.log(`[SanctuaryChess Cron] Cleanup completed. Cascade deleted ${count} stale game sessions.`);
    } catch (err) {
        console.error(`[SanctuaryChess Cron] Cleanup error: ${err}`);
    }
});
