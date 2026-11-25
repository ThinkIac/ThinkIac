'use strict';
function create(scanners) {
const exports = {};
const { registerTools, registerHooks, registerRoutes, registerCommands, registerPredicates, registerMiddlewares, resolveAgentFolder } = scanners;
// kernel/middleware.ts — package middleware resolution & chain execution.
// v1 API preserved: resolveMiddlewares(pkgFolder, context) / runMiddlewares.
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadMiddlewareSnapshot = loadMiddlewareSnapshot;
exports.resolveMiddlewares = resolveMiddlewares;
exports.runMiddlewares = runMiddlewares;
async function loadMiddlewareSnapshot(pkgFolder) {
    let predicatesList = [];
    let middlewares = [];
    try {
        predicatesList = await registerPredicates(pkgFolder);
    }
    catch { /* no folder */ }
    try {
        middlewares = await registerMiddlewares(pkgFolder);
    }
    catch { /* no folder */ }
    const predicates = {};
    for (const p of predicatesList)
        predicates[p.name] = p.call;
    return { predicates, middlewares };
}
/** Metadata belongs to a router generation; predicate decisions belong to a request. */
async function resolveMiddlewares(pkgFolder, context, snapshot) {
    const { predicates, middlewares } = snapshot ?? await loadMiddlewareSnapshot(pkgFolder);
    const allowed = [];
    for (const middleware of middlewares) {
        let ok = true;
        for (const predicateName of middleware.predicates || []) {
            const fn = predicates[predicateName];
            if (typeof fn === 'function') {
                const result = await fn(context);
                if (!result) {
                    ok = false;
                    break;
                }
            }
        }
        if (ok)
            allowed.push(middleware);
    }
    return allowed;
}
async function runMiddlewares(middlewares, context, handler) {
    let idx = 0;
    const next = async () => {
        if (idx < middlewares.length) {
            const mw = middlewares[idx++];
            return mw.call(context, next);
        }
        return handler();
    };
    return next();
}

return exports;
}
module.exports = { create };
