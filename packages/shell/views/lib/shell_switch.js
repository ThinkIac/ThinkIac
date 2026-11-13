export function hasDesktopPackage(catalog) {
  if (!Array.isArray(catalog)) return false;

  return catalog.some((entry) =>
    entry?.packageName === 'desktop' ||
    entry?.id === 'desktop' ||
    /^\/view\/desktop(?:\/|$)/.test(entry?.url || '')
  );
}

export function resolveDesktopAvailability(catalog, previous = false) {
  return Array.isArray(catalog) ? hasDesktopPackage(catalog) : previous;
}
