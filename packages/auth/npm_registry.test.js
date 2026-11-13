import test from 'node:test';
import assert from 'node:assert/strict';
import { canReadNpmPackage, normalizeNpmPackage, npmPublicCatalog, npmReadableCatalog, npmWorkspaceSummary, packageVisibility } from './npm_registry.js';

test('managed packages are private unless their owner explicitly opens them', () => {
  const privatePackage = { name: '@marina/agenda', owner: 'marina', visibility: 'private' };
  assert.equal(canReadNpmPackage(privatePackage, 'outra'), false);
  assert.equal(canReadNpmPackage(privatePackage, 'marina'), true);
  assert.equal(canReadNpmPackage({ ...privatePackage, visibility: 'public' }, null), true);
});

test('package registration accepts only an owner scoped name and an explicit visibility', () => {
  assert.deepEqual(normalizeNpmPackage({ name: '@Marina/Agenda', owner: 'marina', visibility: 'public' }), {
    name: '@marina/agenda', owner: 'marina', visibility: 'public',
  });
  assert.throws(() => normalizeNpmPackage({ name: '@outra/agenda', owner: 'marina' }), /workspace pessoal/);
  assert.deepEqual(normalizeNpmPackage({ name: 'pkgmgr', owner: 'admin', official: true }), {
    name: 'pkgmgr', owner: 'admin', visibility: 'public', official: true,
  });
  assert.equal(packageVisibility(undefined), 'private');
});

test('workspace summary returns only the signed-in owner packages and no credential', () => {
  assert.deepEqual(npmWorkspaceSummary({ username: 'Marina' }, [
    { name: '@marina/agenda', owner: 'marina', visibility: 'public', token: 'must-not-leak' },
    { name: '@other/private', owner: 'other', visibility: 'private' },
  ]), {
    authenticated: true,
    workspace: '@marina',
    packages: [{ name: '@marina/agenda', visibility: 'public' }],
  });
  assert.deepEqual(npmWorkspaceSummary(null), { authenticated: false, workspace: null, packages: [] });
});

test('public catalog excludes private workspace releases and never derives entries from npm cache', () => {
  assert.deepEqual(npmPublicCatalog([
    { name: '@marina/publico', visibility: 'public' },
    { name: '@marina/privado', visibility: 'private' },
    { name: 'pkgmgr', visibility: 'private', official: true },
  ]), [
    { name: '@marina/publico', official: false },
    { name: 'pkgmgr', official: true },
  ]);
});

test('signed-in catalog includes private releases only from its own workspace', () => {
  const records = [
    { name: '@marina/publico', owner: 'marina', visibility: 'public' },
    { name: '@marina/privado', owner: 'marina', visibility: 'private' },
    { name: '@other/privado', owner: 'other', visibility: 'private' },
  ];
  assert.deepEqual(npmReadableCatalog(records, 'marina'), [
    { name: '@marina/privado', official: false, owned: true, visibility: 'private' },
    { name: '@marina/publico', official: false, owned: true, visibility: 'public' },
  ]);
});

test('signed-in catalog marks ownership without exposing another public workspace', () => {
  assert.deepEqual(npmReadableCatalog([
    { name: '@marina/agenda', owner: 'marina', visibility: 'private' },
    { name: '@other/publico', owner: 'other', visibility: 'public' },
  ], 'marina'), [
    { name: '@marina/agenda', official: false, owned: true, visibility: 'private' },
    { name: '@other/publico', official: false, owned: false },
  ]);
});
