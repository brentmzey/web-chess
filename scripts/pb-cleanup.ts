import {
  prunePocketBaseSessions,
  triggerPocketBaseServerCron
} from '../src/server/pocketbase/pruner';

/**
 * Runs PocketHost maintenance. By default it triggers the server-side hook (`pb_hooks/sanctuary_maintenance.js`),
 * which archives stale games, rotates archives into *_history and purges expired history using the
 * DB-driven policy in tbl_cfg_system_controls, then prints that run's audit row.
 * `--client-side` instead runs the legacy REST pruner from this machine.
 */

const rawUrl = process.env.POCKETBASE_URL;
const url = rawUrl && !rawUrl.startsWith('${') ? rawUrl : 'https://web-chess.pockethost.io';

const rawEmail = process.env.PB_ADMIN_EMAIL || process.env.POCKETBASE_SUPERUSER_EMAIL;
const email = rawEmail && !rawEmail.startsWith('${') ? rawEmail : process.env.PB_ADMIN_EMAIL;

const rawPassword = process.env.PB_ADMIN_PASSWORD || process.env.POCKETBASE_SUPERUSER_PASSWORD;
const password = rawPassword && !rawPassword.startsWith('${') ? rawPassword : process.env.PB_ADMIN_PASSWORD;

const daysArg = process.argv.find(arg => arg.startsWith('--days='));
const days = daysArg ? parseInt(daysArg.split('=')[1]!, 10) : 3;
const clientSide = process.argv.includes('--client-side');

if (!email || !password) {
  console.error(
    'Error: PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD (or POCKETBASE_SUPERUSER_EMAIL/PASSWORD) environment variables are required.'
  );
  console.error('Usage: Ensure PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD exist in ~/.zshrc or .env, then run: bun run pb:cleanup');
  process.exit(1);
}

interface AuditRow {
  readonly txt_trace_id: string;
  readonly bln_success: boolean;
  readonly int_deleted_sessions: number;
  readonly int_archived_rows?: number;
  readonly int_history_purged?: number;
  readonly int_duration_ms: number;
  readonly txt_cutoff_timestamp: string;
  readonly txt_error_message: string;
}

async function printLatestServerAudit(): Promise<void> {
  const auth = await fetch(`${url}/api/collections/_superusers/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: email, password })
  });
  const { token } = (await auth.json()) as { token: string };
  const res = await fetch(`${url}/api/collections/tbl_audit_cleanup_logs/records?perPage=1&sort=-created`, {
    headers: { Authorization: token }
  });
  const row = ((await res.json()) as { items: AuditRow[] }).items[0];
  if (!row) {
    console.warn('No audit row found yet.');
    return;
  }
  console.log('--- PocketHost Maintenance Report (server hook) ---');
  console.log(`Trace:                 ${row.txt_trace_id}`);
  console.log(`Stale Cutoff:          ${row.txt_cutoff_timestamp}`);
  console.log(`Archived Stale Games:  ${row.int_deleted_sessions}`);
  console.log(`Rotated to *_history:  ${row.int_archived_rows ?? 0}`);
  console.log(`Purged From History:   ${row.int_history_purged ?? 0}`);
  console.log(`Duration:              ${row.int_duration_ms}ms`);
  console.log(`Success:               ${row.bln_success}${row.txt_error_message ? `\n${row.txt_error_message}` : ''}`);
  if (!row.bln_success) process.exit(1);
}

async function main(): Promise<void> {
  if (!clientSide) {
    const cronRes = await triggerPocketBaseServerCron(url, email!, password!);
    await cronRes.match({
      Ok: async () => {
        await new Promise(resolve => setTimeout(resolve, 2500));
        await printLatestServerAudit();
        process.exit(0);
      },
      Err: async err => {
        console.error(`Could not trigger the server maintenance hook: ${err}`);
        process.exit(1);
      }
    });
    return;
  }

  const res = await prunePocketBaseSessions(url, email!, password!, days);
  res.match({
    Ok: report => {
      console.log('--- PocketBase Cascade Cleanup Report (client-side) ---');
      console.log(`Cutoff Date:           ${report.cutoffTimestamp}`);
      console.log(`Deleted Game Sessions: ${report.deletedSessionsCount}`);
      console.log(`Deleted Arcade Events: ${report.deletedArcadeEventsCount}`);
      console.log(`Session Codes:         ${report.sessionCodes.join(', ') || 'None'}`);
      console.log(`Duration:              ${report.durationMs}ms`);
      process.exit(0);
    },
    Err: err => {
      console.error(`Cleanup failed: ${err}`);
      process.exit(1);
    }
  });
}

main();
