export const FAVORITE_APPS_KEY = 'shell:favorite-packages:v1';

export function favoriteAppId(app) {
  const id = app?.packageName || app?.id || app?.name;
  return id == null ? '' : String(id);
}

export function readFavoriteApps(storage = typeof localStorage === 'undefined' ? null : localStorage) {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(FAVORITE_APPS_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((id) => typeof id === 'string' && id.length > 0))];
  } catch {
    return [];
  }
}

export function writeFavoriteApps(ids, storage = typeof localStorage === 'undefined' ? null : localStorage) {
  if (!storage) return;
  try { storage.setItem(FAVORITE_APPS_KEY, JSON.stringify(ids)); } catch {}
}

export function toggleFavoriteApp(ids, app) {
  const id = favoriteAppId(app);
  if (!id) return ids;
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

export function sortAppsWithFavorites(apps, favoriteIds) {
  const favorites = new Set(favoriteIds);
  return [...apps].sort((a, b) => {
    const aFavorite = favorites.has(favoriteAppId(a));
    const bFavorite = favorites.has(favoriteAppId(b));
    if (aFavorite !== bFavorite) return aFavorite ? -1 : 1;
    return String(a?.name || '').localeCompare(String(b?.name || ''));
  });
}
