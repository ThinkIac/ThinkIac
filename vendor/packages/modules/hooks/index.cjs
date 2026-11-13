'use strict';

// Event-hook capability.  Ownership is retained by the kernel's bus and
// EffectScope, while this package owns the decorator interpretation.
function createRuntimeModule(host) {
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
  return { name: 'hooks', phase: 'wire', api: { wirePackageHooks: wire }, install() { host.on('package:wiring', ({ pkg }) => wire(pkg), { priority: 40 }); } };
}
module.exports = { createRuntimeModule };
