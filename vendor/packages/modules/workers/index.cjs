'use strict';
const { CpuWorkerPool } = require('./pool.cjs');
function createRuntimeModule(host) {
  let pool = null;
  return {
    name: 'workers', phase: 'boot', swappable: false,
    api: { getPool: () => pool },
    install() {
      if (host.config().workers !== false) pool = new CpuWorkerPool(host.config().workers);
      host.state('runtime').set('workers', pool);
    },
    close: () => pool?.close(),
  };
}
module.exports = { createRuntimeModule, ...require('./pool.cjs') };

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
