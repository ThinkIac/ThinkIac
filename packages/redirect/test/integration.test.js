import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('redirect persiste somente a configuração direta da homepage', async () => {
  const schema = await read('../schema.prisma');
  assert.match(schema, /model Config/);
  assert.doesNotMatch(schema, /RedirectGroup|model Link|homepageGroupId/);
});

test('the System interface opens the home page without using Shell', async () => {
  const surface = await read('../../ui-schema/views/SystemSurface.svelte');
  assert.match(surface, />Open Home</);
  assert.match(surface, /window\.top\.location\.assign\('\/redirect\/home'\)/);
  assert.doesNotMatch(surface, /view\/shell\/Index/);
  assert.match(surface, /Role destinations/);
  assert.doesNotMatch(surface, /homepageRoleRules}.*textarea/);
});

test('o redirect publica eventos para salvar e resolver a homepage', async () => {
  const core = await read('../core.js');
  const router = await read('../router.js');
  assert.match(core, /on\('views:index'/);
  assert.match(router, /redirect:homepage-saved/);
  assert.doesNotMatch(router, /create-group|create-destination|reset-cycle/);
});
