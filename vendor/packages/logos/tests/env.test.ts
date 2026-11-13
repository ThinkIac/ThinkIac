// tests/env.test.ts — .env parsing and per-package injection.

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
// The parser is supplied by the reusable module, not by Lógos.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { parseEnvFile, loadPackageEnv } = require('../../modules/env');
import { makeWorkspace, FixtureWorkspace } from './helpers';

describe('parseEnvFile', () => {
  it('reads simple KEY=value pairs', () => {
    expect(parseEnvFile('A=1\nB=two')).toEqual({ A: '1', B: 'two' });
  });

  it('skips blank lines and comments', () => {
    expect(parseEnvFile('# comment\n\nA=1\n   \nB=2')).toEqual({ A: '1', B: '2' });
  });

  it('strips inline comments from unquoted values', () => {
    expect(parseEnvFile('A=value   # trailing note')).toEqual({ A: 'value' });
  });

  it('preserves # inside double-quoted values and unescapes sequences', () => {
    expect(parseEnvFile('A="a#b\\nc"')).toEqual({ A: 'a#b\nc' });
  });

  it('keeps single-quoted values literal (no escaping)', () => {
    expect(parseEnvFile("A='a\\nb'")).toEqual({ A: 'a\\nb' });
  });

  it('supports multi-line double-quoted values', () => {
    expect(parseEnvFile('KEY="line1\nline2"')).toEqual({ KEY: 'line1\nline2' });
  });

  it('ignores malformed lines (no =, spaced key)', () => {
    expect(parseEnvFile('NOEQUALS\nbad key=1\nOK=2')).toEqual({ OK: '2' });
  });
});

describe('loadPackageEnv', () => {
  let ws: FixtureWorkspace;
  const touched: string[] = [];
  beforeEach(() => { ws = makeWorkspace(); });
  afterEach(() => {
    for (const k of touched) delete process.env[k];
    touched.length = 0;
    ws.cleanup();
  });

  it('returns {} when the package has no .env', () => {
    const dir = ws.pkg('noenv', { 'index.js': '' });
    expect(loadPackageEnv({ folder: 'noenv', dir })).toEqual({});
  });

  it('injects both the raw key and the prefixed global key', () => {
    const dir = ws.pkg('billing', { '.env': 'API_KEY=secret' });
    touched.push('API_KEY', 'BILLING_ENV_API_KEY');
    const injected = loadPackageEnv({ folder: 'billing', dir });
    expect(process.env.API_KEY).toBe('secret');
    expect(process.env.BILLING_ENV_API_KEY).toBe('secret');
    expect(injected.API_KEY).toMatchObject({ value: 'secret', globalKey: 'BILLING_ENV_API_KEY', skippedOriginal: false });
  });

  it('does not overwrite an existing raw var but always sets the global one', () => {
    process.env.SHARED = 'from-shell';
    touched.push('SHARED', 'PKG_ENV_SHARED');
    const dir = ws.pkg('pkg', { '.env': 'SHARED=from-file' });
    const injected = loadPackageEnv({ folder: 'pkg', dir });
    expect(process.env.SHARED).toBe('from-shell');       // 12-factor: shell wins
    expect(process.env.PKG_ENV_SHARED).toBe('from-file'); // explicit reference always set
    expect(injected.SHARED.skippedOriginal).toBe(true);
  });
});
