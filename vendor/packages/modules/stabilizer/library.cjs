'use strict';
const path = require('node:path');
const { isBuiltin } = require('node:module');

// A library is bound to the caller's kernel primitives. No global container,
// authority context, scanner cache, or isolated-runner state is duplicated.
const libraries = new WeakMap();
function createLibrary(ports) {
  const identity = ports['../kernel/scan'];
  if (libraries.has(identity)) return libraries.get(identity);
  const cache = new Map();
  function load(name) {
    if (!/^[a-z]+$/.test(name)) throw new Error(`Invalid stabilization library: ${name}`);
    if (cache.has(name)) return cache.get(name).exports;
    const filename = path.join(__dirname, 'runtime', `${name}.cjs`);
    const factory = require(filename);
    const entry = { exports: {} };
    cache.set(name, entry);
    const scopedRequire = id => {
      if (id.startsWith('./')) return load(id.slice(2));
      if (Object.prototype.hasOwnProperty.call(ports, id)) return ports[id];
      if (id === '../database/schema-composer') return requireCapabilityDependency("@thinkiac/module-db/schema-composer.cjs", "../db/schema-composer.cjs");
      if (isBuiltin(id) || id === 'chokidar') return require(id);
      throw new Error(`Undeclared stabilization dependency: ${id}`);
    };
    try { factory(scopedRequire, entry, entry.exports, path.dirname(filename), filename); }
    catch (error) { cache.delete(name); throw error; }
    return entry.exports;
  }
  libraries.set(identity, load);
  return load;
}
module.exports = { createLibrary };

function requireCapabilityDependency(name, local) {
  let entry;
  try { entry = require.resolve(name); }
  catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    entry = require.resolve(local);
  }
  return require(entry);
}
