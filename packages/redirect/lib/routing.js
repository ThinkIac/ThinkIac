export function destinationUrl(destination = {}) {
  if (destination.type === 'external_url') {
    const url = String(destination.url || '').trim();
    return /^https?:\/\//i.test(url) ? url : null;
  }
  if (destination.type === 'app' || destination.type === 'public_page') {
    const packageName = String(destination.packageName || '').trim();
    const page = String(destination.page || 'Index').trim();
    return packageName && page
      ? `/view/${encodeURIComponent(packageName)}/${encodeURIComponent(page)}`
      : null;
  }
  return null;
}

export function validateHomepageInput(input = {}) {
  if (!['direct', ''].includes(String(input.homepageMode || 'direct'))) {
    return { valid: false, message: 'The home page only accepts a direct destination.' };
  }
  if (input.homepageType === 'external_url') {
    return destinationUrl({ type: 'external_url', url: input.homepageUrl })
      ? { valid: true }
      : { valid: false, message: 'Enter a valid HTTP or HTTPS URL.' };
  }
  return destinationUrl({ type: input.homepageType, packageName: input.homepagePackageName, page: input.homepagePage })
    ? { valid: true }
    : { valid: false, message: 'Select a package and page.' };
}

export function normalizePublicPaths(value) {
  let paths = value;
  if (typeof paths === 'string') {
    try { paths = JSON.parse(paths); } catch { return []; }
  }
  if (!Array.isArray(paths)) return [];
  const normalized = [];
  for (const raw of paths) {
    const candidate = String(raw || '').trim();
    if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('*') || candidate.includes('\\') || candidate.includes('\0')) continue;
    try {
      const path = new URL(candidate, 'http://redirect.local').pathname;
      if (!normalized.includes(path)) normalized.push(path);
    } catch { /* invalid path */ }
  }
  return normalized;
}

export function resolveHomepage(config = {}) {
  if (config.homepageMode && config.homepageMode !== 'direct') return null;
  return destinationUrl({
    type: config.homepageType,
    packageName: config.homepagePackageName,
    page: config.homepagePage,
    url: config.homepageUrl,
  });
}

// Rules are intentionally data-only. A selector is either a fixed account
// role (`admin` or `user`), a declared permission group (`package:group`), or
// a persisted custom role group (`groupId`).
// The first matching rule wins; the direct homepage remains the fallback.
export function normalizeRoleRules(value) {
  let rules = value;
  if (typeof rules === 'string') {
    try { rules = JSON.parse(rules); } catch { return []; }
  }
  if (!Array.isArray(rules)) return [];
  const normalized = [];
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object') continue;
    const role = ['admin', 'user'].includes(String(rule.role || '')) ? String(rule.role) : null;
    const group = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/.test(String(rule.group || '')) ? String(rule.group) : null;
    const groupId = /^[A-Za-z0-9_-]+$/.test(String(rule.groupId || '')) ? String(rule.groupId) : null;
    const url = destinationUrl(rule.destination || rule);
    if (!url || (!role && !group && !groupId)) continue;
    normalized.push({ ...(role ? { role } : {}), ...(group ? { group } : {}), ...(groupId ? { groupId } : {}), destination: {
      type: rule.destination?.type || rule.type,
      packageName: rule.destination?.packageName || rule.packageName,
      page: rule.destination?.page || rule.page,
      url: rule.destination?.url || rule.url,
    } });
  }
  return normalized;
}

export function resolveHomepageForUser(config = {}, user = null, groups = []) {
  const memberships = new Set(groups);
  for (const rule of normalizeRoleRules(config.homepageRoleRules)) {
    if ((rule.role && user?.role === rule.role) || (rule.group && memberships.has(rule.group)) || (rule.groupId && memberships.has(rule.groupId))) {
      return destinationUrl(rule.destination);
    }
  }
  return resolveHomepage(config);
}

export function isPublicExposure(path, config = {}) {
  if (config.homepageMode !== 'direct' || config.homepageAccessMode !== 'public') return false;
  const target = resolveHomepage(config);
  return Boolean(target?.startsWith('/view/') && [target, ...normalizePublicPaths(config.homepagePublicPaths)].includes(path));
}
