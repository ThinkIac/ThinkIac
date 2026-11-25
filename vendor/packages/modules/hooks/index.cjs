'use strict';

// Event-hook capability.  Ownership is retained by the kernel's bus and
// EffectScope, while this package owns the decorator interpretation.
function provideHooks(host) {
  /**
   * @register module hooks
   * @accepts hook
   * @context capability
   */

  async function wire(pkg) {
    const previous = host.scopes.get(pkg.folder);
    if (previous) await host.scopes.dispose(pkg.folder, 'hooks_rewired'); else host.scopes.removeOwner(pkg.folder);
    const scope = host.scopes.create(pkg.folder, String(Date.now()));
    const runner = host.http.isolatedRunner(pkg.folder);
    let hooks; try { hooks = runner?.surfaces?.hooks.map(hook => ({ ...hook, call: (payload, context) => runner.invoke(hook.id, [payload], context) })) || await host.scanHooks(pkg.folder); } catch { return 0; }
    // Hooks have a dedicated scanner port so a route scanner can never make a
    // declaration executable by accident.
    for (const hook of hooks) host.on(hook.event, async (payload, context = {}) => {
      const pkgContext = { ...context, pkg, matchedEvent: hook.event };
      if (!await host.resolveConditions(hook.condition || {}, pkgContext)) return undefined;
      let result; let middleware = []; try { middleware = await host.http.resolveMiddlewares(pkg.folder, pkgContext); } catch {}
      await host.http.runMiddlewares(middleware, pkgContext, async () => { result = await hook.call(payload, pkgContext); });
      return result;
    }, { owner: pkg.folder, priority: hook.priority ?? 100, operation: 'transform', scope });
    return hooks.length;
  }
  return { name: 'hooks', phase: 'wire', api: { wirePackageHooks: wire }, install() {
    host.on('logos:package:validating', async ({ pkg, result }) => {
      const runner = host.http.isolatedRunner(pkg.folder);
      const hooks = runner?.surfaces?.hooks || await host.scanHooks(pkg.folder);
      for (const hook of hooks) host.tools.authority().enforce({ principal: { kind: 'package', id: pkg.folder },
        surface: 'events', operation: 'transform', resource: hook.event });
      result.hooks = hooks.length;
    });
    host.on('package:wiring', ({ pkg }) => wire(pkg), { priority: 40 });
    host.on('logos:package:swapping', ({ pkg }) => wire(pkg));
  } };
}
module.exports = { provideHooks };

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
module.exports.createRuntimeModule = provideHooks;
