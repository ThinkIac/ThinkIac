const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { registerRoutes, scanCache } = require('../dist/src/kernel/scan.js');

test('compiled scanner discovers a stream added to an already loaded ES module', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'logos-esm-reload-'));
  const stream = name => `export function ${name}() { /** @register_router ${name}\n * @stream\n * @channel scriba:${name}\n */ return '${name}'; }\n`;
  try {
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
    const file = path.join(directory, 'routes.js');
    fs.writeFileSync(file, stream('state'));
    assert.deepEqual((await registerRoutes(directory)).map(r => r.channel), ['scriba:state']);
    fs.writeFileSync(file, stream('state') + stream('layout'));
    scanCache.invalidatePrefix(directory);
    const routes = await registerRoutes(directory);
    assert.deepEqual(routes.map(r => r.channel).sort(), ['scriba:layout', 'scriba:state']);
    assert.equal(routes.find(r => r.channel === 'scriba:layout').handler(), 'layout');
  } finally {
    scanCache.invalidatePrefix(directory);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('compiled scanner preserves the real ESM import failure', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'logos-esm-error-'));
  const file = path.join(directory, 'routes.js');
  const warnings = [];
  const warn = console.warn;
  try {
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
    fs.writeFileSync(file, "// @register_router broken\nimport './missing.js';\nexport function broken() {}\n");
    console.warn = message => warnings.push(String(message));
    assert.deepEqual(await registerRoutes(directory), []);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /missing\.js/);
    assert.doesNotMatch(warnings[0], /require\(\) of ES Module/);
  } finally {
    console.warn = warn;
    scanCache.invalidatePrefix(directory);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
