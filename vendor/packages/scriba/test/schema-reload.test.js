import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Scriba from '../src/Scriba.js';

test('reloadTenantSchema keeps the tenant connection and exposes new models and fields', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scriba-reload-'));
  const first = path.join(root, 'first.prisma');
  const second = path.join(root, 'second.prisma');
  fs.writeFileSync(first, 'model Note {\n id String @id\n title String\n}\n');
  fs.writeFileSync(second, 'model Note {\n id String @id\n title String\n rank Int?\n}\nmodel Tag {\n id String @id\n}\n');
  const scriba = new Scriba();
  try {
    scriba.addTenant({ id: 'live', path: ':memory:', schema: first, watchSchema: false });
    const connection = scriba._tenants.live.db;
    await scriba.entity('note', 'live').push({ title: 'before' });
    await scriba.reloadTenantSchema('live', second);
    assert.equal(scriba._tenants.live.db, connection);
    assert.ok(scriba.entity('tag', 'live'));
    const row = scriba.entity('note', 'live').findOne({ title: 'before' });
    assert.equal(row.title, 'before');
    assert.ok(scriba.entity('note', 'live')._fields.some(field => field.name === 'rank'));
  } finally {
    scriba._tenants.live?.db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('reloadTenantSchema serializes concurrent reloads', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scriba-queue-'));
  const first = path.join(root, 'first.prisma');
  const second = path.join(root, 'second.prisma');
  fs.writeFileSync(first, 'model Item {\n id String @id\n}\n');
  fs.writeFileSync(second, 'model Item {\n id String @id\n value String?\n}\n');
  const scriba = new Scriba();
  try {
    scriba.addTenant({ id: 'queued', path: ':memory:', schema: first, watchSchema: false });
    await Promise.all([scriba.reloadTenantSchema('queued', first), scriba.reloadTenantSchema('queued', second)]);
    assert.equal(scriba._tenants.queued.schemaPath, second);
  } finally {
    scriba._tenants.queued?.db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('reloadTenantSchema removes stale runtime models and restores them on failure', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scriba-reload-catalog-'));
  const expanded = path.join(root, 'expanded.prisma');
  const reduced = path.join(root, 'reduced.prisma');
  fs.writeFileSync(expanded, 'model Note {\n id String @id\n rank Int?\n}\nmodel Tag {\n id String @id\n}\n');
  fs.writeFileSync(reduced, 'model Note {\n id String @id\n}\n');
  const scriba = new Scriba();
  try {
    scriba.addTenant({ id: 'catalog', path: ':memory:', schema: expanded, watchSchema: false });
    await scriba.reloadTenantSchema('catalog', reduced);
    assert.equal(scriba.entity('tag', 'catalog'), undefined);
    assert.equal(scriba.entity('note', 'catalog')._fields.some(field => field.name === 'rank'), false);

    const stableCatalog = scriba._tenants.catalog.tables;
    const loadSchema = scriba.loadSchema;
    scriba.loadSchema = () => { throw new Error('controlled reload failure'); };
    await assert.rejects(scriba.reloadTenantSchema('catalog', reduced), /controlled reload failure/);
    scriba.loadSchema = loadSchema;
    assert.equal(scriba._tenants.catalog.tables, stableCatalog);
    assert.ok(scriba.entity('note', 'catalog'));
  } finally {
    scriba._tenants.catalog?.db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
