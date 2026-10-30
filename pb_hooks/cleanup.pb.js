/// <reference path="../pb_data/types.d.ts" />

/**
 * Sanctuary Arcade & Basilica Chess: stale game cleanup, archive rotation and history retention.
 *
 * 1. Runs twice daily at 03:00 and 15:00 UTC via `cronAdd("cleanup_stale_chess_sessions", "0 3,15 * * *")`.
 * 2. Also runs opportunistically when a new chess session or arcade table is created and the last
 *    `tbl_audit_cleanup_logs` entry is >= 12 hours old, so PocketHost hibernation never skips a window.
 * 3. The work itself lives in `sanctuary_maintenance.js` (see its header for the full lifecycle); all
 *    thresholds come from `tbl_cfg_system_controls`.
 */

cronAdd("cleanup_stale_chess_sessions", "0 3,15 * * *", () => {
    require(`${__hooks}/sanctuary_maintenance.js`).runMaintenance($app, "cron_hook");
});

onRecordAfterCreateSuccess((e) => {
    e.next();
    try {
        require(`${__hooks}/sanctuary_maintenance.js`).runIfOverdue(e.app, "wake_hook", 12);
    } catch (err) {
        console.warn(`[SanctuaryMaintenance] Opportunistic cleanup skipped: ${err}`);
    }
}, "game_sessions", "tbl_arcade_tables");
