import { requirePermission } from '../auth/authorization.js';
// A revisão identifica este contrato para o carregador incremental do Runtime.
// Sem ela, uma tentativa anterior que importou a versão sem `listKeyTabs`
// permanece no cache ESM até uma reinicialização completa.
import { listKeyTabs, listSettingsTabs } from './lib/tabs.js?settings-keys-tab-v1';

export { listKeyTabs, listLegacySystemTabs, listSettingsTabs, normalizeSettingsTab } from './lib/tabs.js?settings-keys-tab-v1';

export async function routerTabs(req, res) {
  /**
   * @register_router tabs
   * @method GET
   * @description Lista as abas administrativas declaradas pelos pacotes.
   */
  requirePermission(req, 'auth.users.read');
  return { tabs: listSettingsTabs(), keyTabs: listKeyTabs() };
}
