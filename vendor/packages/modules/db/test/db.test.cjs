'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDatabase } = require('..');

function host(root, authority = {}) { return { applicationRoot: () => root, dataDir: () => process.env.TEST_DB_DATA_DIR, composeSchema: () => null, appendLog() {}, currentAuthority: () => authority, createVault: () => ({}), openPrivateDatabase() {}, log() {} }; }
test('keeps the legacy package path and uses the configured durable data directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'module-db-')); const db = createDatabase(host(root));
  try { assert.equal(db.resolveDatabasePath('pkg', '/work/pkg'), '/work/pkg/.database'); process.env.TEST_DB_DATA_DIR = root; assert.equal(db.resolveDatabasePath('pkg', '/work/pkg'), path.join(root, 'db', 'pkg', '.database')); assert.ok(fs.existsSync(path.join(root, 'db', 'pkg'))); } finally { delete process.env.TEST_DB_DATA_DIR; fs.rmSync(root, { recursive: true, force: true }); }
});
test('enforces database authority before exposing an entity proxy', () => {
  let call; const db = createDatabase(host(process.cwd(), { principal: 'p', access: { enforce: value => { call = value; throw new Error('DENIED'); } } }));
  assert.throws(() => db.getProxy('other'), /DENIED/); assert.deepEqual(call, { principal: 'p', surface: 'database', operation: 'access', resource: 'other' });
});
