/// <reference path="../pb_data/types.d.ts" />

/**
 * Sanctuary Arcade & Basilica Chess: stale game cleanup, archive rotation and history retention.
 *
 * 1. Runs twice daily at 03:00 and 15:00 UTC via `cronAdd("cleanup_stale_chess_sessions", "0 3,15 * * *")`.
 * 2. Also runs opportunistically whenever the app handles real player activity and the last
 *    `tbl_audit_cleanup_logs` entry is >= 12 hours old, so PocketHost hibernation never skips a
 *    window. A *new* session/table is one such signal, but by itself it is not enough: once nobody
 *    starts a brand-new game for a while, that signal goes quiet even though people are still
 *    actively playing (a chess move is an *update* to the same session row, not a new one). So the
 *    catch-up also fires on every chess move / session update and every arcade event, which covers
 *    ordinary gameplay with no new game involved at all.
 * 3. The work itself lives in `sanctuary_maintenance.js` (see its header for the full lifecycle); all
 *    thresholds come from `tbl_cfg_system_controls`.
 */

cronAdd("cleanup_stale_chess_sessions", "0 3,15 * * *", () => {
    require(`${__hooks}/sanctuary_maintenance.js`).runMaintenance($app, "cron_hook");
});

const wakeCatchUp = (e) => {
    e.next();
    try {
        require(`${__hooks}/sanctuary_maintenance.js`).runIfOverdue(e.app, "wake_hook", 12);
    } catch (err) {
        console.warn(`[SanctuaryMaintenance] Opportunistic cleanup skipped: ${err}`);
    }
};

onRecordAfterCreateSuccess(wakeCatchUp, "game_sessions", "tbl_arcade_tables", "tbl_arcade_events", "tbl_chat_messages");
onRecordAfterUpdateSuccess(wakeCatchUp, "game_sessions", "tbl_arcade_tables");
