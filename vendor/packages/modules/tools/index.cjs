'use strict';

const { createBridge } = require('./tools-bridge.cjs');
const { createRuntime } = require('./legacy-tools.cjs');

function facade(host) {
  return {
    workspace: host.workspace(), authority: host.tools.authority(),
    registry: host.registry, state: host.state,
    bus: { on: host.on, emit: host.emit, veto: host.veto, pipeline: host.pipeline },
  };
}

function createRuntimeModule(host) {
  const legacy = createRuntime(createBridge(host));
  const container = facade(host);
  return {
    name: 'tools', phase: 'wire',
    api: {
      loadMcpTools: workspace => legacy.loadMcpTools(container, workspace),
      kernelTools: () => legacy.kernelTools(container),
    },
    install() {
      host.on('logos:package:validating', async ({ pkg, result }) => {
        const runner = host.tools.isolatedRunner(null, pkg.folder);
        const tools = runner?.surfaces?.tools || await host.tools.scan(pkg.folder);
        for (const tool of tools) {
          const schema = tool.parameters;
          if (!schema || schema.type !== 'object' || !schema.properties || typeof schema.properties !== 'object' ||
              (schema.required !== undefined && !Array.isArray(schema.required))) {
            throw new TypeError(`Tool ${tool.name ?? '<unknown>'} must expose an object JSON schema`);
          }
          host.tools.authority().enforce({ principal: { kind: 'package', id: pkg.folder },
            surface: 'tools', operation: 'provide', resource: `${pkg.folder}.${tool.name}` });
        }
        result.tools = tools.length;
      });
      legacy.toolsModule.install(container);
      host.on('logos:package:staging', async ({ pkg, checks }) => {
        const expected = pkg.runtime?.stability?.tools;
        if (!expected) return;
        try {
          const tools = await host.tools.scan(pkg.folder);
          if (expected === 'all') checks.push({ name: 'tools:all', ok: true, detail: `${tools.length} tool(s) loaded` });
          else if (Array.isArray(expected)) {
            const names = new Set(tools.map(tool => tool.name));
            const missing = expected.filter(name => !names.has(name));
            checks.push({ name: 'tools:vital', ok: !missing.length, detail: missing.length ? `missing: ${missing.join(', ')}` : 'all vital tools present' });
            if (missing.length) throw new Error(`vital tools missing: ${missing.join(', ')}`);
          }
        } catch (error) { checks.push({ name: 'tools:load', ok: false, detail: error.message }); throw error; }
      });
    },
  };
}
module.exports = { createRuntimeModule };

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
