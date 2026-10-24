import { runPocketBaseMigration } from '../src/server/pocketbase/migrator';

const rawUrl = process.env.POCKETBASE_URL;
const url = rawUrl && !rawUrl.startsWith('${') ? rawUrl : 'https://web-chess.pockethost.io';

const rawEmail = process.env.PB_ADMIN_EMAIL || process.env.POCKETBASE_SUPERUSER_EMAIL;
const email = rawEmail && !rawEmail.startsWith('${') ? rawEmail : process.env.PB_ADMIN_EMAIL;

const rawPassword = process.env.PB_ADMIN_PASSWORD || process.env.POCKETBASE_SUPERUSER_PASSWORD;
const password = rawPassword && !rawPassword.startsWith('${') ? rawPassword : process.env.PB_ADMIN_PASSWORD;

if (!email || !password) {
  console.error(
    'Error: PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD (or POCKETBASE_SUPERUSER_EMAIL/PASSWORD) environment variables are required.'
  );
  console.error('Usage: Ensure PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD exist in ~/.zshrc or .env, then run: bun run pb:migrate');
  process.exit(1);
}

runPocketBaseMigration(url, email, password).then(res => {
  if (!res.success) {
    console.error('Migration failed:', res.errors);
    process.exit(1);
  } else {
    console.log('Migration successful:', res.applied);
    process.exit(0);
  }
});
