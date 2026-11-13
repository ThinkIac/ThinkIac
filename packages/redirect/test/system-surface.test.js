import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('redirect declares the native System surface and keeps its standalone view', async () => {
  const manifest = await read('../package.json');
  const routes = await read('../router.js');
  assert.match(manifest, /"renderer": "schema"/);
  assert.match(manifest, /"surface": "routing"/);
  assert.match(routes, /@register_router system\/view/);
  assert.match(routes, /@register_router system\/action/);
  assert.match(routes, /requirePermission\(req, 'redirect\.homepage\.read'\)/);
  assert.match(routes, /requirePermission\(req, 'redirect\.homepage\.write'\)/);
  assert.match(routes, /redirect\.save-homepage/);
  assert.match(routes, /redirect:homepage-saved/);
  assert.doesNotMatch(routes, /redirect\.create-group|redirect\.create-destination/);
});

test('System Redirect includes built-in, persisted, and declared roles', async () => {
  const surface = await read('../../ui-schema/views/SystemSurface.svelte');
  assert.match(surface, /const builtIn = \['role:admin', 'role:user'\]/);
  assert.match(surface, /if \(role === 'role:admin'\) return 'Administrator'/);
  assert.match(surface, /if \(role === 'role:user'\) return 'Standard user'/);
  assert.match(surface, /declaredRoles = permissions\.declaredGroups \|\| \[\]/);
  assert.match(surface, /`declared:\$\{item\.packageName\}:\$\{item\.id\}`/);
  assert.match(surface, /filter\(\(item\) => !item\.declaredPackage \|\| !item\.declaredGroup\)/);
  assert.match(surface, /rule\.group \|\| rule\.groupId/);
});
