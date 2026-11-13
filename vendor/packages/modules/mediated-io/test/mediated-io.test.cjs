'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PackageFiles, PackageNetwork, PackageProcess, PackageSecrets } = require('..');
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediated-io-')); fs.mkdirSync(path.join(root, 'data')); fs.writeFileSync(path.join(root, 'data', 'inside.txt'), 'inside');
  const checks = []; const resources = []; const grants = { files: [{ root: 'data', access: 'read-write' }], secrets: ['TOKEN'], network: [], process: [{ executable: process.execPath, args: ['-e', '*'], cwd: ['data'], env: ['SAFE'] }] };
  return { root, checks, resources, host: { packageRoot: () => root, grantsFor: () => grants, activeScope: () => ({ defer: (fn, item) => resources.push({ fn, item }) }), trackProcess: (scope, child, label) => scope.defer(() => child.kill('SIGTERM'), { kind: 'child-process', label, pid: child.pid }), resolveSecret: () => 'hidden-value', enforce: (owner, surface, operation, resource, metadata) => { checks.push({ owner, surface, operation, resource, metadata }); if (surface === 'network' && resource !== 'https://allowed.example') { const error = new Error('denied'); error.code = 'AUTHORITY_DENIED'; throw error; } } }, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
test('confines package files after resolving traversal and symlinks', async t => {
  const f = fixture(); t.after(f.cleanup); const files = new PackageFiles(f.host, 'pilot'); const outside = path.join(f.root, 'outside.txt'); fs.writeFileSync(outside, 'outside'); fs.symlinkSync(outside, path.join(f.root, 'data', 'escape.txt'));
  assert.equal(await files.readFile('data/inside.txt', 'utf8'), 'inside'); await assert.rejects(files.readFile('../outside.txt'), { code: 'RESOURCE_BOUNDARY_DENIED' }); await assert.rejects(files.writeFile('data/escape.txt', 'changed'), { code: 'RESOURCE_BOUNDARY_DENIED' }); assert.equal(fs.readFileSync(outside, 'utf8'), 'outside');
});
test('keeps secret values opaque and reauthorizes redirects', async t => {
  const f = fixture(); t.after(f.cleanup); const secret = new PackageSecrets(f.host, 'pilot').get('TOKEN'); assert.equal(String(secret), '[REDACTED]'); assert.equal(JSON.stringify(secret), '"[REDACTED]"'); assert.equal(await secret.withValue(value => value.length), 12);
  f.host.fetch = async () => new Response(null, { status: 302, headers: { location: 'https://blocked.example/final' } }); await assert.rejects(new PackageNetwork(f.host, 'pilot').fetch('https://allowed.example/start'), { code: 'AUTHORITY_DENIED' }); assert.deepEqual(f.checks.filter(check => check.surface === 'network').map(check => check.resource), ['https://allowed.example', 'https://blocked.example']);
});
test('permits only declared process shape and registers lifecycle cleanup', async t => {
  const f = fixture(); t.after(f.cleanup); const proc = new PackageProcess(f.host, 'pilot'); const child = proc.spawn(process.execPath, ['-e', 'process.stdout.write(process.env.SAFE)'], { cwd: 'data', env: { SAFE: 'ok' }, stdio: ['ignore', 'pipe', 'ignore'] }); let output = ''; child.stdout.on('data', chunk => { output += chunk; }); await new Promise((resolve, reject) => child.once('close', code => code === 0 ? resolve() : reject(new Error(String(code))))); assert.equal(output, 'ok'); assert.equal(f.resources[0].item.kind, 'child-process'); assert.throws(() => proc.spawn(process.execPath, ['--version'], { cwd: 'data' }), { code: 'PROCESS_BOUNDARY_DENIED' }); assert.throws(() => proc.spawn(process.execPath, ['-e', '0'], { cwd: 'data', shell: true }), { code: 'PROCESS_BOUNDARY_DENIED' });
});
