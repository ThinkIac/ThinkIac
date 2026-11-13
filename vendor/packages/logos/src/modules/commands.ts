// modules/commands.ts — command execution (CLI + programmatic).
// v1 API preserved: runCommand(workspace, name, args, context).

'use strict';

import path from 'path';
import fs from 'fs';
import { registerCommands } from '../kernel/scan';
import { resolveConditions } from '../kernel/conditions';
import { createRuntimeContext } from '../kernel/context';
import { resolveMiddlewares, runMiddlewares } from '../kernel/middleware';
import { Container, LogosModule } from '../kernel/container';

export async function runCommand(workspace: string, name: string, args: any = {}, context: any = createRuntimeContext()) {
  // A CLI target such as `billing:reconcile` must never resolve a same-named
  // command from another package. Programmatic callers without `pkg` retain
  // the legacy workspace-wide scan.
  const packageFolder = context?.pkg;
  const commandWorkspace = packageFolder
    ? path.join(workspace, packageFolder)
    : workspace;
  if (packageFolder && (!fs.existsSync(commandWorkspace) || !fs.statSync(commandWorkspace).isDirectory())) {
    throw new Error(`Package not found: ${packageFolder}`);
  }

  const commands = await registerCommands(commandWorkspace);
  const command = commands.find((c: any) => c.name === name);
  if (!command) throw new Error(`Command not found: ${name}`);

  const allowed = await resolveConditions(command.condition || {}, context);
  if (!allowed) throw new Error(`Command not available in this context: ${name}`);

  const middlewares = await resolveMiddlewares(commandWorkspace, context);
  return runMiddlewares(middlewares, context, async () => command.call(args, context));
}

export const commandsModule: LogosModule = {
  name: 'commands',
  phase: 'wire',
  install(container: Container) {
    container.bus.on('command:run', async (payload: any, ctx: any) => {
      return runCommand(payload.workspace ?? container.workspace, payload.name, payload.args, ctx);
    }, { priority: 50 });
  },
};
