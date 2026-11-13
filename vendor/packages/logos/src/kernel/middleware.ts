// kernel/middleware.ts — package middleware resolution & chain execution.
// v1 API preserved: resolveMiddlewares(pkgFolder, context) / runMiddlewares.

'use strict';

import { registerPredicates, registerMiddlewares } from './scan';

export async function loadMiddlewareSnapshot(pkgFolder: string) {
  let predicatesList: any[] = [];
  let middlewares: any[] = [];
  try { predicatesList = await registerPredicates(pkgFolder); } catch { /* no folder */ }
  try { middlewares = await registerMiddlewares(pkgFolder); } catch { /* no folder */ }

  const predicates: Record<string, Function> = {};
  for (const p of predicatesList) predicates[p.name] = p.call;

  return { predicates, middlewares };
}

/** Metadata belongs to a router generation; predicate decisions belong to a request. */
export async function resolveMiddlewares(pkgFolder: string, context: any, snapshot?: Awaited<ReturnType<typeof loadMiddlewareSnapshot>>): Promise<any[]> {
  const { predicates, middlewares } = snapshot ?? await loadMiddlewareSnapshot(pkgFolder);
  const allowed: any[] = [];
  for (const middleware of middlewares) {
    let ok = true;
    for (const predicateName of middleware.predicates || []) {
      const fn = predicates[predicateName];
      if (typeof fn === 'function') {
        const result = await fn(context);
        if (!result) { ok = false; break; }
      }
    }
    if (ok) allowed.push(middleware);
  }
  return allowed;
}

export async function runMiddlewares(middlewares: any[], context: any, handler: () => any): Promise<any> {
  let idx = 0;
  const next = async (): Promise<any> => {
    if (idx < middlewares.length) {
      const mw = middlewares[idx++];
      return mw.call(context, next);
    }
    return handler();
  };
  return next();
}
