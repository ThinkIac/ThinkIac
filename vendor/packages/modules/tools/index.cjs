'use strict';

const bridge = require('./tools-bridge.cjs');
const legacy = require('./legacy-tools.cjs');

function facade(host) {
  return {
    workspace: host.workspace(), authority: host.tools.authority(),
    registry: host.registry, state: host.state,
    bus: { on: host.on, emit: host.emit, veto: host.veto, pipeline: host.pipeline },
  };
}

function createRuntimeModule(host) {
  bridge.configure(host);
  const container = facade(host);
  return {
    name: 'tools', phase: 'wire',
    api: {
      loadMcpTools: workspace => legacy.loadMcpTools(container, workspace),
      kernelTools: () => legacy.kernelTools(container),
    },
    install() { legacy.toolsModule.install(container); },
  };
}
module.exports = { createRuntimeModule };
