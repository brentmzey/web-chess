import { execSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { resolve } from 'path';

/**
 * Deploys JavaScript hooks in pb_hooks/ to PocketHost via SFTP.
 * Uses ~/.ssh/pockethost_ed25519 and port 2222 configured for ftp.pockethost.io.
 */
function deployHooks() {
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

deployHooks();
