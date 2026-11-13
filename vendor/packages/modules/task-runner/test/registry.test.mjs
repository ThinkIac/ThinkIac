import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../cli.cjs', import.meta.url));
const npmrc = fs.readFileSync(new URL('../../../../.npmrc', import.meta.url), 'utf8');

test('real npm inherits public and scoped registries through task execution', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'logos-registry-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'packages/a'), { recursive: true });
  fs.writeFileSync(path.join(root, '.npmrc'), npmrc);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ private: true, workspaces: ['packages/*'] }));
  fs.writeFileSync(path.join(root, 'logos.tasks.json'), JSON.stringify({ version: 1, registry: 'https://legacy.example.org', tasks: { check: { cache: false } } }));
  fs.writeFileSync(path.join(root, 'packages/a/package.json'), JSON.stringify({ name: 'a', scripts: { check: 'node check.mjs' } }));
  fs.writeFileSync(path.join(root, 'packages/a/check.mjs'), `
    import { execFileSync } from 'node:child_process';
    import fs from 'node:fs';
    const values = ['registry', '@thinkiac:registry'].map(key => execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['config', 'get', key], { cwd: '../..', encoding: 'utf8' }).trim());
    fs.writeFileSync('result.json', JSON.stringify(values));
  `);
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^npm_config_/i.test(key)) delete env[key];
  env.NPM_CONFIG_USERCONFIG = path.join(root, 'empty-user.npmrc');
  fs.writeFileSync(env.NPM_CONFIG_USERCONFIG, '');
  const invoke = () => spawnSync(process.execPath, [cli, 'run', 'check', '--root', root], { env, encoding: 'utf8' });
  let result = invoke();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const read = () => JSON.parse(fs.readFileSync(path.join(root, 'packages/a/result.json')));
  assert.deepEqual(read(), ['https://registry.npmjs.org/', 'https://npm.thinkiac.cloud/']);
  env.npm_config_registry = 'https://custom.example.org/';
  result = invoke();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(read(), ['https://custom.example.org/', 'https://npm.thinkiac.cloud/']);
});
