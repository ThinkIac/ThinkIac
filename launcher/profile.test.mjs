import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { installProfile, parseSource, inside, validateProfile } from './profile.mjs';

const sha = 'a'.repeat(40);
async function fixture(t, dependencies = { sample: 'ThinkIac/sample#main' }) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'thinkiac-profile-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  for (const dir of ['lib', 'public', 'launcher', 'vendor/packages/logos/dist']) await fs.mkdir(path.join(base, dir), { recursive: true });
  for (const file of ['launcher/runtime.js', 'launcher/profile.mjs', 'logos.supervisor.json']) await fs.writeFile(path.join(base, file), '{}');
  await fs.writeFile(path.join(base, 'vendor/packages/logos/package.json'), JSON.stringify({ name: 'logos', version: '2.0.0' }));
  const profile = { version: 1, name: 'test', dependencies };
  const profileFile = path.join(base, 'test.json');
  await fs.writeFile(profileFile, JSON.stringify(profile));
  const lock = { version: 1, dependencies: Object.fromEntries(Object.entries(dependencies).map(([name, source]) => [name, { source, commit: sha }])) };
  await fs.writeFile(path.join(base, 'test.lock.json'), JSON.stringify(lock));
  const options = { base, profileFile, installNpm: false, fetchPackage: async ({ destination }) => {
    await fs.mkdir(destination, { recursive: true });
    await fs.writeFile(path.join(destination, 'package.json'), JSON.stringify({ name: path.basename(destination), version: '1.0.0', dependencies: { logos: 'file:../logos' } }));
    return sha;
  } };
  return { base, profile, profileFile, lock, options };
}

test('branch, release tag, commit and github prefix', () => {
  for (const ref of ['main', '1.0.0', 'v1.0.0', 'feature/profiles', sha]) assert.equal(parseSource(`ThinkIac/sample#${ref}`).revision, ref);
  assert.equal(parseSource('github:ThinkIac/sample#main').repository, 'ThinkIac/sample');
});
test('reject ambiguous references and paths outside installation', () => {
  for (const ref of ['ThinkIac/sample', 'https://user:secret@github.com/a/b#main', 'a/b#--upload-pack=x', 'a/b#main..x']) assert.throws(() => parseSource(ref));
  for (const file of ['../escape', '/tmp/escape', 'a\\b']) assert.throws(() => inside('/root/install', file));
});
test('missing lock, changed source, overlapping paths and reserved kernel fail before fetching', async t => {
  const { profile, lock } = await fixture(t);
  assert.throws(() => validateProfile(profile, null), /Lock/);
  assert.throws(() => validateProfile({ ...profile, dependencies: { sample: 'ThinkIac/sample#1.0.0' } }, lock), /Lock/);
  assert.throws(() => validateProfile({ ...profile, dependencies: { logos: 'ThinkIac/logos#main' } }, null, true), /reservada/);
  assert.throws(() => validateProfile({ ...profile, dependencies: { one: 'A/one#main', two: 'A/two#main' }, paths: { one: 'packages/x', two: 'packages/x' } }, null, true), /sobrepostos/);
});
test('installation uses locked commit, links durable state and rewrites sibling dependencies', async t => {
  const { options } = await fixture(t);
  const fetch = options.fetchPackage;
  options.fetchPackage = async input => { assert.equal(input.commit, sha); return fetch(input); };
  const result = await installProfile(options);
  const manifest = JSON.parse(await fs.readFile(path.join(result.directory, 'packages/sample/package.json')));
  assert.equal(manifest.dependencies.logos, '*');
  assert.equal((await fs.lstat(path.join(result.directory, 'packages/sample/.private'))).isSymbolicLink(), true);
  assert.equal(JSON.parse(await fs.readFile(path.join(result.directory, 'profile.lock.json'))).dependencies.sample.commit, sha);
});
test('unchanged launch reuses installation without fetching', async t => {
  const { options } = await fixture(t);
  const first = await installProfile(options);
  const second = await installProfile({ ...options, fetchPackage: () => { throw new Error('must not fetch'); } });
  assert.equal(first.directory, second.directory);
});
test('failed update keeps previous selection, lock and private data', async t => {
  const { options, base, lock } = await fixture(t);
  const first = await installProfile(options);
  await fs.writeFile(path.join(first.directory, 'packages/sample/.private/keep'), 'private state');
  await assert.rejects(installProfile({ ...options, update: true, fetchPackage: () => { throw new Error('download failed'); } }), /download failed/);
  const current = JSON.parse(await fs.readFile(path.join(base, '.thinkiac/test/current.json')));
  assert.equal(current.directory, first.directory);
  assert.equal(await fs.readFile(path.join(first.directory, 'packages/sample/.private/keep'), 'utf8'), 'private state');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(base, 'test.lock.json'))), lock);
});
test('successful update pins new commit, reuses state and is cached on next launch', async t => {
  const { options } = await fixture(t);
  const first = await installProfile(options);
  await fs.writeFile(path.join(first.directory, 'packages/sample/.private/keep'), 'private state');
  const fetch = options.fetchPackage;
  const next = await installProfile({ ...options, update: true, fetchPackage: async input => { assert.equal(input.commit, null); await fetch(input); return 'b'.repeat(40); } });
  assert.notEqual(first.directory, next.directory);
  assert.equal(await fs.readFile(path.join(next.directory, 'packages/sample/.private/keep'), 'utf8'), 'private state');
  const cached = await installProfile({ ...options, fetchPackage: () => { throw new Error('must not fetch'); } });
  assert.equal(cached.directory, next.directory);
});
test('missing local dependency and mismatching identity prevent publication', async t => {
  const { options } = await fixture(t);
  await assert.rejects(installProfile({ ...options, fetchPackage: async ({ destination }) => {
    await fs.mkdir(destination, { recursive: true });
    await fs.writeFile(path.join(destination, 'package.json'), JSON.stringify({ name: 'wrong' })); return sha;
  } }), /difere/);
  await assert.rejects(installProfile({ ...options, fetchPackage: async ({ destination }) => {
    await fs.mkdir(destination, { recursive: true });
    await fs.writeFile(path.join(destination, 'package.json'), JSON.stringify({ name: 'sample', dependencies: { missing: 'file:../missing' } })); return sha;
  } }), /não selecionada/);
});
test('concurrent installer cannot replace selection', async t => {
  const { options, base } = await fixture(t);
  await fs.mkdir(path.join(base, '.thinkiac/test'), { recursive: true });
  await fs.writeFile(path.join(base, '.thinkiac/test/install.lock'), '');
  await assert.rejects(installProfile(options), /concorrente/);
});
test('nested repository replaces the embedded package before manifest binding', async t => {
  const { options, profile, profileFile } = await fixture(t, { child: 'ThinkIac/child#main', parent: 'ThinkIac/parent#main' });
  profile.paths = { child: 'packages/parent/nested/child', parent: 'packages/parent' };
  await fs.writeFile(profileFile, JSON.stringify(profile));
  const calls = [];
  const result = await installProfile({ ...options, fetchPackage: async ({ source, destination }) => {
    const name = parseSource(source).repository.split('/')[1]; calls.push(name);
    await fs.mkdir(destination, { recursive: true });
    await fs.writeFile(path.join(destination, 'package.json'), JSON.stringify({ name, version: '1.0.0' }));
    if (name === 'parent') {
      await fs.mkdir(path.join(destination, 'nested/child'), { recursive: true });
      await fs.writeFile(path.join(destination, 'nested/child/package.json'), JSON.stringify({ name: 'child', version: '0.1.0' }));
    }
    return sha;
  } });
  assert.deepEqual(calls, ['parent', 'child']);
  assert.equal(JSON.parse(await fs.readFile(path.join(result.directory, 'packages/parent/nested/child/package.json'))).version, '1.0.0');
});
test('rebuilding the base invalidates the cached installation', async t => {
  const { options, base } = await fixture(t);
  const first = await installProfile(options);
  await fs.writeFile(path.join(base, 'vendor/packages/logos/dist/changed.js'), 'module.exports = 42;');
  const next = await installProfile(options);
  assert.notEqual(first.directory, next.directory);
});
test('npm build failure never publishes an incomplete installation', async t => {
  const { options, base } = await fixture(t);
  const first = await installProfile(options);
  const fetch = options.fetchPackage;
  await assert.rejects(installProfile({ ...options, update: true, installNpm: true, fetchPackage: async input => {
    await fetch(input);
    await fs.writeFile(path.join(input.destination, 'package.json'), JSON.stringify({ name: 'sample', version: '1.0.0', scripts: { prepare: 'node -e "process.exit(7)"' } }));
    return sha;
  } }), /código/);
  assert.equal(JSON.parse(await fs.readFile(path.join(base, '.thinkiac/test/current.json'))).directory, first.directory);
});
test('default profile includes all selected providers and apps, with no runtime code in base', async () => {
  const root = new URL('../', import.meta.url);
  const profile = JSON.parse(await fs.readFile(new URL('profiles/default.json', root)));
  const lock = JSON.parse(await fs.readFile(new URL('profiles/default.lock.json', root)));
  validateProfile(profile, lock);
  for (const name of ['agent', 'auth', 'shell', '@thinkiac/module-http', '@thinkiac/module-db', '@logos/supervisor']) assert.ok(profile.dependencies[name]);
});
