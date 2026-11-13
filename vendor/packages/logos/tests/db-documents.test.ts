import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { Container } from '../src/kernel/container';
import { runAsPrincipal } from '../src/kernel/authority-context';
import { createDb } from './db-module';

const db = createDb();

describe('schema-less Scriba document access', () => {
  it('checks authority before acquiring a database and rejects traversal', async () => {
    const enforce = () => { throw new Error('DENIED'); };
    await expect(runAsPrincipal({ enforce } as any, { kind: 'package', id: 'other' },
      () => db.getDocuments({} as any, 'desktop'))).rejects.toThrow('DENIED');
    await expect(db.getDocuments({} as any, '../auth')).rejects.toThrow('INVALID_DATABASE_TENANT');
  });
  it('requires a real package and does not invent missing package directories', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logos-documents-'));
    try {
      const container = new Container({ workspace: dir } as any);
      await expect(db.getDocuments(container, 'missing')).rejects.toThrow('DATABASE_PACKAGE_NOT_FOUND');
      expect(fs.existsSync(path.join(dir, 'missing'))).toBe(false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('opens one real Scriba connection for concurrent callers without a schema', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logos-documents-'));
    const tenant = `probe${Date.now()}`;
    const previousDataDir = process.env.LOGOS_DATA_DIR;
    delete process.env.LOGOS_DATA_DIR;
    fs.mkdirSync(path.join(dir, tenant));
    fs.writeFileSync(path.join(dir, tenant, 'package.json'), JSON.stringify({ name: tenant }));
    try {
      const container = new Container({ workspace: dir });
      const [a, b] = await Promise.all([db.getDocuments(container, tenant), db.getDocuments(container, tenant)]);
      expect(a).toBe(b);
      const key = ['installation', tenant, 'example', 'one'];
      a.commit(key, { operationId: 'create', issuedAt: Date.now(), author: 'owner', baseVersion: 0,
        patches: [{ op: 'set', path: [], value: { saved: true } }] });
      expect(b.get(key).value).toEqual({ saved: true });
      expect(fs.existsSync(path.join(dir, tenant, '.database'))).toBe(true);
      expect(fs.existsSync(path.join(dir, tenant, 'schema.prisma'))).toBe(false);
    } finally {
      db.getScriba()?._tenants[tenant]?.db.close();
      if (previousDataDir === undefined) delete process.env.LOGOS_DATA_DIR;
      else process.env.LOGOS_DATA_DIR = previousDataDir;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
