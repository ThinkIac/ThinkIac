import test from 'node:test';
import assert from 'node:assert/strict';
import { destinationUrl, isPublicExposure, normalizePublicPaths, normalizeRoleRules, resolveHomepage, resolveHomepageForUser, validateHomepageInput } from '../lib/routing.js';

test('monta um destino interno estável a partir de pacote e página', () => {
  assert.equal(destinationUrl({ type: 'app', packageName: 'tasks', page: 'Home' }), '/view/tasks/Home');
  assert.equal(destinationUrl({ type: 'external_url', url: 'https://example.com' }), 'https://example.com');
});

test('homepage aceita somente destino direto válido', () => {
  assert.deepEqual(validateHomepageInput({ homepageMode: 'group' }), { valid: false, message: 'The home page only accepts a direct destination.' });
  assert.deepEqual(validateHomepageInput({ homepageType: 'app', homepagePackageName: '', homepagePage: 'Index' }), { valid: false, message: 'Select a package and page.' });
  assert.deepEqual(validateHomepageInput({ homepageType: 'app', homepagePackageName: 'main-site', homepagePage: 'Index' }), { valid: true });
});

test('não inventa fallback quando a homepage não está configurada', () => {
  assert.equal(resolveHomepage({}), null);
  assert.equal(resolveHomepage({ homepageMode: 'direct', homepageType: 'app', homepagePackageName: 'tasks', homepagePage: 'Index' }), '/view/tasks/Index');
});

test('exposição pública limita-se à homepage interna e paths exatos', () => {
  const config = { homepageMode: 'direct', homepageType: 'app', homepagePackageName: 'main-site', homepagePage: 'Index', homepageAccessMode: 'public', homepagePublicPaths: '["/main-site/packages"]' };
  assert.deepEqual(normalizePublicPaths(['/main-site/packages', '/main-site/*', '//host']), ['/main-site/packages']);
  assert.equal(isPublicExposure('/view/main-site/Index', config), true);
  assert.equal(isPublicExposure('/main-site/packages', config), true);
  assert.equal(isPublicExposure('/main-site/packages/private', config), false);
});

test('regras ordenadas selecionam papel fixo ou grupo declarado antes do fallback', () => {
  const config = {
    homepageType: 'app', homepagePackageName: 'main-site', homepagePage: 'Index',
    homepageRoleRules: JSON.stringify([
      { group: 'redirect:manager', destination: { type: 'app', packageName: 'system', page: 'Index' } },
      { role: 'user', destination: { type: 'app', packageName: 'shell', page: 'Index' } },
    ]),
  };
  assert.deepEqual(normalizeRoleRules(config.homepageRoleRules).map((item) => item.group || item.role), ['redirect:manager', 'user']);
  assert.equal(resolveHomepageForUser(config, { role: 'user' }, ['redirect:manager']), '/view/system/Index');
  assert.equal(resolveHomepageForUser(config, { role: 'user' }, []), '/view/shell/Index');
  assert.equal(resolveHomepageForUser(config, { role: 'admin' }, []), '/view/main-site/Index');
});

test('uma regra de cargo personalizado usa o id persistido do grupo', () => {
  const config = {
    homepageType: 'app', homepagePackageName: 'main-site', homepagePage: 'Index',
    homepageRoleRules: JSON.stringify([
      { groupId: 'role-sales-01', destination: { type: 'app', packageName: 'crm', page: 'Home' } },
    ]),
  };
  assert.deepEqual(normalizeRoleRules(config.homepageRoleRules).map((item) => item.groupId), ['role-sales-01']);
  assert.equal(resolveHomepageForUser(config, { role: 'user' }, ['role-sales-01']), '/view/crm/Home');
  assert.equal(resolveHomepageForUser(config, { role: 'user' }, []), '/view/main-site/Index');
});

test('regra salva para a role de produto prevalece sobre o destino padrão da conta', () => {
  const config = {
    homepageType: 'app', homepagePackageName: 'main-site', homepagePage: 'Index',
    homepageRoleRules: JSON.stringify([
      { group: 'cnpj-scraper:operator', destination: { type: 'app', packageName: 'cnpj-scraper', page: 'Home' } },
    ]),
  };
  assert.equal(resolveHomepageForUser(config, { role: 'user' }, ['cnpj-scraper:operator']), '/view/cnpj-scraper/Home');
});
