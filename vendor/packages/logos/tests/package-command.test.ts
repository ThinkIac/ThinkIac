import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { makeWorkspace, FixtureWorkspace } from './helpers';
import { scanCache } from '../src/kernel/scan';
import { discoverPackageCommands, runMinimalPackageCommand } from '../src/cli/package-command';

let ws: FixtureWorkspace;
beforeEach(() => { ws = makeWorkspace(); process.env.PACKAGES_PATH = ws.root; scanCache.clear(); });
afterEach(() => ws.cleanup());

describe('isolated package CLI commands', () => {
  it('lists and runs only the requested package, even when another package shares the command name', async () => {
    ws.pkg('alpha', {
      'package.json': '{}',
      'commands.js': '/**\n * @register_command run\n */\nexports.run = function run() { return "alpha"; };',
    });
    ws.pkg('beta', {
      'package.json': '{}',
      'commands.js': '/**\n * @register_command run\n */\nexports.run = function run() { return "beta"; };',
    });

    const listed = await discoverPackageCommands(ws.root, 'beta');
    expect(listed.commands.map((command: any) => command.name)).toEqual(['run']);
    const result = await runMinimalPackageCommand(ws.root, 'beta', 'run', {});
    expect(result).toMatchObject({ requiresFullRuntime: false, result: 'beta' });
  });

  it('returns the full-runtime signal without running that command in isolation', async () => {
    ws.pkg('legacy', {
      'package.json': '{}',
      'commands.js': '/**\n * @register_command sync\n * @cli_runtime full\n */\nexports.sync = function sync() { return "must not run"; };',
    });
    const result = await runMinimalPackageCommand(ws.root, 'legacy', 'sync', {});
    expect(result.requiresFullRuntime).toBe(true);
  });

  it('rejects missing packages and path-like package names', async () => {
    await expect(discoverPackageCommands(ws.root, 'missing')).rejects.toThrow('Package not found: missing');
    await expect(discoverPackageCommands(ws.root, '../outside')).rejects.toThrow('Invalid package name');
  });
});
