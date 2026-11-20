import test from 'node:test';
import assert from 'node:assert/strict';
import { listGitHubBranches, parsePackageIdentifier, resolvePackageSource } from '../lib/package-source.js';

const json = (body, status = 200) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

test('parses every supported package identifier into a normalized provider source', () => {
  assert.deepEqual(parsePackageIdentifier('calendar'), { provider: 'git', host: 'github.com', owner: 'ThinkIac', package: 'calendar', selfHosted: false });
  assert.deepEqual(parsePackageIdentifier('git:ada/calendar'), { provider: 'git', host: 'github.com', owner: 'ada', package: 'calendar', selfHosted: false });
  assert.deepEqual(parsePackageIdentifier('npm:ada/calendar'), { provider: 'npm', host: 'registry.npmjs.org', owner: 'ada', package: 'calendar', selfHosted: false });
  assert.deepEqual(parsePackageIdentifier('git@gitea.local:ada/calendar'), { provider: 'git', host: 'gitea.local', owner: 'ada', package: 'calendar', selfHosted: true });
  assert.deepEqual(parsePackageIdentifier('npm@[::1]:ada/calendar'), { provider: 'npm', host: '[::1]', owner: 'ada', package: 'calendar', selfHosted: true });
});

test('prefers the ZIP emitted by Engineer CI when GitHub has a compatible release', async () => {
  const source = await resolvePackageSource('git:ada/calendar', { fetchFn: async () => json({ tag_name: 'v1.2.0', assets: [{ name: 'package-v1.2.0.zip', browser_download_url: 'https://github.com/ada/calendar/releases/download/v1.2.0/package-v1.2.0.zip' }] }) });
  assert.equal(source.kind, 'release-zip');
  assert.equal(source.release.tag, 'v1.2.0');
});

test('falls back to the default branch when no compatible GitHub release exists', async () => {
  const calls = [];
  const source = await resolvePackageSource('git:ada/calendar', { fetchFn: async url => {
    calls.push(url);
    return url.endsWith('/releases/latest') ? json({}, 404) : json({ default_branch: 'develop' });
  } });
  assert.equal(source.kind, 'git');
  assert.equal(source.branch, 'develop');
  assert.equal(calls.length, 2);
});

test('an explicit branch bypasses release selection', async () => {
  const source = await resolvePackageSource('calendar', { branch: 'next', fetchFn: async () => json({ default_branch: 'main' }) });
  assert.equal(source.kind, 'git');
  assert.equal(source.branch, 'next');
});

test('lists GitHub branches so callers can install a branch when no release is available', async () => {
  const branches = await listGitHubBranches('calendar', { fetchFn: async () => json([{ name: 'main' }, { name: 'feature/pkg' }, { name: '../unsafe' }]) });
  assert.deepEqual(branches, ['main', 'feature/pkg']);
});
