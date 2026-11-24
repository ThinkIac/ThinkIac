'use strict';

// Repository hosting is installed as a normal capability. Its SSH, deploy,
// branch and proxy transports live in this package.
function provideRepo(host) {
  /**
   * @register module repo
   * @context capability
   */

  let state = null;
  return {
    name: 'repo', phase: 'wire', after: ['http', 'tools'],
    async close() { await state?.close?.(); },
    api: {
      getState: () => state,
      close: async () => { await state?.close?.(); },
    },
    install() {
      const legacy = require('./transport');
      legacy.repoModule.install(host.repo.container());
      state = legacy.getRepoState(host.repo.container());
    },
  };
}
module.exports = { provideRepo };

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
module.exports.createRuntimeModule = provideRepo;
