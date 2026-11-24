'use strict';

// The public module boundary. Consumers intentionally do not depend on the
// Logos source-tree layout or on its compiled dist path.
module.exports = {
  ...require('./lib/engine.cjs'),
  ...require('./lib/routes.cjs'),
  ...require('./lib/assets.cjs'),
  ...require('./lib/file-digests.cjs'),
  ...require('./lib/tailwind-styles.cjs'),
  ...require('./runtime/offline.cjs'),
  createRuntimeModule: require('./runtime-module.cjs').createRuntimeModule,
};

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
