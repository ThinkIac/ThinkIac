import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createDisabledHistory } from '../lib/disabled-history.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'thinkiac-disabled-history-'));
  const disabledDir = join(root, '.disabled-packages');
  let sequence = 0;
  const history = createDisabledHistory({ disabledDir, now: () => '2026-09-03T18:00:00.000Z', id: () => `id${++sequence}` });
  const source = (version, text = version) => {
    const path = join(root, `source-${sequence}`);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'package.json'), JSON.stringify({ name: 'demo', version }));
    writeFileSync(join(path, 'index.js'), text);
    return path;
  };
  return { root, disabledDir, history, source, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('archives multiple disabled versions and marks duplicate-version content as a conflict', () => {
  const f = fixture();
  try {
    assert.equal(f.history.archive('demo', f.source('1.0.0')).entry.folder, '1.0.0');
    const conflict = f.history.archive('demo', f.source('1.0.0', 'changed'));
    assert.match(conflict.entry.folder, /^1\.0\.0--conflict-id/);
    assert.equal(conflict.entry.conflict, true);
    assert.deepEqual(f.history.list('demo').map(entry => entry.version), ['1.0.0', '1.0.0']);
  } finally { f.cleanup(); }
});

test('preserves an identical duplicate as an explicit archive entry instead of deleting it', () => {
  const f = fixture();
  try {
    f.history.archive('demo', f.source('1.0.0', 'same'));
    const duplicateSource = f.source('1.0.0', 'same');
    const result = f.history.archive('demo', duplicateSource);
    assert.match(result.entry.folder, /^1\.0\.0--duplicate-id/);
    assert.equal(result.entry.duplicateOf, '1.0.0');
    assert.equal(existsSync(duplicateSource), false);
    assert.equal(existsSync(join(f.disabledDir, 'demo', result.entry.folder, 'package.json')), true);
  } finally { f.cleanup(); }
});

test('migrates the legacy disabled slot into version history without losing it', () => {
  const f = fixture();
  try {
    const old = f.source('2.0.0');
    mkdirSync(f.disabledDir, { recursive: true });
    renameSync(old, join(f.disabledDir, 'demo'));
    const entries = f.history.list('demo');
    assert.equal(entries[0].version, '2.0.0');
    assert.equal(entries[0].legacy, true);
    assert.equal(existsSync(join(f.disabledDir, 'demo', '2.0.0', 'package.json')), true);
  } finally { f.cleanup(); }
});

test('requires a version when restoring from a multi-version history and preserves state', () => {
  const f = fixture();
  try {
    f.history.archive('demo', f.source('1.0.0'));
    f.history.archive('demo', f.source('2.0.0'));
    assert.throws(() => f.history.restore('demo', undefined, join(f.root, 'active-demo')), /multiple disabled versions/);
    const picked = f.history.restore('demo', '2.0.0', join(f.root, 'active-demo'));
    assert.equal(picked.version, '2.0.0');
    assert.equal(existsSync(join(f.root, 'active-demo')), true);
    assert.deepEqual(f.history.list('demo').map(entry => entry.version), ['1.0.0']);
    assert.match(readFileSync(join(f.disabledDir, 'demo', 'state.json'), 'utf8'), /1.0.0/);
  } finally { f.cleanup(); }
});

test('never replaces an active package while restoring an archived version', () => {
  const f = fixture();
  try {
    f.history.archive('demo', f.source('1.0.0'));
    const active = f.source('9.0.0');
    assert.throws(() => f.history.restore('demo', '1.0.0', active), /already exists/);
    assert.equal(f.history.list('demo').length, 1);
    assert.equal(JSON.parse(readFileSync(join(active, 'package.json'), 'utf8')).version, '9.0.0');
  } finally { f.cleanup(); }
});
