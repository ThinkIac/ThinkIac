import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createDb } from './db-module';

let temporaryRoot = '';

afterEach(() => {
  if (temporaryRoot) fs.rmSync(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = '';
});

it('resolves the Scriba peer from the running application before nested dependencies', async () => {
  temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'logos-scriba-peer-'));
  const moduleDir = path.join(temporaryRoot, 'node_modules', 'scriba');
  fs.mkdirSync(moduleDir, { recursive: true });
  fs.writeFileSync(path.join(temporaryRoot, 'package.json'), JSON.stringify({ private: true }));
  fs.writeFileSync(path.join(moduleDir, 'package.json'), JSON.stringify({ name: 'scriba', main: 'index.js' }));
  fs.writeFileSync(path.join(moduleDir, 'index.js'), `
    class AppScriba {
      addTenant() {}
      entity() {}
      tenants() { return []; }
    }
    module.exports = { default: AppScriba };
  `);

  const scriba = createDb().loadScribaFrom(temporaryRoot);

  expect(scriba?.constructor.name).toBe('AppScriba');
  expect(typeof scriba?.entity).toBe('function');
});
