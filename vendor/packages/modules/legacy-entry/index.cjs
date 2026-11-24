'use strict';

// Compatibility is itself a capability. The kernel neither reads legacy
// package entries nor gives them an Express application directly.
const fs = require('node:fs');
const path = require('node:path');

function createRuntimeModule(host) {
  function wire(pkg) {
    if (!pkg || !pkg.entry) return;
    const entry = path.join(pkg.dir, pkg.entry);
    if (!fs.existsSync(entry)) return;
    try {
      const resolved = require.resolve(entry);
      delete require.cache[resolved];
      const usePackage = require(resolved);
      if (typeof usePackage !== 'function') {
        host.log(`${pkg.name || pkg.folder}: invalid entry point (expected a function)`);
        return;
      }
      const result = host.http.runAsPackage(pkg.folder, () => usePackage(host.http.app()) || usePackage);
      if (result && result.setup) host.http.runAsPackage(pkg.folder, () => result.setup());
      host.log(`${pkg.name || pkg.folder}${pkg.version ? ` version ${pkg.version}` : ''} is running.`);
    } catch (error) {
      host.log(`Error with package ${pkg.name || pkg.folder}: ${error.message}`);
    }
  }
  return {
    name: 'legacy-entry', phase: 'wire', after: ['http'], api: { wire },
    install() { host.on('package:wiring', ({ pkg }) => wire(pkg), { priority: 55 }); },
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
