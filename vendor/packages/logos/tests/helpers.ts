// tests/helpers.ts — shared fixture utilities (NOT a test file: the vitest
// include glob only picks up *.test.ts, so this is never run on its own).
//
// The scanner works on real .js files on disk (it reads their source and
// require()s them), so decorator/registration tests need genuine fixture
// packages rather than in-memory functions — a function defined in a .ts test
// file loses its JSDoc comments to the transpiler. These helpers create
// throwaway workspaces under the OS temp dir and clean them up.

import fs from 'fs';
import os from 'os';
import path from 'path';

export interface FixtureWorkspace {
  /** Absolute path of the workspace root (what resolveWorkspace should return). */
  root: string;
  /** Creates a package folder with the given files ({ 'routes.js': '...' }). */
  pkg(folder: string, files: Record<string, string>): string;
  /** Removes the whole workspace from disk. */
  cleanup(): void;
}

export function makeWorkspace(prefix = 'logos-test-'): FixtureWorkspace {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    root,
    pkg(folder: string, files: Record<string, string>): string {
      const dir = path.join(root, folder);
      fs.mkdirSync(dir, { recursive: true });
      for (const [name, content] of Object.entries(files)) {
        const file = path.join(dir, name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
      }
      return dir;
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

/** Runs `fn` with process.env.HOME/USERPROFILE pointed at a fresh temp dir. */
export function withTempHome<T>(fn: (home: string) => T): T {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'logos-home-'));
  const prevHome = process.env.HOME;
  const prevProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    return fn(home);
  } finally {
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prevProfile;
    fs.rmSync(home, { recursive: true, force: true });
  }
}
