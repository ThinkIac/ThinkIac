import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { makeWorkspace, FixtureWorkspace } from './helpers';
import { scanCache } from '../src/kernel/scan';
import { discoverPackageCommands, runMinimalPackageCommand } from '../src/cli/package-command';
import { commandHelpRequested, formatCommandHelp, parseCommandArguments } from '../src/cli/command-arguments';

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

describe('declared CLI arguments', () => {
  async function installedCommand() {
    ws.pkg('pkgmgr', {
      'package.json': '{}',
      'commands.js': `/**
 * @register_command install
 * @order package, num
 * @param {string} package - Package to install
 * @alias p, pkg
 * @param {number?} num - Number
 * @param {boolean?} force - Force installation
 * @parameter force
 * @alias f
 */
exports.install = function install(args) { return args; };`,
    });
    const { commands } = await discoverPackageCommands(ws.root, 'pkgmgr');
    return commands[0];
  }

  it('normalizes named options, aliases, and mixed arguments before dispatch', async () => {
    const command = await installedCommand();
    for (const argv of [
      ['--package', 'calendar', '--num', '3', '--force'],
      ['-p', 'calendar', '3', '-f'],
      ['calendar', '--num=3', '-f'],
      ['--pkg', 'calendar', '3', '--force=true'],
      ['--params', '{"package":"calendar","num":3}', '-f'],
    ]) {
      const args = parseCommandArguments(argv, command);
      const { result } = await runMinimalPackageCommand(ws.root, 'pkgmgr', 'install', args);
      expect(result).toEqual({ package: 'calendar', num: 3, force: true });
    }
    expect(parseCommandArguments(['-f', '--', '--help', '-3'], command))
      .toEqual({ force: true, package: '--help', num: -3 });
    expect(commandHelpRequested(['--', '--help'])).toBe(false);
    expect(commandHelpRequested(['-h'])).toBe(true);
  });

  it('reports invalid input and generates help from the same declarations', async () => {
    const command = await installedCommand();
    expect(() => parseCommandArguments(['calendar', '-p', 'other'], command)).toThrow('Duplicate parameter: --package');
    expect(() => parseCommandArguments(['calendar', '-f', '--force'], command)).toThrow('Duplicate parameter: --force');
    expect(() => parseCommandArguments(['calendar', '--other'], command)).toThrow('Unknown option: --other');
    expect(() => parseCommandArguments(['-p'], command)).toThrow('Missing value for -p');
    expect(() => parseCommandArguments(['-f'], command)).toThrow('Missing required parameter: --package');
    expect(() => parseCommandArguments(['calendar', 'x'], command)).toThrow('expected number');
    expect(() => parseCommandArguments(['calendar', '3', 'extra'], command)).toThrow('Unexpected positional');
    expect(() => parseCommandArguments(['calendar'], { ...command, order: undefined })).toThrow('Unexpected positional');

    const help = formatCommandHelp('logos', 'pkgmgr', command);
    expect(help).toContain('logos pkgmgr install <package> [num] [options]');
    expect(help).toContain('-p, --pkg, --package');
    expect(help).toContain('-f, --force');
    expect(help).toContain('logos pkgmgr:install --package');
  });
});
