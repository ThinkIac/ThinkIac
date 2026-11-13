const { getActiveApps, getPackageAvailability, getPackageViews } = require(".");
const { mobileApps } = require('./mobile_apps');
const { dispatchEvent } = require('logos');
const { getProxy } = require('logos');
const { authorize } = require('../../../../auth/permissions.cjs');
const fs = require('fs');
const path = require('path');

function isLoopbackRequest(req) {
  const address = req?.socket?.remoteAddress || req?.connection?.remoteAddress || '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

async function router_getActiveApps(req) {
  /**
   * @register_router apps/list
   * @method GET
   */
  try {
    const database = getProxy('auth');
    return await getActiveApps(undefined, req?.query?.appId || '', {
      canDiscover: (app) => authorize({
        userId: req.user?.id,
        permission: app.requiredPermission,
        database,
      }).allowed,
    });
  } catch (error) {
    return {
      error: "Failed to retrieve active apps: " + error.message,
      status: 403
    }
  }
}

function router_getPackageAvailability(req) {
  /**
   * @register_router apps/availability
   * @method GET
   */
  const names = String(req?.query?.packages || '')
    .split(',')
    .map((name) => name.trim())
    .slice(0, 20);
  return { packages: getPackageAvailability(names) };
}

async function router_mobileAppInventory(req, res) {
  /** @register_router apps/mobile/inventory @method POST */
  if (!isLoopbackRequest(req)) {
    res.status(403);
    return { error: 'Mobile inventory can only be sent by the local runtime or Hermes' };
  }
  try {
    const { appId, apps } = req.body || {};
    // O app Android local usa esta rota apenas para injetar no mesmo pipeline
    // que o Hermes usa; o handler normaliza e persiste antes de publicar.
    await dispatchEvent('device:mobile.apps.inventory.updated', { appId, apps });
    return { success: true };
  } catch (error) {
    res.status(400);
    return { error: error.message };
  }
}

async function router_mobileAppLaunch(req, res) {
  /** @register_router apps/mobile/launch @method POST */
  if (!isLoopbackRequest(req)) {
    res.status(403);
    return { error: 'Opening a mobile app can only be requested by the local WebView' };
  }
  const { appId, packageName } = req.body || {};
  if (!mobileApps.hasLaunchable(appId, packageName)) {
    res.status(404);
    return { error: 'No launchable Android app was found for this device' };
  }
  await dispatchEvent('device:emit', { appId, event: 'mobile:apps.launch', payload: { packageName } });
  return { success: true };
}

function safePackageAndView(packageName, viewName) {
  return /^[a-z0-9][a-z0-9-]*$/i.test(packageName || '')
    && /^[A-Za-z][A-Za-z0-9_-]*$/.test(viewName || '');
}

function findPackageDirectory(packageName) {
  const packagesRoot = path.resolve(__dirname, '../../../../');
  for (const directory of fs.readdirSync(packagesRoot)) {
    const packageFile = path.join(packagesRoot, directory, 'package.json');
    if (!fs.existsSync(packageFile)) continue;
    try {
      if (JSON.parse(fs.readFileSync(packageFile, 'utf8')).name === packageName) return path.join(packagesRoot, directory);
    } catch { /* a malformed unrelated package must not break this operation */ }
  }
  return null;
}

async function router_setViewVisibility(req, res) {
  /** @register_router apps/view-visibility @method POST */
  if (req.user?.role !== 'admin') {
    res.status(403);
    return { error: 'Administrator access is required to change a view visibility.' };
  }
  const { packageName, view, public: isPublic } = req.body || {};
  if (!safePackageAndView(packageName, view) || typeof isPublic !== 'boolean') {
    res.status(400);
    return { error: 'A valid package, view, and visibility are required.' };
  }
  const packageDirectory = findPackageDirectory(packageName);
  if (!packageDirectory) {
    res.status(404);
    return { error: 'Package not found.' };
  }
  const viewsDirectory = path.join(packageDirectory, 'views');
  const protectedFile = path.join(viewsDirectory, `${view}.svelte`);
  const publicFile = path.join(viewsDirectory, `${view}.public.svelte`);
  const source = isPublic ? protectedFile : publicFile;
  const destination = isPublic ? publicFile : protectedFile;
  if (fs.existsSync(source) && fs.existsSync(destination)) {
    res.status(409);
    return { error: 'Both visibility variants exist. Resolve the duplicate view file before changing visibility.' };
  }
  if (!fs.existsSync(source)) {
    res.status(404);
    return { error: 'View source was not found.' };
  }
  fs.renameSync(source, destination);
  return { success: true, packageName, view, public: isPublic, route: `/view/${packageName}/${view}` };
}

module.exports = { router_getActiveApps, router_getPackageAvailability, router_mobileAppInventory, router_mobileAppLaunch, router_setViewVisibility, safePackageAndView, findPackageDirectory };
