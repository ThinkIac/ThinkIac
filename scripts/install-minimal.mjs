import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const flags = ['--legacy-peer-deps', '--no-audit', '--no-fund'];
const installs = [
  ['root runtime', ['install', ...flags]],
  ['Agent', ['install', '--prefix', 'packages/agent', ...flags]],
  ['File Manager', ['install', '--prefix', 'packages/file-manager', ...flags]],
  ['Package Manager', ['install', '--prefix', 'packages/pkgmgr', ...flags]],
  ['Shell', ['install', '--prefix', 'packages/shell', ...flags]],
  ['Media Library', ['install', '--prefix', 'packages/media-library', ...flags]],
];

for (const [name, args] of installs) {
  console.log(`\n[setup] installing ${name}`);
  const result = spawnSync(npm, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, PUPPETEER_SKIP_DOWNLOAD: '1' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log('\n[setup] minimal runtime dependencies installed');
