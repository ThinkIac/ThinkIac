// Legacy public compatibility implementation, owned by module-hooks.
module.exports = function(require, module, exports, __dirname, __filename, kernel) {
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.hooksModule = void 0;
exports.wirePackageHooks = wirePackageHooks;
const scan_1 = require("../kernel/scan");
const conditions_1 = require("../kernel/conditions");
const middleware_1 = require("../kernel/middleware");
const bridge_1 = require("../core/isolated/bridge");
async function wirePackageHooks(container, pkg) {
    const previousScope = container.getPackageScope(pkg.folder);
    if (previousScope)
        await container.disposePackageScope(pkg.folder, 'hooks_rewired');
    else
        container.bus.removeOwner(pkg.folder);
    const scope = container.createPackageScope(pkg.folder, String(Date.now()));
    let hooks = [];
    const runner = (0, bridge_1.getIsolatedRunner)(container, pkg.folder);
    try {
        hooks = runner?.surfaces?.hooks.map(hook => ({ ...hook, call: (payload, context) => runner.invoke(hook.id, [payload], context) })) ?? await (0, scan_1.registerHooks)(pkg.folder);
    }
    catch {
        return 0;
    }
    for (const hook of hooks) {
        container.bus.on(hook.event, async (payload, ctx = {}) => {
            const pkgContext = { ...ctx, pkg, matchedEvent: hook.event };
            const allowed = await (0, conditions_1.resolveConditions)(hook.condition || {}, pkgContext);
            if (!allowed)
                return undefined;
            let middlewares = [];
            try {
                middlewares = await (0, middleware_1.resolveMiddlewares)(pkg.folder, pkgContext);
            }
            catch { /* none */ }
            let result;
            await (0, middleware_1.runMiddlewares)(middlewares, pkgContext, async () => {
                result = await hook.call(payload, pkgContext);
            });
            return result; // pipeline: non-null replaces the payload
        }, { owner: pkg.folder, priority: hook.priority ?? 100, operation: 'transform', scope });
    }
    return hooks.length;
}
exports.hooksModule = {
    name: 'hooks',
    phase: 'wire',
    install(container) {
        container.bus.on('package:wiring', (payload) => wirePackageHooks(container, payload.pkg), { priority: 40 });
    },
};

};
