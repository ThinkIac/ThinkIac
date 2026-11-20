import assert from 'node:assert/strict';
import test from 'node:test';
import { downloadGitHubPackage, parseGitHubPackage } from '../lib/github-package.js';

test('resolves short and explicit GitHub package identifiers', () => {
  assert.deepEqual(parseGitHubPackage('calendar'), { owner: 'ThinkIac', name: 'calendar' });
  assert.deepEqual(parseGitHubPackage('git:another/calendar'), { owner: 'another', name: 'calendar' });
  assert.throws(() => parseGitHubPackage('git:owner/../calendar'), /Use a package name/);
});

test('downloads the Engineer release asset through a GitHub redirect', async () => {
  const urls = [];
  const archive = await downloadGitHubPackage('calendar', async (url, options) => {
    urls.push(String(url));
    if (urls.length === 1) {
      return Response.json({ tag_name: 'v1.0.0', assets: [{ name: 'package-v1.0.0.zip', state: 'uploaded' }] });
    }
    assert.equal(options.redirect, 'manual');
    if (urls.length === 2) return Response.redirect('https://release-assets.githubusercontent.com/download');
    return new Response('archive');
  });
  assert.deepEqual(urls, [
    'https://api.github.com/repos/ThinkIac/calendar/releases/latest',
    'https://github.com/ThinkIac/calendar/releases/download/v1.0.0/package-v1.0.0.zip',
    'https://release-assets.githubusercontent.com/download',
  ]);
  assert.equal(archive.buffer.toString(), 'archive');
  assert.equal(archive.origin, 'ThinkIac/calendar (release v1.0.0)');
});

test('downloads the default branch when no release is available', async () => {
  const archive = await downloadGitHubPackage('calendar', async url => {
    if (typeof url === 'string') return new Response(null, { status: 404 });
    assert.equal(String(url), 'https://codeload.github.com/ThinkIac/calendar/zip/HEAD');
    return new Response('archive');
  });
  assert.equal(archive.origin, 'ThinkIac/calendar (default branch)');
});

test('rejects a non-GitHub redirect before requesting its destination', async () => {
  let requests = 0;
  await assert.rejects(downloadGitHubPackage('calendar', async () => {
    requests += 1;
    if (requests === 1) return new Response(null, { status: 404 });
    return Response.redirect('https://github.com.example.org/download');
  }), /unsupported destination/);
  assert.equal(requests, 2);
});

test('rejects a release without the Engineer asset and API errors', async () => {
  await assert.rejects(downloadGitHubPackage('calendar', async () =>
    Response.json({ tag_name: 'v1.0.0', assets: [] })), /no Engineer package ZIP/);
  await assert.rejects(downloadGitHubPackage('calendar', async () =>
    new Response(null, { status: 403 })), /HTTP 403/);
});
