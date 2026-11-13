import { getProxy } from 'logos';

function normalizePublicPaths(value) {
  let paths = value;
  if (typeof paths === 'string') {
    try { paths = JSON.parse(paths); } catch { return []; }
  }
  if (!Array.isArray(paths)) return [];
  return paths.map(String).filter(path => path.startsWith('/') && !path.startsWith('//'));
}

/**
 * Auth owns the access decision. Redirect may contribute configuration when
 * installed, but it is no longer a static bootstrap dependency.
 */
export function isPublicExposure(path) {
  try {
    const db = getProxy('redirect');
    const config = db.config.findOne({}) || {};
    if (config.homepageMode === 'direct' && config.homepageAccessMode === 'public') {
      const packageName = String(config.homepagePackageName || '').trim();
      const page = String(config.homepagePage || 'Index').trim();
      const view = packageName && page
        ? `/view/${encodeURIComponent(packageName)}/${encodeURIComponent(page)}`
        : null;
      if (view && [view, ...normalizePublicPaths(config.homepagePublicPaths)].includes(path)) return true;
    }
    return false;
  } catch {
    return false;
  }
}
