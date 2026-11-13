const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { _test } = require('./index.js');

// These run against the real filesystem, inside a scratch package created for
// the test and removed afterwards. The whole point of the feature is disk
// behaviour under a concurrent writer, so stubbing fs would test nothing.
const PKG = 'zz-write-safety-fixture';
const PKG_DIR = path.resolve(__dirname, '..', PKG);
const FILE = 'src/demo.js';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

test.before(() => {
    fs.mkdirSync(path.join(PKG_DIR, 'src'), { recursive: true });
});

test.after(() => {
    fs.rmSync(PKG_DIR, { recursive: true, force: true });
    // Drop the backups this fixture produced so the package's .backups/ stays clean.
    for (const name of fs.existsSync(_test.BACKUPS_DIR) ? fs.readdirSync(_test.BACKUPS_DIR) : []) {
        if (name.startsWith(`${PKG}_`)) fs.rmSync(path.join(_test.BACKUPS_DIR, name), { force: true });
    }
});

test('read reports the mtime that write checks against', async () => {
    fs.writeFileSync(path.join(PKG_DIR, FILE), 'const a = 1;\n');
    const read = await _test.handleReadFile(PKG, FILE);
    assert.equal(read.content, 'const a = 1;\n');
    assert.ok(Number.isFinite(read.mtime), 'read must expose an mtime');

    const write = await _test.handleWriteFile(PKG, FILE, 'const a = 2;\n', read.mtime);
    assert.equal(write.success, true);
    assert.equal(fs.readFileSync(path.join(PKG_DIR, FILE), 'utf8'), 'const a = 2;\n');
    assert.ok(write.mtime >= read.mtime, 'write must return the new mtime');
});

test('a write based on a stale mtime is refused with 409, leaving disk untouched', async () => {
    fs.writeFileSync(path.join(PKG_DIR, FILE), 'original\n');
    const read = await _test.handleReadFile(PKG, FILE);

    // Something else writes the file after we read it — this is the Agent case.
    await sleep(12);
    fs.writeFileSync(path.join(PKG_DIR, FILE), 'written by someone else\n');

    await assert.rejects(
        () => _test.handleWriteFile(PKG, FILE, 'my version\n', read.mtime),
        (err) => err.status === 409 && err.details.conflict === true,
    );
    assert.equal(
        fs.readFileSync(path.join(PKG_DIR, FILE), 'utf8'),
        'written by someone else\n',
        'a refused write must not touch the file',
    );
});

test('omitting baseMtime keeps the old last-write-wins behaviour', async () => {
    fs.writeFileSync(path.join(PKG_DIR, FILE), 'original\n');
    await sleep(12);
    fs.writeFileSync(path.join(PKG_DIR, FILE), 'changed\n');
    const write = await _test.handleWriteFile(PKG, FILE, 'forced\n', null);
    assert.equal(write.success, true);
    assert.equal(fs.readFileSync(path.join(PKG_DIR, FILE), 'utf8'), 'forced\n');
});

test('overwriting keeps the previous contents in .backups/', async () => {
    fs.writeFileSync(path.join(PKG_DIR, FILE), 'version one\n');
    const read = await _test.handleReadFile(PKG, FILE);
    const write = await _test.handleWriteFile(PKG, FILE, 'version two\n', read.mtime);

    assert.ok(write.backup, 'an overwrite must report the backup it made');
    const backup = fs.readFileSync(path.join(_test.BACKUPS_DIR, write.backup), 'utf8');
    assert.equal(backup, 'version one\n', 'the backup must hold the pre-write contents');
    assert.ok(write.backup.startsWith(_test.backupSlug(PKG, FILE)));
});

test('creating a new file reports no backup', async () => {
    const fresh = 'src/brand-new.js';
    const write = await _test.handleWriteFile(PKG, fresh, 'hello\n', null);
    assert.equal(write.backup, null);
    await _test.handleDelete(PKG, fresh);
});

test('binary files are refused rather than decoded into garbage', async () => {
    const png = 'src/blob.png';
    fs.writeFileSync(path.join(PKG_DIR, png), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03]));
    await assert.rejects(
        () => _test.handleReadFile(PKG, png),
        (err) => err.status === 415,
    );
});

test('looksBinary separates source text from blobs', () => {
    assert.equal(_test.looksBinary(Buffer.from('const a = 1;\n// olá, açúcar\n', 'utf8')), false);
    assert.equal(_test.looksBinary(Buffer.from('')), false);
    assert.equal(_test.looksBinary(Buffer.from([0x00, 0x41, 0x42])), true);
    assert.equal(_test.looksBinary(Buffer.from(Array.from({ length: 200 }, (_, i) => i % 8))), true);
});

test('reading a missing file is a 404 and a directory is a 400', async () => {
    await assert.rejects(() => _test.handleReadFile(PKG, 'src/nope.js'), (err) => err.status === 404);
    await assert.rejects(() => _test.handleReadFile(PKG, 'src'), (err) => err.status === 400);
});

test('delete removes files and directories, and refuses what is not there', async () => {
    fs.writeFileSync(path.join(PKG_DIR, 'src/tmp.js'), 'x');
    assert.equal((await _test.handleDelete(PKG, 'src/tmp.js')).type, 'file');
    assert.equal(fs.existsSync(path.join(PKG_DIR, 'src/tmp.js')), false);

    fs.mkdirSync(path.join(PKG_DIR, 'src/nested/deep'), { recursive: true });
    fs.writeFileSync(path.join(PKG_DIR, 'src/nested/deep/a.js'), 'x');
    assert.equal((await _test.handleDelete(PKG, 'src/nested')).type, 'directory');
    assert.equal(fs.existsSync(path.join(PKG_DIR, 'src/nested')), false);

    await assert.rejects(() => _test.handleDelete(PKG, 'src/gone.js'), /ENOENT/);
});

test('delete cannot escape the package root', async () => {
    for (const escape of ['../agent/index.js', '/etc/passwd', 'a/../../b']) {
        await assert.rejects(() => _test.handleDelete(PKG, escape), /Invalid path/);
    }
});
