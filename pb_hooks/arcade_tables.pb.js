/// <reference path="../pb_data/types.d.ts" />

/**
 * Sanctuary Arcade live tables: server-side integrity for `tbl_arcade_events`.
 *
 * Before an event is stored it is validated and linked to its `tbl_arcade_tables` row (created on
 * the first event for a code), so every event has a real relation that cascades on cleanup. After it
 * is stored, the table's activity and latest state snapshot are updated.
 */

onRecordCreate((e) => {
    require(`${__hooks}/sanctuary_maintenance.js`).attachArcadeEventToTable(e.app, e.record);
    e.next();
    try {
        require(`${__hooks}/sanctuary_maintenance.js`).recordArcadeTableActivity(e.app, e.record);
    } catch (err) {
        console.warn(`[ArcadeTables] Could not record table activity: ${err}`);
    }
}, "tbl_arcade_events");
