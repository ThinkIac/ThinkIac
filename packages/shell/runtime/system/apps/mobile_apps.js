const fs = require('fs');
const path = require('path');

const MAX_APPS = 400;
const PACKAGE_NAME = /^[a-zA-Z][\w]*(?:\.[a-zA-Z][\w]*)+$/;

function cleanText(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function normaliseApp(input) {
  if (!input || typeof input !== 'object') throw new Error('invalid app');
  const packageName = cleanText(input.packageName, 255);
  const label = cleanText(input.label, 100);
  if (!PACKAGE_NAME.test(packageName)) throw new Error('invalid packageName');
  if (!label) throw new Error('label is required');
  if (input.launchable !== true) return null;
  return {
    packageName,
    label,
    versionName: cleanText(input.versionName, 80) || null,
    launchable: true,
    icon: /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(input.icon || '')
      ? input.icon
      : null,
  };
}

function normaliseInventory(input = {}) {
  if (!Array.isArray(input.apps)) throw new Error('apps must be a list');
  if (input.apps.length > MAX_APPS) throw new Error(`${MAX_APPS} app limit exceeded`);
  const apps = input.apps.map(normaliseApp).filter(Boolean);
  const unique = new Map(apps.map(app => [app.packageName, app]));
  return { apps: [...unique.values()].sort((a, b) => a.label.localeCompare(b.label)) };
}

function catalogEntry(appId, app) {
  return {
    id: `mobile:${appId}:${app.packageName}`,
    packageName: app.packageName,
    name: app.label,
    description: app.versionName ? `Android · ${app.versionName}` : 'Android',
    native: false,
    default: true,
    mobile: { appId, packageName: app.packageName, launchable: true },
    ...(app.icon ? { icon: app.icon, noBorder: true, padding: 0 } : {}),
  };
}

function createMobileAppInventoryStore(file = path.join(__dirname, 'data', 'mobile-apps.json')) {
  function read() {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      return data && typeof data === 'object' ? data : {};
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn(`[shell] invalid mobile inventory: ${error.message}`);
      return {};
    }
  }
  function write(data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(data, null, 2));
    fs.renameSync(temporary, file);
  }
  return {
    replace(appId, input) {
      const id = cleanText(appId, 128);
      if (!id) throw new Error('appId is required');
      const inventory = normaliseInventory(input);
      const data = read();
      data[id] = { updatedAt: new Date().toISOString(), ...inventory };
      write(data);
      return data[id];
    },
    catalog(appId) {
      const record = read()[cleanText(appId, 128)];
      return Array.isArray(record?.apps) ? record.apps.map(app => catalogEntry(appId, app)) : [];
    },
    hasLaunchable(appId, packageName) {
      return this.catalog(appId).some(app => app.mobile.packageName === packageName);
    },
  };
}

const mobileApps = createMobileAppInventoryStore(
  process.env.SHELL_MOBILE_APPS_FILE || process.env.AURA_MOBILE_APPS_FILE,
);

module.exports = { MAX_APPS, normaliseInventory, createMobileAppInventoryStore, mobileApps };
