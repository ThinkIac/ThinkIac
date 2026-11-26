const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { bootstrap } = require('../vendor/packages/logos/dist/src/index.js');

(async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'logos-empty-'));
  try {
    const runtime = await bootstrap({ workspace, externalModules: [], modules: [] });
    assert.equal(runtime.app, null);
    assert.equal(runtime.server, null);
    await runtime.close();
    console.log('Independent kernel boot and close passed.');
  } finally { await fs.rm(workspace, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
