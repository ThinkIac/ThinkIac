import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { findLocalPrismaBinary } from '../src/stabilizer/index';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('local Prisma resolution', () => {
  it('does not fall back to npx when Prisma is not installed', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'logos-no-prisma-'));
    dirs.push(cwd);
    expect(findLocalPrismaBinary(cwd)).toBeNull();
  });

  it('uses the workspace-local executable when it is installed', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'logos-prisma-'));
    dirs.push(cwd);
    const executable = process.platform === 'win32' ? 'prisma.cmd' : 'prisma';
    const binary = path.join(cwd, 'node_modules', '.bin', executable);
    fs.mkdirSync(path.dirname(binary), { recursive: true });
    fs.writeFileSync(binary, '');
    expect(findLocalPrismaBinary(cwd)).toBe(binary);
  });
});
