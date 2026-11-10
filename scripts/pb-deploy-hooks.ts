import { execSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { resolve } from 'path';

/**
 * Deploys JavaScript hooks in pb_hooks/ to the `web-chess` PocketHost instance.
 *
 * PocketHost is retiring SFTP (port 2222, SSH keys) on 2027-02-06 in favor of the `pockethost` CLI
 * over HTTPS (see https://pockethost.io/blog/sftp-sunset). This script now prefers that CLI,
 * authenticated via `POCKETHOST_TOKEN` (a personal access token from the PocketHost dashboard,
 * sourced only from `~/.zshrc`, same as every other credential in this repo) and falls back to the
 * legacy SFTP path only until that token is set up, so deploys never silently break mid-transition.
 *
 * The deploy is deliberately scoped to `pb_hooks` only (`--include pb_hooks pb_hooks/**`), matching
 * this script's historical, narrow responsibility: schema/migrations go through `pb:migrate`
 * (direct PocketBase Admin REST calls), not native `pb_migrations` files, so this script has no
 * business touching migrations or `pb_public` on the server.
 */
function deployHooksViaCli() {
  console.log('[PocketHost CLI] POCKETHOST_TOKEN found; deploying pb_hooks/ via `pockethost deploy`.');
  execSync(
    'pockethost deploy web-chess --include pb_hooks "pb_hooks/**/*" --no-node-modules --message "pb_hooks deploy from web-chess repo"',
    { stdio: 'inherit' }
  );
  console.log('[PocketHost CLI] Hook deployment successful.');
}

function deployHooksViaSftp() {
  const hooksDir = resolve(process.cwd(), 'pb_hooks');
  if (!existsSync(hooksDir)) {
    console.error(`Error: pb_hooks directory not found at ${hooksDir}`);
    process.exit(1);
  }

  const hookFiles = readdirSync(hooksDir).filter(f => f.endsWith('.js'));
  if (hookFiles.length === 0) {
    console.log('No JavaScript hook files found in pb_hooks/.');
    return;
  }

  console.warn(
    '[PocketHost SFTP] POCKETHOST_TOKEN not set - falling back to legacy SFTP, which PocketHost retires ' +
    '2027-02-06. Run `pockethost login <token>` (token from the PocketHost dashboard) and add ' +
    '`export POCKETHOST_TOKEN="ph_pat_..."` to ~/.zshrc to switch to the supported CLI path.'
  );
  console.log(`[PocketHost SFTP] Found ${hookFiles.length} hook files to deploy: ${hookFiles.join(', ')}`);

  const sftpCommands = hookFiles
    .map(file => `put pb_hooks/${file} web-chess/pb_hooks/${file}`)
    .join('\n');

  try {
    const output = execSync(
      `echo "${sftpCommands}" | sftp -P 2222 -i ~/.ssh/pockethost_ed25519 -o BatchMode=yes brentmzey4795@gmail.com@ftp.pockethost.io`,
      { encoding: 'utf8' }
    );
    console.log('[PocketHost SFTP] Hook deployment successful:');
    console.log(output);
  } catch (err: any) {
    console.error('[PocketHost SFTP] Hook deployment failed:', err.message);
    if (err.stdout) console.log(err.stdout);
    if (err.stderr) console.error(err.stderr);
    process.exit(1);
  }
}

function deployHooks() {
  if (process.env.POCKETHOST_TOKEN) {
    deployHooksViaCli();
  } else {
    deployHooksViaSftp();
  }
}

deployHooks();
