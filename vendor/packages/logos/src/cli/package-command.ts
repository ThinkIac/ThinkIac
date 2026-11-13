// src/cli/package-command.ts — isolated package command discovery/execution.

'use strict';

import fs from 'fs';
import path from 'path';
import { registerCommands } from '../kernel/scan';
import { resolveConditions } from '../kernel/conditions';
import { createRuntimeContext } from '../kernel/context';
import { resolveMiddlewares, runMiddlewares } from '../kernel/middleware';
import { externalModulePath } from '../kernel/external-modules';

const { createCommandRunner } = require(externalModulePath('commands'));
const runCommand = createCommandRunner({
  scan: registerCommands,
  resolveConditions,
  createContext: createRuntimeContext,
  resolveMiddlewares,
  runMiddlewares,
});

export function resolvePackagePath(workspace: string, folder: string): string {
  if (!folder || folder === '.' || folder === '..' || folder.includes(path.sep) || folder.includes('/') || folder.includes('\\')) {
    throw new Error(`Invalid package name: ${folder || '(empty)'}`);
  }
  const packagePath = path.join(workspace, folder);
  if (!fs.existsSync(packagePath) || !fs.statSync(packagePath).isDirectory() || !fs.existsSync(path.join(packagePath, 'package.json'))) {
    throw new Error(`Package not found: ${folder}`);
  }
  return packagePath;
}

export async function discoverPackageCommands(workspace: string, folder: string) {
  const packagePath = resolvePackagePath(workspace, folder);
  return { packagePath, commands: await registerCommands(packagePath) };
}

export async function runMinimalPackageCommand(workspace: string, folder: string, name: string, args: any) {
  const { packagePath, commands } = await discoverPackageCommands(workspace, folder);
  const command = commands.find((item: any) => item.name === name);
  if (!command) throw new Error(`Command not found: ${folder}:${name}`);
  if (command.cliRuntime === 'full') return { requiresFullRuntime: true, packagePath, command };

  const result = await runCommand(packagePath, name, args, { pkg: undefined, cli: true });
  return { requiresFullRuntime: false, packagePath, command, result };
}
