import { getProxy, dispatchEvent, on } from 'logos';
import { isPublicExposure as matchesPublicExposure, resolveHomepage, resolveHomepageForUser } from './lib/routing.js';

const db = getProxy('redirect');

async function getOrCreateConfig() {
  let config = db.config.findOne({});
  if (!config) config = await db.config.push({});
  return config;
}

function roleGroupsFor(userId) {
  if (!userId) return [];
  const auth = getProxy('auth');
  return (auth.permissionMembership.query({ userId }) || []).flatMap((membership) => {
    const group = auth.permissionGroup[membership.groupId];
    if (!group) return [];
    const roles = [group.id];
    if (group.declaredPackage && group.declaredGroup) roles.push(`${group.declaredPackage}:${group.declaredGroup}`);
    return roles;
  });
}

function configuredHomepage(user = null) {
  const config = db.config.findOne({}) || {};
  if (!user) return resolveHomepage(config);
  const groups = roleGroupsFor(user.id);
  // A configuration explicitly saved for a role always wins.  In particular,
  // this lets an administrator change the landing page of a product role
  // after the role has been assigned to people.
  const configured = resolveHomepageForUser(config, user, groups);
  if (configured && configured !== resolveHomepage(config)) return configured;
  // Product-only accounts should land directly in their sole workspace. This
  // is deliberately a declared group, not the structural user.role field. It
  // is a fallback only, so it never overwrites a saved role destination.
  if (groups.includes('cnpj-scraper:operator')) return '/view/cnpj-scraper/Home';
  return configured;
}

async function resolveConfiguredHomepage(user = null) {
  const url = configuredHomepage(user);
  if (url) await dispatchEvent('redirect:homepage-resolved', { url });
  return url;
}

function isPublicExposure(path) {
  try { return matchesPublicExposure(path, db.config.findOne({}) || {}); }
  catch { return false; }
}

// The Runtime owns `/`; Redirect only claims it while an administrator has
// saved a valid destination. No Redirect fallback is installed.
on('views:index', (payload) => {
  const redirect = configuredHomepage(payload?.req?.user || null);
  return redirect ? { ...payload, redirect } : payload;
});

export { db, getOrCreateConfig, isPublicExposure, resolveConfiguredHomepage };
