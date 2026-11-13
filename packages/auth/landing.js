/** Apenas destinos internos de UI ou de apps distribuídos podem ser salvos. */
export function normalizeLandingPath(value) {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\')) return null;
  let parsed; try { parsed = new URL(candidate, 'http://identity.local'); } catch { return null; }
  const path = parsed.pathname;
  if (!path.startsWith('/view/') && !/^\/auth\/apps\/[a-z0-9-]+\/enter$/i.test(path)) return null;
  if (path === '/view/auth/Login') return null;
  return `${path}${parsed.search}${parsed.hash}`;
}
export function landingDestination(user, fallback = null) { return normalizeLandingPath(user?.landingPath) || fallback; }
