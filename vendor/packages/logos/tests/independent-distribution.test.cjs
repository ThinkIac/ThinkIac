'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'logos-distribution-'));
try {
  const root = path.resolve(__dirname, '..');
  const packed = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary],
    { cwd: root, encoding: 'utf8' }));
  const project = path.join(temporary, 'project');
  const installed = path.join(project, 'node_modules', 'logos');
  fs.mkdirSync(installed, { recursive: true });
  execFileSync('tar', ['-xzf', path.join(temporary, packed[0].filename), '--strip-components=1', '-C', installed]);
  const metadata = JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8'));
  assert.deepEqual(metadata.dependencies, { coffeescript: 'github:ThinkIac/LogosType#main' });
  // Copy the already installed compiler; the packed smoke test remains offline.
  fs.cpSync(path.dirname(require.resolve('coffeescript/package.json')), path.join(project, 'node_modules', 'coffeescript'), { recursive: true });
  assert.deepEqual(metadata.optionalDependencies || {}, {});
  const source = `
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const path = require('node:path');
    const Module = require('node:module');
    const original = Module._load;
    Module._load = function (name, ...args) {
      if (!Module.isBuiltin(name) && !name.startsWith('.') && !path.isAbsolute(name) && name !== 'logos') {
        throw new Error('Unexpected runtime dependency: ' + name);
      }
      if (name.includes('/vendor/') || /[\\/]modules[\\/]/.test(name)) throw new Error('Unexpected capability import: ' + name);
      return original.call(this, name, ...args);
    };
    (async () => {
      const { bootstrap } = require('logos');
      const workspace = path.resolve('packages'); fs.mkdirSync(workspace);
      const empty = await bootstrap({ workspace });
      assert.equal(empty.app, null); assert.equal(empty.server, null);
      assert.equal(empty.stabilizer, null); assert.equal(empty.workers, null);
      assert.equal(empty.container.modules.size, 0);
      const packageContext = empty.container.packageContext('sample');
      assert.equal(typeof packageContext.events.publish, 'function');
      await empty.close();
      fs.mkdirSync(path.join(workspace, 'sample'));
      fs.writeFileSync(path.join(workspace, 'sample', 'package.json'), JSON.stringify({ name: 'sample' }));
      fs.writeFileSync(path.join(workspace, 'sample', 'actions.js'),
        'exports.double = function(value) { /** @register arithmetic double */ return value * 2; };');
      fs.mkdirSync(path.join(workspace, 'arithmetic'));
      fs.writeFileSync(path.join(workspace, 'arithmetic', 'package.json'), JSON.stringify({ main: 'index.cjs', runtime: { role: 'module' } }));
      fs.writeFileSync(path.join(workspace, 'arithmetic', 'index.cjs'),
        'exports.register = context => context.register({ name: "arithmetic", version: "1.0.0", phase: "wire",' +
        ' resources: { arithmetic: resource => context.state.set(resource.declaration.name, resource.handler) },' +
        ' install(ctx) { if (ctx.container || ctx.registry || ctx.http) throw new Error("Unrestricted context"); },' +
        ' close() { context.state.set("closed", true); } });');
      const runtime = await bootstrap({ workspace, externalModules: ['./arithmetic'] });
      const state = runtime.container.state('entrypoint:./arithmetic');
      assert.equal(await state.get('double')(21), 42);
      assert.equal(runtime.container.registry.getState('sample').state, 'active');
      assert.equal(runtime.stabilizer, null); assert.equal(runtime.workers, null);
      await runtime.close(); assert.equal(state.get('closed'), true);
      assert.equal(runtime.bus.listeners('logos:modules:register').length, 0);
      console.log('PASS: packed Logos, no capability dependencies, empty boot, native module, generic resource, shutdown');
      const declaredWorkspace = path.resolve('declarations');
      const provider = path.join(declaredWorkspace, 'deep', 'abc', 'provider');
      const consumer = path.join(declaredWorkspace, 'deep', 'consumer');
      fs.mkdirSync(provider, { recursive: true }); fs.mkdirSync(consumer, { recursive: true });
      fs.writeFileSync(path.join(provider, 'package.json'), JSON.stringify({ name: '@example/arithmetic' }));
      fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'consumer' }));
      fs.writeFileSync(path.join(provider, 'index.cjs'),
        'exports.lifecycle = function lifecycle(context) { /** @register module arithmetic */ return { close() { context.state.set("closed", true); } }; };' +
        'exports.accept = function accept(resource, context) { /** @register type arithmetic */ context.state.set(resource.declaration.name, resource.handler); };');
      fs.writeFileSync(path.join(consumer, 'index.cjs'),
        'exports.double = function double(value) { /** @register arithmetic double */ return value * 2; };');
      const declarative = await bootstrap({ workspace: declaredWorkspace, externalModules: [] });
      const declaredState = declarative.container.state('entrypoint:workspace:deep/abc/provider');
      assert.equal(await declaredState.get('double')(21), 42);
      assert.equal(declarative.container.registry.getState('deep/abc/provider').state, 'active');
      await declarative.close(); assert.equal(declaredState.get('closed'), true);
      console.log('PASS: packed declarative module/type, nested scoped package, no registration API or factory');
      Module._load = original;
      fs.unlinkSync(path.join(consumer, 'index.cjs'));
      fs.writeFileSync(path.join(consumer, 'index.type'),
        '###\\n# @register arithmetic double\\n#\\n###\\nexports.double = (value) -> value * 2\\n\\n###\\n# @register arithmetic crash\\n###\\nexports.crash = ->\\n  throw new Error \"typed failure\"\\n');
      const typed = await bootstrap({ workspace: declaredWorkspace, externalModules: [] });
      assert.equal(await typed.container.state('entrypoint:workspace:deep/abc/provider').get('double')(21), 42);
      assert.throws(() => typed.container.state('entrypoint:workspace:deep/abc/provider').get('crash')(), error => {
        assert.match(error.stack, /index\\.type:11:/);
        return true;
      });
      await typed.close();
      console.log('PASS: packed LogosType compiler, .type resource, original filename, no adjacent capability modules');

    })().catch(error => { console.error(error); process.exitCode = 1; });
  `;
  fs.writeFileSync(path.join(project, 'smoke.cjs'), source);
  process.stdout.write(execFileSync(process.execPath, ['--enable-source-maps', 'smoke.cjs'], {
    cwd: project, encoding: 'utf8', timeout: 15000, env: { ...process.env, NODE_PATH: '' },
  }));
  fs.writeFileSync(path.join(project, 'check-types.ts'), `
    import { bootstrap, type ModuleContext, type ModuleDeclaration, type CpuWorkerPool } from 'logos';
    const declaration: ModuleDeclaration = {
      name: 'typed-module', phase: 'wire', install(context: ModuleContext) {
        context.state.set('installed', true);
        // @ts-expect-error Native modules never receive the container.
        context.container;
      },
    };
    void declaration;
    void bootstrap({ externalModules: [], moduleConfig: {} });
    declare const pool: CpuWorkerPool;
    pool.snapshot();
  `);
  execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--noEmit', '--strict',
    '--module', 'commonjs', '--moduleResolution', 'node', '--target', 'ES2022', '--types', 'node',
    '--typeRoots', path.dirname(path.dirname(require.resolve('@types/node/package.json'))), 'check-types.ts'],
    { cwd: project, encoding: 'utf8', timeout: 15000 });
  process.stdout.write('PASS: packed public TypeScript declarations without sibling module types\n');
  // Then install an actual legacy capability and its SDK as independent npm
  // artifacts. No vendor sibling layout is available in this project.
  for (const folder of ['annotations', 'runtime-compat', 'workers']) {
    const packageRoot = path.resolve(root, '..', 'modules', folder);
    const artifact = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary],
      { cwd: packageRoot, encoding: 'utf8' }))[0];
    const destination = path.join(project, 'node_modules', '@thinkiac', `module-${folder}`);
    fs.mkdirSync(destination, { recursive: true });
    execFileSync('tar', ['-xzf', path.join(temporary, artifact.filename), '--strip-components=1', '-C', destination]);
  }
  fs.writeFileSync(path.join(project, 'selected-module.cjs'), `
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const path = require('node:path');
    (async () => {
      const workspace = path.resolve('worker-packages'); fs.mkdirSync(workspace);
      const runtime = await require('logos').bootstrap({ workspace,
        externalModules: ['@thinkiac/module-workers'], workers: { size: 1 } });
      try {
        assert.equal(runtime.app, null); assert.equal(runtime.stabilizer, null);
        assert.equal(runtime.container.modules.size, 1);
        assert.equal(runtime.workers.snapshot().size, 1);
      } finally { await runtime.close(); }
      console.log('PASS: independently packed worker module and compatibility SDK, selected boot and shutdown');
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `);
  process.stdout.write(execFileSync(process.execPath, ['selected-module.cjs'], {
    cwd: project, encoding: 'utf8', timeout: 15000, env: { ...process.env, NODE_PATH: '' },
  }));
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
