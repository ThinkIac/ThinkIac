import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { installProfile } from './launcher/profile.mjs';

const base = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
try {
  const at = args.indexOf('--profile');
  if (at >= 0 && !args[at + 1]) throw new Error('--profile precisa de um arquivo JSON');
  const profileFile = path.resolve(at >= 0 ? args[at + 1] : process.env.THINKIAC_PROFILE || path.join(base, 'profiles/default.json'));
  const installed = await installProfile({ base, profileFile, update: args.includes('--update') });
  if (!args.includes('--install-only')) {
    const state = path.join(installed.home, installed.profile.name, 'state');
    const supervisor = args.indexOf('--supervisor');
    const entry = supervisor >= 0
      ? ['node_modules/logos/dist/src/cli/index.js', 'supervisor', args[supervisor + 1] || 'start', ...(args[supervisor + 1] === 'run' ? [] : ['Agent'])]
      : ['--import', 'dotenv/config', 'index.js'];
    const child = spawn(process.execPath, entry, {
      cwd: installed.directory, stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      env: { ...process.env, LOGOS_DATA_DIR: process.env.LOGOS_DATA_DIR || state, DOTENV_CONFIG_PATH: process.env.DOTENV_CONFIG_PATH || path.join(base, '.env') },
    });
    child.on('message', message => process.send?.(message));
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
    child.on('error', error => { console.error(error.message); process.exitCode = 1; });
    child.on('exit', code => { process.exitCode = code ?? 1; });
  }
} catch (error) { console.error(`[profile] ${error.message}`); process.exitCode = 1; }
