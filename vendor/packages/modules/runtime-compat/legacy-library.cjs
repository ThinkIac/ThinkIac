'use strict';
const path = require('node:path');
const { createRequire } = require('node:module');
const mapping = require('./legacy-modules.json');
const libraries = new WeakMap();

// Preserve internal import compatibility without keeping resource implementations
// in Logos. Every implementation remains in its owning capability package.
function createLegacyLibrary(kernel, resolveModule) {
  if (libraries.has(kernel.scan)) return libraries.get(kernel.scan);
  const cache = new Map();
  function load(name) {
    if (cache.has(name)) return cache.get(name).exports;
    const target = mapping[name];
    if (!target) throw new Error(`Unknown legacy capability import: ${name}`);
    const filename = path.join(resolveModule(target[0]), 'compat', target[1]);
    const entry = { exports: {} };
    cache.set(name, entry);
    const ownerRequire = createRequire(filename);
    const requireScoped = id => {
      if (!id.startsWith('.')) return ownerRequire(id);
      const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(name), id));
      if (mapping[dependency]) return load(dependency);
      if (kernel.ports[dependency]) return kernel.ports[dependency];
      if (path.isAbsolute(id)) return require(id);
      throw new Error(`Undeclared legacy capability dependency: ${name} -> ${id}`);
    };
    try {
      require(filename)(requireScoped, entry, entry.exports, path.dirname(filename), filename,
        { resolveModule: name => require(resolveModule(name)) });
    } catch (error) { cache.delete(name); throw error; }
    return entry.exports;
  }
  libraries.set(kernel.scan, load);
  return load;
}
module.exports = { createLegacyLibrary };
