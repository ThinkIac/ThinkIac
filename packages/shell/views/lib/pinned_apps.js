export const LEGACY_PINNED_APPS_KEY = 'aura-pinned-packages';

function discardInvalidValue(storage) {
  try { storage?.removeItem?.(LEGACY_PINNED_APPS_KEY); } catch { /* storage bloqueado */ }
}

export function readPinnedApps(storage = typeof localStorage === 'undefined' ? null : localStorage) {
  if (!storage) return [];
  try {
    const raw = storage.getItem(LEGACY_PINNED_APPS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      discardInvalidValue(storage);
      return [];
    }
    return parsed.filter((name) => typeof name === 'string');
  } catch {
    discardInvalidValue(storage);
    return [];
  }
}
