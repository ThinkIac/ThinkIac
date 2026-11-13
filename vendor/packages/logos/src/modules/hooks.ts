// modules/hooks.ts — wires package @register_hook functions into the bus.
//
// v1's dispatchEvent iterated every package on every dispatch. v2 registers
// hooks ON the bus at wiring time (owner = package folder); dispatchEvent is
// now just bus.pipeline(). Reload removes the owner's subscriptions and
// re-registers — stale handlers cannot linger.
//
// v1 semantics preserved per hook: conditions checked against the dispatch
// context, package middlewares run around the hook, a non-null return value
// replaces the payload.

'use strict';

import { Container, LogosModule } from '../kernel/container';
import { registerHooks } from '../kernel/scan';
import { resolveConditions } from '../kernel/conditions';
import { resolveMiddlewares, runMiddlewares } from '../kernel/middleware';
import { getIsolatedRunner } from '../core/isolated/bridge';

export async function wirePackageHooks(container: Container, pkg: any): Promise<number> {
  const previousScope = container.getPackageScope(pkg.folder);
  if (previousScope) await container.disposePackageScope(pkg.folder, 'hooks_rewired');
  else container.bus.removeOwner(pkg.folder);
  const scope = container.createPackageScope(pkg.folder, String(Date.now()));

  let hooks: any[] = [];
  const runner = getIsolatedRunner(container, pkg.folder);
  try { hooks = runner?.surfaces?.hooks.map(hook => ({ ...hook, call: (payload: any, context: any) => runner.invoke(hook.id, [payload], context) })) ?? await registerHooks(pkg.folder); } catch { return 0; }

  for (const hook of hooks) {
    container.bus.on(hook.event, async (payload: any, ctx: any = {}) => {
      const pkgContext = { ...ctx, pkg, matchedEvent: hook.event };

      const allowed = await resolveConditions(hook.condition || {}, pkgContext);
      if (!allowed) return undefined;

      let middlewares: any[] = [];
      try { middlewares = await resolveMiddlewares(pkg.folder, pkgContext); } catch { /* none */ }

      let result: any;
      await runMiddlewares(middlewares, pkgContext, async () => {
        result = await hook.call(payload, pkgContext);
      });
      return result; // pipeline: non-null replaces the payload
    }, { owner: pkg.folder, priority: hook.priority ?? 100, operation: 'transform', scope });
  }
  return hooks.length;
}

export const hooksModule: LogosModule = {
  name: 'hooks',
  phase: 'wire',
  install(container: Container) {
    container.bus.on('package:wiring', (payload: any) => wirePackageHooks(container, payload.pkg), { priority: 40 });
  },
};
