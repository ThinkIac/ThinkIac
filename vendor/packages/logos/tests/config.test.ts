// tests/config.test.ts — user-level persisted config (~/.environments/config.json).
//
// Every test injects an isolated config directory. Production callers may omit
// it and keep using ~/.environments.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, afterEach } from 'vitest';
import { readConfig, saveConfig } from '../src/kernel/config';

const created: string[] = [];
afterEach(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
  created.length = 0;
});

function freshConfig() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'logos-cfg-'));
  created.push(home);
  return { configDir: path.join(home, '.environments'), home };
}

describe('readConfig / saveConfig', () => {
  it('returns {} when no config file exists', () => {
    const { configDir } = freshConfig();
    expect(readConfig(configDir)).toEqual({});
  });

  it('persists values and reads them back', () => {
    const { configDir, home } = freshConfig();
    saveConfig({ theme: 'dark', port: 8080 }, configDir);
    expect(readConfig(configDir)).toEqual({ theme: 'dark', port: 8080 });
    expect(fs.existsSync(path.join(home, '.environments', 'config.json'))).toBe(true);
  });

  it('merges successive saves', () => {
    const { configDir } = freshConfig();
    saveConfig({ a: 1 }, configDir);
    saveConfig({ b: 2 }, configDir);
    expect(readConfig(configDir)).toEqual({ a: 1, b: 2 });
  });

  it('a null value deletes a key', () => {
    const { configDir } = freshConfig();
    saveConfig({ a: 1, b: 2 }, configDir);
    saveConfig({ a: null }, configDir);
    expect(readConfig(configDir)).toEqual({ b: 2 });
  });

  it('returns {} for a corrupt config file', () => {
    const { configDir, home } = freshConfig();
    fs.mkdirSync(path.join(home, '.environments'), { recursive: true });
    fs.writeFileSync(path.join(home, '.environments', 'config.json'), '{ not json');
    expect(readConfig(configDir)).toEqual({});
  });
});
