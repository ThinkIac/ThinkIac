import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const flags = ['--legacy-peer-deps', '--no-audit', '--no-fund'];
const result = spawnSync(npm, ['install', ...flags], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, PUPPETEER_SKIP_DOWNLOAD: '1' },
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

console.log('\n[setup] minimal runtime dependencies installed');
