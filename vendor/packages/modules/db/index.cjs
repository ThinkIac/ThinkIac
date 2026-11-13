'use strict';

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

function createDatabase(host) {
  let scriba = null, tried = false, loadError = null;
  const valid = value => /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value);
  const missing = error => error && error.code === 'MODULE_NOT_FOUND' && /Cannot find module ['\"]scriba['\"]/.test(error.message);
  const instantiate = module => { const Type = module && (module.default || module); if (typeof Type !== 'function') throw new Error('SCRIBA_INCOMPATIBLE_API: default export is not a constructor'); const instance = new Type(); const absent = ['addTenant','entity','tenants'].filter(name => typeof instance[name] !== 'function'); if (absent.length) throw new Error(`SCRIBA_INCOMPATIBLE_API: missing ${absent.join(', ')}`); return instance; };
  function loadScribaFrom(root) { let current = root, last; while (true) { try { return instantiate(createRequire(path.join(current, 'package.json'))('scriba')); } catch (error) { if (!missing(error) && !(error && String(error.message).startsWith('SCRIBA_INCOMPATIBLE_API'))) throw error; last = last || error; } const parent = path.dirname(current); if (parent === current) break; current = parent; } try { return instantiate(require('scriba')); } catch (error) { if (!missing(error) && !(error && String(error.message).startsWith('SCRIBA_INCOMPATIBLE_API'))) throw error; throw last || error; } }
  function getScriba() { if (tried) return scriba; tried = true; try { scriba = loadScribaFrom(host.applicationRoot()); } catch (error) { const incompatible = error && String(error.message).startsWith('SCRIBA_INCOMPATIBLE_API'); loadError = new Error(missing(error) ? 'SCRIBA_MODULE_MISSING' : incompatible ? error.message : 'SCRIBA_INITIALIZATION_FAILED', { cause: error }); host.log(`[db] ${loadError.message}`); host.appendLog('logos', 'db:initialize', loadError); scriba = null; } return scriba; }
  function resolveDatabasePath(folder, dir) { const dataDir = host.dataDir(); if (!dataDir) return path.join(dir, '.database'); const target = path.join(dataDir, 'db', folder); fs.mkdirSync(target, { recursive: true }); return path.join(target, '.database'); }
  function vault(container) { const state = container.state('private-vault'); let instance = state.get('instance'); if (!instance) { instance = host.createVault(container.config && container.config.privateVault || {}); state.set('instance', instance); } return instance; }
  function openPrivate(container, filename, key) { const factory = container.config && container.config.privateVault && container.config.privateVault.databaseFactory; try { return factory ? factory(filename, key) : host.openPrivateDatabase(filename, key); } finally { key.fill(0); } }
  function addTenant({ packageName, dir }) { const instance = getScriba(); if (instance) instance.addTenant({ id: packageName, path: resolveDatabasePath(packageName, dir), schema: host.composeSchema(dir)?.outputPath || `${dir}/schema.prisma`, watchSchema: false }); }
  function getProxy(tenant) { const authority = host.currentAuthority(); authority.access && authority.access.enforce({ principal: authority.principal, surface: 'database', operation: 'access', resource: tenant }); return new Proxy({}, { get(_target, entity) { if (typeof entity !== 'string') return; const instance = getScriba(); if (!instance) throw loadError || new Error('SCRIBA_UNAVAILABLE'); return instance.entity(entity, tenant); } }); }
  async function getDocuments(container, tenant) { const authority = host.currentAuthority(); authority.access && authority.access.enforce({ principal: authority.principal, surface: 'database', operation: 'access', resource: tenant }); if (!valid(tenant)) throw new Error('INVALID_DATABASE_TENANT'); const pkg = container.registry.getPackage(tenant); if (!fs.existsSync(path.join(pkg.dir, 'package.json'))) throw new Error('DATABASE_PACKAGE_NOT_FOUND'); const instance = getScriba(); if (!(instance && instance.documents)) throw new Error('SCRIBA_DOCUMENTS_UNAVAILABLE'); const pending = container.state('db:documents'); if (!pending.has(tenant)) { const open = (async () => { if (!instance.tenants().includes(tenant)) { if (fs.existsSync(path.join(pkg.dir, 'schema.prisma'))) throw new Error('DATABASE_NOT_READY'); const filename = resolveDatabasePath(tenant, pkg.dir); if (pkg.database === 'private') { const key = await vault(container).keyFor(tenant); if (!instance.tenants().includes(tenant)) instance.addTenant({ id: tenant, path: filename, databaseFactory: () => openPrivate(container, filename, key) }); } else instance.addTenant({ id: tenant, path: filename }); } return instance.documents(tenant); })(); pending.set(tenant, open); open.catch(() => { if (pending.get(tenant) === open) pending.delete(tenant); }); } return pending.get(tenant); }
  function install(container) { const registered = container.state('db'); container.bus.on('package:wiring', async payload => { const pkg = payload.pkg; if (registered.has(pkg.folder)) return; let composed; try { composed = host.composeSchema(pkg.dir); } catch (err) { host.appendLog(pkg.folder, 'db:composeSchema', err); return; } if (!composed) return; const instance = getScriba(); if (!instance) return; try { const filename = resolveDatabasePath(pkg.folder, pkg.dir); if (pkg.database === 'private') { const key = await vault(container).keyFor(pkg.folder); await instance.addTenant({ id: pkg.folder, path: filename, schema: composed.outputPath, watchSchema: false, databaseFactory: () => openPrivate(container, filename, key) }); } else await instance.addTenant({ id: pkg.folder, path: filename, schema: composed.outputPath, watchSchema: false }); registered.set(pkg.folder, true); await container.bus.emit('db:schema_composed', { pkg: pkg.folder, sources: composed.sources.map(source => path.relative(pkg.dir, source)) }); } catch (err) { host.appendLog(pkg.folder, 'db:addTenant', err); } }, { priority: 20 }); container.bus.on('db:schema_changed', async payload => { const folder = payload && payload.pkg; if (!folder || !registered.has(folder)) return; const pkg = container.registry.getPackage(folder); try { const composed = host.composeSchema(pkg.dir); if (!composed) return; const instance = getScriba(); if (!(instance && instance.reloadTenantSchema)) throw new Error('SCRIBA_SCHEMA_RELOAD_UNAVAILABLE'); await instance.reloadTenantSchema(folder, composed.outputPath); await container.bus.emit('db:schema_composed', { pkg: folder, sources: composed.sources.map(source => path.relative(pkg.dir, source)) }); } catch (err) { host.appendLog(folder, 'db:reloadSchema', err); await container.bus.emit('db:schema_compose_failed', { pkg: folder, error: err instanceof Error ? err.message : String(err) }); throw err; } }, { priority: 20 }); container.bus.once('runtime:packages_wired', () => { try { const instance = getScriba(); instance && instance._injectGlobals && instance._injectGlobals(); } catch {} }); }
  return { loadScribaFrom, resolveDatabasePath, getScriba, addTenant, getProxy, getDocuments, install };
}
module.exports = { createDatabase };

function createRuntimeModule(host) {
  const db = createDatabase({
    applicationRoot: host.applicationRoot, dataDir: host.dataDir, composeSchema: host.composeSchema,
    appendLog: host.appendLog, currentAuthority: host.currentAuthority, createVault: host.createVault,
    openPrivateDatabase: host.openPrivateDatabase, log: host.log,
  });
  return {
    name: 'db', phase: 'boot', swappable: false,
    api: db,
    install() {
      // Adapt the protocol ports to the small container shape consumed by the
      // reusable database implementation. No Logos code is imported here.
      db.install({
        state: host.state, bus: { on: host.on, once: host.once, emit: host.emit },
        registry: host.registry, config: host.config(),
      });
    },
  };
}
module.exports.createRuntimeModule = createRuntimeModule;
