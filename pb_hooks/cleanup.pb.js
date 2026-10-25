/// <reference path="../pb_data/types.d.ts" />

/**
 * Sanctuary Chess: Daily Stale Game Session Cleanup Cron
 * 
 * Runs every day at 03:00 AM UTC.
 * Automatically queries game_sessions older than 3 days and deletes them.
 * Since cascadeDelete: true is configured on session_participants, game_moves,
 * and session_events, PocketBase automatically cascade-deletes all associated
 * records in SQLite, keeping the database lean, fast, and free of bloat.
 */
cronAdd("cleanup_stale_chess_sessions", "0 3 * * *", () => {
    const threeDaysAgoMs = Date.now() - (3 * 24 * 60 * 60 * 1000);
    const cutoffDate = new Date(threeDaysAgoMs).toISOString().replace("T", " ");

    console.log(`[SanctuaryChess Cron] Executing daily cleanup for game sessions older than: ${cutoffDate}`);

    try {
        // Find sessions created before the 3-day cutoff
        const records = $app.findRecordsByFilter(
            "game_sessions",
            "created < {:cutoff}",
            "-created",
            100, // Process in batches of 100 to avoid transaction locks
            0,
            { cutoff: cutoffDate }
        );

        let count = 0;
        for (const record of records) {
            $app.delete(record); // Triggers cascade deletion of related child records
            count++;
        }

        console.log(`[SanctuaryChess Cron] Cleanup completed. Cascade deleted ${count} stale game sessions.`);
    } catch (err) {
        console.error(`[SanctuaryChess Cron] Cleanup error: ${err}`);
    }
});
