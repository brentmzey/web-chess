import { prunePocketBaseSessions } from '../src/server/pocketbase/pruner';

const rawUrl = process.env.POCKETBASE_URL;
const url = rawUrl && !rawUrl.startsWith('${') ? rawUrl : 'https://web-chess.pockethost.io';

const rawEmail = process.env.PB_ADMIN_EMAIL || process.env.POCKETBASE_SUPERUSER_EMAIL;
const email = rawEmail && !rawEmail.startsWith('${') ? rawEmail : process.env.PB_ADMIN_EMAIL;

const rawPassword = process.env.PB_ADMIN_PASSWORD || process.env.POCKETBASE_SUPERUSER_PASSWORD;
const password = rawPassword && !rawPassword.startsWith('${') ? rawPassword : process.env.PB_ADMIN_PASSWORD;

// Parse optional --days argument, default to 3 days
const daysArg = process.argv.find(arg => arg.startsWith('--days='));
const days = daysArg ? parseInt(daysArg.split('=')[1], 10) : 3;

if (!email || !password) {
  console.error(
    'Error: PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD (or POCKETBASE_SUPERUSER_EMAIL/PASSWORD) environment variables are required.'
  );
  console.error('Usage: Ensure PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD exist in ~/.zshrc or .env, then run: bun run pb:cleanup');
  process.exit(1);
}

prunePocketBaseSessions(url, email, password, days).then(res => {
  res.match({
    Ok: report => {
      console.log('--- PocketBase Cascade Cleanup Report ---');
      console.log(`Cutoff Date:           ${report.cutoffTimestamp}`);
      console.log(`Deleted Game Sessions: ${report.deletedSessionsCount}`);
      console.log(`Session Codes:         ${report.sessionCodes.join(', ') || 'None'}`);
      console.log(`Duration:              ${report.durationMs}ms`);
      process.exit(0);
    },
    Err: err => {
      console.error(`Cleanup failed: ${err}`);
      process.exit(1);
    }
  });
});
