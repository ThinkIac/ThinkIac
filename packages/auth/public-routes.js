// Pacotes opcionais registram sua política sem Identity importar seus dados.
const resolvers = new Map();
export function registerPublicRouteResolver(id, resolver) { const key = String(id || '').trim(); if (!key || typeof resolver !== 'function') throw new TypeError('Resolver público inválido'); resolvers.set(key, resolver); return () => resolvers.delete(key); }
export function isRegisteredPublicPath(path, request = {}) { for (const resolver of resolvers.values()) { try { if (resolver(path, request) === true) return true; } catch { /* fail closed */ } } return false; }
export function clearPublicRouteResolversForTest() { resolvers.clear(); }
