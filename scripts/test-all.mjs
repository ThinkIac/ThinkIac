import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

export async function runSuites(suites, { log = console.log, stdio = 'inherit', signal } = {}) {
  if (!suites.length) throw new Error('Empty mandatory suite selection');
  const results = [];
  for (const suite of suites) {
    if (signal?.aborted) break;
    const started = Date.now();
    log(`\nRunning ${suite.name}`);
    let status = 'FAIL', detail = '';
    try {
      if (!suite.command || !Number.isFinite(suite.timeoutMs) || suite.timeoutMs <= 0) throw new Error(suite.error || 'Invalid suite command or timeout');
      for (const file of suite.files ?? []) if (!existsSync(resolve(suite.cwd, file))) throw new Error(`Missing mandatory file: ${file}`);
      const outcome = await new Promise(resolveResult => {
        const child = spawn(suite.command, suite.args, { cwd: suite.cwd, stdio, detached: process.platform !== 'win32' });
        let reason, killTimer;
        const kill = sig => {
          try { process.platform === 'win32' ? child.kill(sig) : process.kill(-child.pid, sig); } catch (e) { if (e.code !== 'ESRCH') detail = e.message; }
        };
        const stop = why => {
          if (reason) return;
          reason = why;
          kill('SIGTERM');
          killTimer = setTimeout(() => kill('SIGKILL'), 300);
        };
        const abort = () => stop('INTERRUPTED');
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        const timer = setTimeout(() => stop('TIMEOUT'), suite.timeoutMs);
        child.on('error', error => { detail = error.message; });
        child.on('close', (code, sig) => {
          // Kill remaining descendants even if their parent exited on SIGTERM.
          if (reason) kill('SIGKILL');
          clearTimeout(timer); clearTimeout(killTimer);
          signal?.removeEventListener('abort', abort);
          resolveResult({ status: reason ?? (code === 0 ? 'PASS' : 'FAIL'), detail: detail || `exit=${code} signal=${sig ?? 'none'}` });
        });
      });
      ({ status, detail } = outcome);
    } catch (error) { detail = error.message; }
    const result = { name: suite.name, status, durationMs: Date.now() - started, detail };
    results.push(result);
    log(`${status} ${suite.name} (${(result.durationMs / 1000).toFixed(2)}s) ${detail}`);
  }
  return results;
}

export function loadSuites() {
  const manifest = JSON.parse(readFileSync(resolve(root, 'scripts/test-suites.json'), 'utf8'));
  return manifest.suites.map(suite => {
    try {
      const cwd = suite.runtime ? dirname(require.resolve('logos/package.json')) : resolve(root, suite.cwd);
      if (!suite.files?.length) throw new Error('Empty mandatory file selection');
      const args = suite.runner === 'vitest'
        ? [resolve(dirname(require.resolve('vitest/package.json')), 'vitest.mjs'), 'run', '--config', resolve(root, 'scripts/test-vitest.config.mjs'), '--root', cwd, ...suite.files]
        : suite.runner === 'npm' ? ['test'] : ['--test', '--test-concurrency=1', ...suite.files];
      return { ...suite, cwd, command: suite.runner === 'npm' ? 'npm' : process.execPath, args };
    } catch (error) {
      return { ...suite, cwd: root, command: '', error: error.message };
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  let interrupted;
  const sigint = () => { interrupted = 130; controller.abort(); };
  const sigterm = () => { interrupted = 143; controller.abort(); };
  process.on('SIGINT', sigint); process.on('SIGTERM', sigterm);
  try {
    const suites = loadSuites();
    const results = await runSuites(suites, { signal: controller.signal });
    console.log('\nSuite summary');
    for (const r of results) console.log(`${r.status}\t${r.name}\t${(r.durationMs / 1000).toFixed(2)}s`);
    process.exitCode = interrupted ?? (results.length === suites.length && results.every(r => r.status === 'PASS') ? 0 : 1);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { process.off('SIGINT', sigint); process.off('SIGTERM', sigterm); }
}
