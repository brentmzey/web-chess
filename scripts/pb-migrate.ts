import { runPocketBaseMigration } from '../src/server/pocketbase/migrator';

const url = process.env.POCKETBASE_URL || 'https://web-chess.pockethost.io';
const email = process.env.POCKETBASE_SUPERUSER_EMAIL;
const password = process.env.POCKETBASE_SUPERUSER_PASSWORD;

if (!email || !password) {
  console.error(
    'Error: POCKETBASE_SUPERUSER_EMAIL and POCKETBASE_SUPERUSER_PASSWORD environment variables are required.'
  );
  console.error('Usage: POCKETBASE_SUPERUSER_EMAIL=... POCKETBASE_SUPERUSER_PASSWORD=... bun run pb:migrate');
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
