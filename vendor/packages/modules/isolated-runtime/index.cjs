'use strict';
const { createBridge } = require('./bridge.cjs');
function provideIsolation(host) {
  /**
   * @register module isolation
   * @context capability
   */

  const bridge = createBridge(host.authority.runAsPackage);
  let container;
  return {
    name: 'isolation', phase: 'boot', swappable: false, api: bridge,
    install(c) { container = c; },
    async close() {
      if (!container) return;
      const results = await Promise.allSettled([...container.state('isolated').keys()].map(folder =>
        bridge.stopIsolatedRunner(container, folder, 'isolation_closed')));
      const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
      if (errors.length) throw new AggregateError(errors, 'Isolation shutdown failed');
    },
  };
}
module.exports = { provideIsolation, ...require('./runner.cjs') };

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

// Library alias for existing direct consumers; not used for runtime discovery.
module.exports.createRuntimeModule = provideIsolation;
