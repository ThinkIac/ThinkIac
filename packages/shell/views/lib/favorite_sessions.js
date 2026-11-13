export const FAVORITE_SESSIONS_KEY = 'shell:favorite-sessions:v1';

export function readFavoriteSessions(storage = typeof localStorage === 'undefined' ? null : localStorage) {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(FAVORITE_SESSIONS_KEY) || '[]');
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((id) => typeof id === 'string' && id.length > 0))]
      : [];
  } catch {
    return [];
  }
}

export function writeFavoriteSessions(ids, storage = typeof localStorage === 'undefined' ? null : localStorage) {
  if (!storage) return;
  try { storage.setItem(FAVORITE_SESSIONS_KEY, JSON.stringify(ids)); } catch {}
}

export function toggleFavoriteSession(ids, sessionId) {
  const id = String(sessionId || '');
  if (!id) return ids;
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}
