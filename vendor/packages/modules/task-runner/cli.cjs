#!/usr/bin/env node
'use strict';

const { findRoot, plan, run, registry, startProcess, killTree } = require('./index.cjs');

async function main(argv = process.argv.slice(2), context = {}) {
  if (!argv.length || argv.includes('--help')) {
    console.log('logos tasks run <task...> [--filter <name|path>] [--concurrency <n>] [--dry-run] [--no-cache]\nlogos tasks install [--ci] [--registry <url>]\nOptions: --root <workspace>. Configuration: logos.tasks.json');
    return 0;
  }
  const command = argv[0];
  const options = { filters: [] };
  const tasks = [];
  let root = context.root;
  let selectedRegistry;
  let ci = false;
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (['--root', '--filter', '--concurrency', '--registry'].includes(arg)) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value: ${arg}`);
      if (arg === '--root') root = value;
      if (arg === '--filter') options.filters.push(value);
      if (arg === '--concurrency') options.concurrency = Number(value);
      if (arg === '--registry') selectedRegistry = value;
    } else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--no-cache') options.cache = false;
    else if (arg === '--ci') ci = true;
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else tasks.push(arg);
  }
  root = findRoot(root);
  if (!['run', 'install'].includes(command)) throw new Error(`Unknown command: ${command}`);
  if (command === 'run' && (ci || selectedRegistry)) throw new Error('--ci and --registry are install options');
  if (command === 'install' && (tasks.length || options.filters.length || options.concurrency !== undefined || options.dryRun || options.cache === false)) throw new Error('install only accepts --ci, --registry and --root');
  const controller = new AbortController();
  let exitCode = 0;
  const interrupt = () => { exitCode = 130; controller.abort(); };
  const terminate = () => { exitCode = 143; controller.abort(); };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  try {
    if (command === 'run') {
      const graph = plan(root, tasks, options);
      if (options.dryRun) {
        console.log(JSON.stringify({ root, tasks: [...graph.nodes.values()].map(({ id, dependencies, script, rule }) => ({ id, dependencies, script: script || null, persistent: !!rule.persistent, cache: rule.cache === true })) }, null, 2));
      } else await run(graph, { ...options, signal: controller.signal });
    } else {
      const { configuration } = require('./index.cjs');
      const configuredRegistry = selectedRegistry || configuration(root).registry;
      const registryArgs = configuredRegistry ? ['--registry', registry(configuredRegistry)] : [];
      const proc = startProcess(process.platform === 'win32' ? 'npm.cmd' : 'npm', [ci ? 'ci' : 'install', ...registryArgs], { cwd: root, env: { ...process.env }, log: console.log, id: 'install' });
      let timer;
      const cancel = () => { killTree(proc.child, 'SIGTERM'); timer = setTimeout(() => killTree(proc.child, 'SIGKILL'), 1500); };
      controller.signal.addEventListener('abort', cancel, { once: true });
      try { await proc.done; } finally {
        controller.signal.removeEventListener('abort', cancel);
        clearTimeout(timer);
        if (controller.signal.aborted) killTree(proc.child, 'SIGKILL');
      }
    }
    return exitCode;
  } catch (error) {
    if (exitCode) return exitCode;
    throw error;
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
  }
}

module.exports = { main };
if (require.main === module) main().then(code => { process.exitCode = code; }, error => { console.error(`[tasks] ${error.message}`); process.exitCode = 1; });
