#!/usr/bin/env node
// src/cli/index.ts — the logos / thinkiac CLI.
//
// Usage:
//   thinkiac                           interactive chat REPL (see chat.ts)
//   thinkiac chat [--url ...] [--session ...]
//   logos <package>:<command> [--params '{"k":"v"}'] [--key value ...]
//   logos list                         list packages and their commands
//   logos status                       lifecycle state of every package
//   logos commit <package>             force a stability commit (staging swap)
//
// This binary answers to two names — logos and thinkiac (see package.json
// "bin"); consumers may alias it further (e.g. `think`). logos manages the
// package workspace; thinkiac additionally defaults bare invocation to the
// chat REPL, Claude-Code style.
//
// Package-management commands boot the runtime with the HTTP server OFF,
// dispatch through the same bus/module path the HTTP surface uses, print the
// result and exit. resolveWorkspace() climbs parent directories until it
// finds a `packages/` folder, so the CLI works from anywhere inside a project.
// The chat REPL is a plain HTTP client and never boots the runtime itself.

'use strict';

import fs from 'fs';
import path from 'path';
import { printBanner } from './banner';
import { runChat } from './chat';

function cliVersion(): string {
  // Compiled path is dist/src/cli/index.js; package.json lives three levels up.
  try {
    return require('../../../package.json').version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function invokedAs(): string {
  return path.basename(process.argv[1] || 'logos').replace(/\.(js|cjs|mjs)$/, '');
}

function findWorkspace(start = process.cwd()): string {
  let dir = start;
  while (true) {
    const candidate = path.join(dir, 'packages');
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return path.join(start, 'packages'); // default; may not exist
    dir = parent;
  }
}

function parseArgs(argv: string[]): { positional: string[]; options: Record<string, any> } {
  const positional: string[] = [];
  const options: Record<string, any> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq > 2) { options[arg.slice(2, eq)] = arg.slice(eq + 1); continue; }
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) { options[key] = true; }
      else { options[key] = next; i++; }
    } else {
      positional.push(arg);
    }
  }
  return { positional, options };
}

function buildParams(options: Record<string, any>): Record<string, any> {
  let params: Record<string, any> = {};
  if (options.params) {
    try { params = JSON.parse(options.params); }
    catch { console.error('[cli] --params must be valid JSON'); process.exit(1); }
  }
  for (const [key, value] of Object.entries(options)) {
    if (key === 'params') continue;
    params[key] = value;
  }
  return params;
}

function printCommandResult(result: any): void {
  if (result !== undefined) console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
}

function parseByteSize(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const match = String(value).trim().match(/^(\d+)(B|KiB|MiB|GiB)?$/i);
  if (!match) throw new Error('--max-bytes must be an integer optionally followed by B, KiB, MiB, or GiB');
  const units: Record<string, number> = { b: 1, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3 };
  const result = Number(match[1]) * units[(match[2] || 'B').toLowerCase()];
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('--max-bytes is outside the supported range');
  return result;
}

async function main() {
  try {
    const { runCliExtension } = require('./extensions');
    if (await runCliExtension(process.argv.slice(2))) return;
  } catch (err: any) {
    console.error(`[cli] error: ${err.message}`);
    process.exitCode = 1;
    return;
  }
  const { positional, options } = parseArgs(process.argv.slice(2));
  const target = positional[0];
  const version = cliVersion();
  const name = invokedAs();

  if (target === 'repo') {
    const { runRepoCli } = require('./repo');
    try {
      await runRepoCli(positional, options);
    } catch (err: any) {
      console.error(`[cli] ${err.message}`);
      process.exitCode = 1;
    }
    return;
  }

  // `thinkiac chat`, or bare `thinkiac` with no subcommand, opens the
  // interactive REPL. It's a pure HTTP client, so it skips workspace
  // resolution and runtime bootstrap entirely.
  if (target === 'chat' || (!target && name === 'thinkiac' && !options.help)) {
    await runChat({ url: options.url, session: options.session, version });
    return;
  }

  const workspace = process.env.PACKAGES_PATH || findWorkspace();
  process.env.PACKAGES_PATH = workspace;

  if (target === 'gc') {
    const action = positional[1] || 'inspect';
    const logosRoot = path.join(path.dirname(workspace), '.logos');
    try {
      const { inventory, runGc } = require('../gc');
      if (action === 'inspect') {
        const result = await inventory(logosRoot);
        const output = options.json ? result : { root: result.root, scannedAt: result.scannedAt, totals: result.totals, errors: result.errors, truncated: result.truncated };
        console.log(JSON.stringify(output, null, 2));
        return;
      }
      if (action === 'run') {
        console.log(JSON.stringify(await runGc(logosRoot, { execute: options.execute === true, maxBytes: parseByteSize(options['max-bytes']) }), null, 2));
        return;
      }
      throw new Error('usage: logos gc inspect [--json] | logos gc run [--execute] [--max-bytes 500MiB]');
    } catch (err: any) {
      console.error(`[cli] gc error: ${err.message}`);
      process.exitCode = 1;
      return;
    }
  }

  if (!target || target === 'help' || options.help) {
    if (name === 'thinkiac') printBanner(version);
    console.log(`Lógos runtime CLI (${name})

  thinkiac                  interactive chat REPL with your agent
  thinkiac chat [--url u] [--session s]

  logos <package>:<command> [--params '{"k":"v"}'] [--key value]
  logos list                list packages and commands
  logos status              lifecycle state of every package
  logos commit <pkg>        force a stability commit (staging swap)
  logos manifest <pkg> [--write]      capability manifest (tools/hooks/routes/commands)
  logos repo <status|branches|up|down|log|key>   self-hosted repository
  logos gc inspect [--json]            inspect .logos without changing it
  logos gc run [--execute]             collect expired temporary files

  Workspace: ${workspace}`);
    process.exit(0);
  }

  const separator = target.indexOf(':');
  const isGlobalTarget = ['list', 'status', 'commit', 'manifest'].includes(target);

  // A package-qualified target is intentionally resolved before bootstrap.
  // Most operational commands only need their own source files; booting every
  // package would be slow and can emit unrelated logs or side effects.
  if (separator !== -1) {
    const pkgFolder = target.slice(0, separator);
    const commandName = target.slice(separator + 1);
    const params = buildParams(options);
    if (positional.length > 1) params._ = positional.slice(1);

    try {
      const { runMinimalPackageCommand } = require('./package-command');
      const isolated = await runMinimalPackageCommand(workspace, pkgFolder, commandName, params);
      if (!isolated.requiresFullRuntime) {
        printCommandResult(isolated.result);
        return;
      }

      // Explicit opt-in for commands that depend on global runtime services.
      const { bootstrap } = require('../index');
      const instance = await bootstrap({ workspace, port: false, hotReload: { enabled: false } });
      try {
        const { command } = require('../index');
        printCommandResult(await command(commandName, params, { pkg: pkgFolder, cli: true }));
      } finally {
        await instance.close();
      }
    } catch (err: any) {
      console.error(`[cli] error: ${err.message}`);
      process.exitCode = 1;
    }
    return;
  }

  // `logos <package>` is a cheap capability listing, not a runtime boot.
  if (!isGlobalTarget) {
    try {
      const { discoverPackageCommands } = require('./package-command');
      const { commands } = await discoverPackageCommands(workspace, target);
      if (!commands.length) console.log('(no commands)');
      for (const command of commands) {
        console.log(`${target}:${command.name}${command.description ? ` — ${command.description}` : ''}`);
      }
    } catch (err: any) {
      console.error(`[cli] error: ${err.message}`);
      process.exitCode = 1;
    }
    return;
  }

  // Boot the runtime with HTTP disabled — we just need the module graph.
  const { bootstrap } = require('../index');
  const instance = await bootstrap({ workspace, port: false, hotReload: { enabled: false } });

  try {
    if (target === 'list') {
      const { registerCommands } = require('../index');
      for (const pkg of instance.container.registry.discover()) {
        let commands: any[] = [];
        try { commands = await registerCommands(pkg.folder); } catch { /* none */ }
        console.log(`\n${pkg.folder}${pkg.version ? ` (v${pkg.version})` : ''}`);
        if (!commands.length) { console.log('  (no commands)'); continue; }
        for (const cmd of commands) console.log(`  ${pkg.folder}:${cmd.name}${cmd.description ? ` — ${cmd.description}` : ''}`);
      }
      return;
    }

    if (target === 'status') {
      console.log(JSON.stringify(instance.container.registry.snapshot(), null, 2));
      return;
    }

    if (target === 'commit') {
      const pkg = positional[1];
      if (!pkg) { console.error('[cli] usage: logos commit <package>'); process.exit(1); }
      const result = await instance.stabilizer.commit(pkg, 'cli');
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (target === 'manifest') {
      const pkg = positional[1];
      if (!pkg) { console.error('[cli] usage: logos manifest <package> [--write]'); process.exit(1); }
      const { generateManifest, writeManifest } = require('../kernel/manifest');
      if (options.write) {
        const outPath = await writeManifest(pkg);
        console.log(`[cli] manifest written to ${outPath}`);
      } else {
        console.log(JSON.stringify(await generateManifest(pkg), null, 2));
      }
      return;
    }

  } catch (err: any) {
    console.error(`[cli] error: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await instance.close();
    process.exit(process.exitCode || 0);
  }
}

main();
