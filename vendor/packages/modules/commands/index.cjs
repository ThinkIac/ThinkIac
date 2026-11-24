'use strict';

// Command dispatch is a capability: discovery, predicates and middleware are
// supplied through host ports so this module never imports Logos internals.
const fs = require('node:fs');
const path = require('node:path');

function createCommandRunner(ports) {
  const { scan, resolveConditions, createContext, resolveMiddlewares, runMiddlewares } = ports;
  return async function run(workspace, name, args = {}, context = createContext()) {
    const packageFolder = context && context.pkg;
    const commandWorkspace = packageFolder ? path.join(workspace, packageFolder) : workspace;
    if (packageFolder && (!fs.existsSync(commandWorkspace) || !fs.statSync(commandWorkspace).isDirectory())) {
      throw new Error(`Package not found: ${packageFolder}`);
    }
    const commands = await scan(commandWorkspace);
    const command = commands.find(entry => entry.name === name);
    if (!command) throw new Error(`Command not found: ${name}`);
    if (!await resolveConditions(command.condition || {}, context)) {
      throw new Error(`Command not available in this context: ${name}`);
    }
    const middlewares = await resolveMiddlewares(commandWorkspace, context);
    return runMiddlewares(middlewares, context, () => command.call(args, context));
  };
}

function createRuntimeModule(host) {
  const run = createCommandRunner(host.commands);

  return {
    name: 'commands', phase: 'wire',
    api: { run },
    install() {
      host.on('command:run', (payload = {}, context) => run(
        payload.workspace || host.workspace(), payload.name, payload.args, context,
      ), { priority: 50 });
    },
  };
}

module.exports = { createRuntimeModule, createCommandRunner };

// Compatibility factories resolve their SDK from their own dependency graph.
module.exports.createHost = (...args) => requireCapabilityDependency('@thinkiac/module-runtime-compat', '../runtime-compat').createHost(...args);

function requireCapabilityDependency(name, local) {
  let entry;
  try { entry = require.resolve(name); }
  catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    entry = require.resolve(local);
  }
  return require(entry);
}
