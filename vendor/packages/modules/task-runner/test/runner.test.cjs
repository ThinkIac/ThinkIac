const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { plan, run, registry, DEFAULT_REGISTRY, discover } = require('../index.cjs');

function fixture(t, packages, tasks = { build: { dependsOn: ['^build'], outputs: ['dist/**'], cache: true } }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'logos-tasks-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, content) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof content === 'string' ? content : JSON.stringify(content));
  };
  write('package.json', { name: 'fixture', private: true, workspaces: ['packages/*'] });
  write('logos.tasks.json', { version: 1, tasks });
  for (const [name, pkg] of Object.entries(packages)) {
    const { code, ...manifest } = pkg;
    write(`packages/${name}/package.json`, { name, scripts: { build: 'node build.cjs' }, ...manifest });
    write(`packages/${name}/build.cjs`, code || "const fs=require('fs'); fs.mkdirSync('dist',{recursive:true}); fs.writeFileSync('dist/out', 'built');");
  }
  return { root, write };
}
const silent = { log() {} };

test('transitive ordering crosses workspaces without scripts', async t => {
  const { root } = fixture(t, {
    a: { dependencies: { b: '*' }, code: "require('fs').accessSync('../c/dist/out');" },
    b: { dependencies: { c: '*' }, scripts: {} }, c: {}
  });
  const graph = plan(root, ['build'], { filters: ['a'] });
  assert.deepEqual([...graph.nodes.keys()], ['c#build', 'b#build', 'a#build']);
  const results = await run(graph, silent);
  assert.equal(results[1].status, 'virtual');
});

test('cycles and required missing scripts fail before executing', t => {
  const { root, write } = fixture(t, { a: { dependencies: { b: '*' } }, b: { dependencies: { a: '*' } } });
  assert.throws(() => plan(root, ['build']), /cycle/);
  write('logos.tasks.json', { version: 1, tasks: { build: { dependsOn: ['prepare'] }, prepare: {} } });
  assert.throws(() => plan(root, ['build']), /Missing required script/);
  write('logos.tasks.json', { version: 1, tasks: { build: { dependsOn: [{ task: 'prepare', optional: true }] }, prepare: {} } });
  assert.equal(plan(root, ['build']).nodes.size, 2);
});

test('explicit edges, package overrides, filters and invalid config', t => {
  const { root, write } = fixture(t, { a: {}, b: {} }, { build: {}, 'a#build': { dependsOn: ['b#build'] } });
  assert.deepEqual(plan(root, ['build'], { filters: ['packages/a'] }).nodes.get('a#build').dependencies, ['b#build']);
  assert.throws(() => plan(root, ['build'], { filters: ['missing'] }), /Unknown workspace filter/);
  assert.throws(() => plan(root, ['typo']), /Undefined task/);
  write('logos.tasks.json', { version: 1, tasks: { build: { inputs: ['**'] } } });
  assert.throws(() => plan(root, ['build']), /Unknown task field/);
  write('logos.tasks.json', { version: 1, tasks: { build: { outputs: ['../**'] } } });
  assert.throws(() => plan(root, ['build']), /Unsafe output/);
});

test('cache verifies outputs and invalidates source, lockfile and environment changes', async t => {
  const { root, write } = fixture(t, { a: {} }, { build: { cache: true, outputs: ['dist/**', '.next/**'] } });
  const execute = () => run(plan(root, ['build']), silent);
  assert.equal((await execute())[0].status, 'executed');
  assert.equal((await execute())[0].status, 'cached');
  write('packages/a/dist/out', 'tampered');
  assert.equal((await execute())[0].status, 'executed');
  fs.rmSync(path.join(root, 'packages/a/dist'), { recursive: true });
  assert.equal((await execute())[0].status, 'executed');
  write('packages/a/source.txt', 'new');
  assert.equal((await execute())[0].status, 'executed');
  write('package-lock.json', { lockfileVersion: 3 });
  assert.equal((await execute())[0].status, 'executed');
  process.env.LOGOS_TASK_TEST_VALUE = 'changed';
  try { assert.equal((await execute())[0].status, 'executed'); }
  finally { delete process.env.LOGOS_TASK_TEST_VALUE; }
});

test('changed dependency outputs invalidate dependent cache even with unchanged source', async t => {
  const { root } = fixture(t, {
    a: { dependencies: { b: '*' } },
    b: { code: "const fs=require('fs'); fs.mkdirSync('dist',{recursive:true}); fs.writeFileSync('dist/out', String(Math.random()));" }
  }, { build: { dependsOn: ['^build'], cache: true, outputs: ['dist/**'] }, 'b#build': { cache: false, outputs: ['dist/**'] } });
  await run(plan(root, ['build']), silent);
  assert.equal((await run(plan(root, ['build']), silent)).find(r => r.id === 'a#build').status, 'executed');
});

test('parallel work respects concurrency', async t => {
  const code = "const fs=require('fs'); fs.appendFileSync('../../events', 'start\\n'); setTimeout(()=>fs.appendFileSync('../../events','end\\n'), 150);";
  const { root } = fixture(t, { a: { code }, b: { code }, c: { code } }, { build: { cache: false } });
  await run(plan(root, ['build']), { ...silent, concurrency: 2 });
  let count = 0, peak = 0;
  for (const event of fs.readFileSync(path.join(root, 'events'), 'utf8').trim().split('\n')) {
    count += event === 'start' ? 1 : -1;
    peak = Math.max(peak, count);
  }
  assert.equal(count, 0);
  assert.equal(peak, 2);
});

test('failed prerequisites prevent downstream execution and cache receipts', async t => {
  const { root } = fixture(t, { a: { dependencies: { b: '*' } }, b: { code: 'process.exit(7)' } });
  await assert.rejects(run(plan(root, ['build']), silent), /b#build failed/);
  assert.equal(fs.existsSync(path.join(root, 'packages/a/dist')), false);
  assert.equal(fs.existsSync(path.join(root, '.logos-task-cache')), false);
});

test('persistent dependencies and insufficient concurrency are rejected', async t => {
  const { root } = fixture(t, { a: { dependencies: { b: '*' } }, b: {} }, { build: { dependsOn: ['^build'], persistent: true } });
  assert.throws(() => plan(root, ['build']), /Persistent task cannot/);
  const f = fixture(t, { a: {}, b: {} }, { build: { persistent: true } });
  await assert.rejects(run(plan(f.root, ['build']), { ...silent, concurrency: 1 }), /Increase concurrency/);
});

test('abort cancels a running process group', { skip: process.platform === 'win32' }, async t => {
  const { root } = fixture(t, { a: { code: "console.log('ready'); setInterval(()=>{}, 1000);" } }, { build: { persistent: true } });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    await assert.rejects(run(plan(root, ['build']), { signal: controller.signal, log(line) { if (line.includes('ready')) controller.abort(); } }), /cancelled/);
  } finally { clearTimeout(timer); }
});

test('already aborted runs launch nothing', async t => {
  const { root } = fixture(t, { a: {} });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(run(plan(root, ['build']), { ...silent, signal: controller.signal }), /cancelled/);
  assert.equal(fs.existsSync(path.join(root, 'packages/a/dist')), false);
});

test('registry validation defaults to public npm and rejects embedded credentials', async t => {
  assert.equal(registry(), DEFAULT_REGISTRY);
  assert.equal(registry('https://example.org/'), 'https://example.org');
  assert.throws(() => registry('https://user:secret@example.org'), /credentials/);
  const { root } = fixture(t, { a: { code: `if(process.env.npm_config_registry !== ${JSON.stringify(process.env.npm_config_registry)}) process.exit(8);` } });
  await run(plan(root, ['build']), silent);
});

test('CLI dry-run has no script side effects, malformed options fail', t => {
  const { root } = fixture(t, { a: {} });
  const cli = path.resolve(__dirname, '../cli.cjs');
  const result = spawnSync(process.execPath, [cli, 'run', 'build', '--root', root, '--dry-run'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).tasks[0].id, 'a#build');
  assert.equal(fs.existsSync(path.join(root, 'packages/a/dist')), false);
  assert.equal(spawnSync(process.execPath, [cli, 'run', 'build', '--root'], { encoding: 'utf8' }).status, 1);
});

test('workspace discovery rejects duplicate names and unsupported patterns', t => {
  const { root, write } = fixture(t, { a: {}, b: { name: 'a' } });
  assert.throws(() => discover(root), /Duplicate workspace/);
  write('package.json', { workspaces: ['packages/**'] });
  assert.throws(() => discover(root), /Unsupported workspace pattern/);
});

test('install delegates explicit registry and ci without network access', { skip: process.platform === 'win32' }, t => {
  const { root, write } = fixture(t, { a: {} });
  write('bin/npm', '#!/usr/bin/env node\nrequire("fs").writeFileSync("install-args.json", JSON.stringify({ argv: process.argv.slice(2), registry: process.env.npm_config_registry }));');
  fs.chmodSync(path.join(root, 'bin/npm'), 0o755);
  const cli = path.resolve(__dirname, '../cli.cjs');
  const invoke = args => spawnSync(process.execPath, [cli, 'install', '--root', root, ...args], {
    env: { ...process.env, PATH: path.join(root, 'bin') + path.delimiter + process.env.PATH, npm_config_registry: 'https://registry.npmjs.org' }, encoding: 'utf8'
  });
  const result = invoke([]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'install-args.json'))), { argv: ['install'], registry: 'https://registry.npmjs.org' });
  assert.equal(invoke(['--ci']).status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'install-args.json'))).argv, ['ci']);
  write('logos.tasks.json', { version: 1, registry: 'https://legacy.example.org', tasks: {} });
  assert.equal(invoke([]).status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'install-args.json'))).argv, ['install', '--registry', 'https://legacy.example.org']);
  assert.equal(invoke(['--ci', '--registry', 'https://registry.example.org']).status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'install-args.json'))).argv, ['ci', '--registry', 'https://registry.example.org']);
});

test('failure cancels an independent persistent sibling', { skip: process.platform === 'win32' }, async t => {
  const { root } = fixture(t, {
    a: { code: "setTimeout(()=>process.exit(4), 100);" },
    b: { code: "setInterval(()=>{}, 1000);" }
  }, { build: { cache: false }, 'b#build': { persistent: true } });
  await assert.rejects(run(plan(root, ['build']), { ...silent, concurrency: 2 }), /a#build failed/);
});

test('cache scan limits fall back to execution', async t => {
  const { root, write } = fixture(t, { a: {} });
  write('large-input', '');
  fs.truncateSync(path.join(root, 'large-input'), 65 * 1024 * 1024);
  const logs = [];
  const result = await run(plan(root, ['build']), { log: line => logs.push(line) });
  assert.equal(result[0].status, 'executed');
  assert.ok(logs.some(line => line.includes('cache disabled') && line.includes('scan budget')));
});
