// tests/utils.test.ts — shared filesystem/string helpers.

import fs from 'fs';
import path from 'path';
import { describe, it, expect, afterEach } from 'vitest';
import {
  toEnvSegment, IGNORE_DIRS, resolveWorkspace, safeReadJson,
  ensureDir, copyDir, removeDirContents,
} from '../src/kernel/utils';
import { makeWorkspace } from './helpers';

describe('toEnvSegment', () => {
  it('uppercases and replaces every non-alphanumeric run with underscores', () => {
    expect(toEnvSegment('my-package')).toBe('MY_PACKAGE');
    expect(toEnvSegment('a.b c/d')).toBe('A_B_C_D');
    expect(toEnvSegment('already_ok9')).toBe('ALREADY_OK9');
  });

  it('coerces non-strings', () => {
    expect(toEnvSegment(42 as any)).toBe('42');
  });
});

describe('IGNORE_DIRS', () => {
  it('includes the runtime work directories and node_modules', () => {
    for (const d of [
      'node_modules', '.git', '.logos', 'dist', '.database',
      'data', 'uploads', 'profiles', 'secrets', 'generated',
      'backups', 'snapshots', 'sessions',
    ]) {
      expect(IGNORE_DIRS.has(d)).toBe(true);
    }
  });
});

describe('resolveWorkspace', () => {
  const prev = process.env.PACKAGES_PATH;
  afterEach(() => {
    if (prev === undefined) delete process.env.PACKAGES_PATH;
    else process.env.PACKAGES_PATH = prev;
  });

  it('resolves an explicit absolute path unchanged', () => {
    expect(resolveWorkspace('/abs/path')).toBe('/abs/path');
  });

  it('resolves an explicit relative path against cwd', () => {
    expect(resolveWorkspace('rel')).toBe(path.resolve(process.cwd(), 'rel'));
  });

  it('falls back to PACKAGES_PATH, then to <cwd>/packages', () => {
    process.env.PACKAGES_PATH = '/from/env';
    expect(resolveWorkspace()).toBe('/from/env');
    delete process.env.PACKAGES_PATH;
    expect(resolveWorkspace()).toBe(path.join(process.cwd(), 'packages'));
  });
});

describe('safeReadJson', () => {
  const ws = makeWorkspace();
  afterEach(() => {});

  it('parses valid JSON', () => {
    const dir = ws.pkg('a', { 'data.json': '{"x":1}' });
    expect(safeReadJson(path.join(dir, 'data.json'))).toEqual({ x: 1 });
    ws.cleanup();
  });

  it('returns null for missing files and malformed JSON', () => {
    const ws2 = makeWorkspace();
    const dir = ws2.pkg('a', { 'bad.json': '{not json' });
    expect(safeReadJson(path.join(dir, 'bad.json'))).toBeNull();
    expect(safeReadJson(path.join(dir, 'nope.json'))).toBeNull();
    ws2.cleanup();
  });
});

describe('ensureDir / copyDir / removeDirContents', () => {
  it('ensureDir is idempotent and recursive', () => {
    const ws = makeWorkspace();
    const nested = path.join(ws.root, 'x/y/z');
    ensureDir(nested);
    ensureDir(nested); // no throw second time
    expect(fs.existsSync(nested)).toBe(true);
    ws.cleanup();
  });

  it('copyDir copies the tree but skips ignored dirs', () => {
    const ws = makeWorkspace();
    ws.pkg('src', {
      'a.txt': 'A',
      'sub/b.txt': 'B',
      'node_modules/dep.js': 'nope',
      'profiles/default/go/pkg/mod/source.go': 'nope',
      'uploads/untrusted.js': 'nope',
    });
    const dest = path.join(ws.root, 'dest');
    copyDir(path.join(ws.root, 'src'), dest);
    expect(fs.readFileSync(path.join(dest, 'a.txt'), 'utf-8')).toBe('A');
    expect(fs.readFileSync(path.join(dest, 'sub/b.txt'), 'utf-8')).toBe('B');
    expect(fs.existsSync(path.join(dest, 'node_modules'))).toBe(false);
    expect(fs.existsSync(path.join(dest, 'profiles'))).toBe(false);
    expect(fs.existsSync(path.join(dest, 'uploads'))).toBe(false);
    ws.cleanup();
  });

  it('removeDirContents empties a dir but keeps skipped entries', () => {
    const ws = makeWorkspace();
    ws.pkg('p', {
      'keep-me/x.txt': 'x',
      'drop.txt': 'y',
      'node_modules/d.js': 'z',
      'data/session.json': '{}',
      'profiles/default/.profile': '',
    });
    const dir = path.join(ws.root, 'p');
    removeDirContents(dir); // default skip = IGNORE_DIRS
    expect(fs.existsSync(path.join(dir, 'drop.txt'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'keep-me'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'node_modules'))).toBe(true); // ignored → kept
    expect(fs.existsSync(path.join(dir, 'data'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'profiles'))).toBe(true);
    ws.cleanup();
  });

  it('removeDirContents on a missing dir is a no-op', () => {
    expect(() => removeDirContents('/does/not/exist/logos')).not.toThrow();
  });
});
