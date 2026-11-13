const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _test } = require('./index.js');

test('explorer ordering is deterministic and keeps directories before files', () => {
  const entries = [
    { type: 'file', name: 'a.js' },
    { type: 'directory', name: 'zeta' },
    { type: 'directory', name: 'alpha' },
    { type: 'file', name: 'package10.json' },
    { type: 'file', name: 'package2.json' },
  ].sort(_test.compareEntries);
  assert.deepEqual(entries.map(entry => entry.name), ['alpha', 'zeta', 'a.js', 'package2.json', 'package10.json']);
});

test('file paths cannot escape a package', () => {
  assert.equal(_test.safeFilePath('views/Index.svelte'), 'views/Index.svelte');
  assert.equal(_test.safeFilePath('views\\Index.svelte'), 'views/Index.svelte');
  for (const value of ['../index.js', '/etc/passwd', '.', '', 'a/../../b']) {
    assert.throws(() => _test.safeFilePath(value), /Invalid path/);
  }
});

test('package identifiers cannot contain path separators', () => {
  assert.equal(_test.safePackageId('code-editor'), 'code-editor');
  assert.throws(() => _test.safePackageId('../agent'), /Invalid package/);
});

test('the explorer lists every extension the file-manager opener is registered for', () => {
  // These two used to be separate literals, so file-manager offered "Open in
  // Code Editor" for files the explorer then refused to list.
  for (const ext of _test.EDITABLE_EXTS) {
    assert.ok(_test.isEditable(`file${ext}`), `opener registers ${ext} but explorer hides it`);
  }
});

test('editable detection covers well-known extensionless files and rejects binaries', () => {
  assert.ok(_test.isEditable('Dockerfile'));
  assert.ok(_test.isEditable('LICENSE'));
  assert.ok(_test.isEditable('.gitignore'));
  assert.ok(_test.isEditable('Index.SVELTE'), 'extension match must be case-insensitive');
  for (const name of ['icon.png', 'blob.bin', 'archive.tar.gz', 'noextension']) {
    assert.equal(_test.isEditable(name), false, `${name} should not be editable`);
  }
});

test('editor keeps the selection when its own input is echoed back by the parent', () => {
  const source = fs.readFileSync(path.join(__dirname, 'views', 'Editor.svelte'), 'utf8');
  assert.match(source, /cm\.docOf\(view\) !== \(value \?\? ''\)/);
  assert.doesNotMatch(source, /lastEmitted/);
});
