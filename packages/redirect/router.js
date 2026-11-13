import { getOrCreateConfig, resolveConfiguredHomepage } from './core.js';
import { normalizePublicPaths, normalizeRoleRules, validateHomepageInput } from './lib/routing.js';
import { assertSurface } from '../ui-schema/index.js';
import { dispatchEvent, getProxy } from 'logos';
import { requirePermission } from '../auth/authorization.js';
import permissionCatalogService from '../auth/permission_catalog.cjs';

const { defaultPermissionCatalog } = permissionCatalogService;

const ok = (data = {}) => ({ status: 200, ...data });
const fail = (mensagem, status = 400) => ({ status, mensagem });
const ACCESS_MODES = new Set(['public', 'authenticated', 'admin']);

const SYSTEM_SURFACE = Object.freeze({
  version: 1,
  kind: 'redirect-routing',
  eyebrow: 'Instance entry point',
  title: 'Home page',
  description: 'Choose the direct destination served at this instance root.',
  forms: { homepage: { fields: [
    { name: 'homepageType', component: 'select' },
    { name: 'homepagePackageName', component: 'select' },
    { name: 'homepageUrl', component: 'input' },
    { name: 'homepageAccessMode', component: 'select' },
    { name: 'homepagePublicPaths', component: 'textarea' },
    { name: 'homepageRoleRules', component: 'textarea' },
  ] } },
  actions: { 'redirect.save-homepage': { intent: 'write' } },
});

export async function listarEstado(req) {
  /** @register_router api/estado
   * @method GET */
  requirePermission(req, 'redirect.homepage.read');
  return ok({ config: await getOrCreateConfig() });
}

export async function salvarHomepage(req) {
  /** @register_router api/homepage
   * @method POST */
  requirePermission(req, 'redirect.homepage.write');
  const config = await getOrCreateConfig();
  const body = req.body || {};
  const normalized = { ...body, homepageMode: 'direct' };
  const validation = validateHomepageInput(normalized);
  if (!validation.valid) return fail(validation.message);
  for (const field of ['homepageMode', 'homepageType', 'homepagePackageName', 'homepagePage', 'homepageUrl']) {
    config[field] = String(normalized[field] || '').trim();
  }
  config.homepageAccessMode = ACCESS_MODES.has(body.homepageAccessMode) ? body.homepageAccessMode : 'admin';
  config.homepagePublicPaths = JSON.stringify(normalizePublicPaths(body.homepagePublicPaths));
  config.homepageRoleRules = JSON.stringify(normalizeRoleRules(body.homepageRoleRules));
  const url = await resolveConfiguredHomepage();
  await dispatchEvent('redirect:homepage-saved', { url, accessMode: config.homepageAccessMode });
  return ok({ config, url });
}

export async function systemView(req) {
  /** @register_router system/view
   * @method GET */
  requirePermission(req, 'redirect.homepage.read');
  return { status: 200, surface: assertSurface(SYSTEM_SURFACE), state: await systemState(req) };
}

export async function systemAction(req) {
  /** @register_router system/action
   * @method POST */
  requirePermission(req, 'redirect.homepage.write');
  if (String(req.body?.action || '') !== 'redirect.save-homepage') return fail('System action is not allowed.', 404);
  const values = req.body?.values && typeof req.body.values === 'object' ? req.body.values : {};
  const result = await salvarHomepage({ ...req, body: values });
  if (result?.status >= 400) return result;
  return { status: 200, state: await systemState(req), notice: 'Home page updated.' };
}

// Redirect is allowed to read the role names it needs to configure its own
// destinations.  Do not make this UI depend on Auth's global permission-admin
// endpoint: a routing manager may have redirect permissions without
// `auth.access.read`.
async function systemState(req) {
  const state = await listarEstado(req);
  const auth = getProxy('auth');
  return {
    config: state.config,
    roleGroups: (auth.permissionGroup.query({}) || []).map(({ id, name, declaredPackage, declaredGroup }) => ({ id, name, declaredPackage, declaredGroup })),
    declaredRoles: defaultPermissionCatalog.list(),
  };
}

export async function homepage(req, res) {
  /** @register_router home
   * @method GET */
  const url = await resolveConfiguredHomepage(req?.user || null);
  return res.redirect(url || '/view/desktop/Index');
}
