const { mobileApps } = require('./mobile_apps');
const { dispatchEvent } = require('logos');

async function onMobileAppsInventory(payload = {}) {
  /**
   * @register_hook device:mobile.apps.inventory.updated
   * @description Validates and replaces the inventory of launchable activities from an Android device authenticated with Hermes.
   */
  const record = mobileApps.replace(payload.appId, payload);
  await dispatchEvent('aura:mobile.apps.catalog.updated', {
    appId: payload.appId,
    count: record.apps.length,
    updatedAt: record.updatedAt,
  });
  return payload;
}

module.exports = { onMobileAppsInventory };
