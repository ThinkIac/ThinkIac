import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Scriba from '../src/Scriba.js';
import { loadPrismaModels } from '../src/parser/Prisma.js';

function createSchema(source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scriba-unique-'));
  const schema = path.join(root, 'schema.prisma');
  fs.writeFileSync(schema, source);
  return { root, schema };
}

test('enforces @unique for active rows and releases the value after soft deletion', async () => {
  const { root, schema } = createSchema('model User {\n id String @id\n email String @unique\n}\n');
  const scriba = new Scriba();
  try {
    scriba.addTenant({ id: 'unique-field', path: ':memory:', schema, watchSchema: false });
    const users = scriba.entity('user', 'unique-field');
    const first = await users.push({ email: 'person@example.test' });
    await assert.rejects(users.push({ email: 'person@example.test' }), error => error.code === 'SQLITE_CONSTRAINT_UNIQUE');
    assert.equal(await users.delete(first.id), true);
    await users.push({ email: 'person@example.test' });
    assert.equal(users.count({ email: 'person@example.test' }), 1);
  } finally {
    scriba._tenants['unique-field']?.db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('parses field and model unique declarations without turning them into fields', () => {
  const { root, schema } = createSchema('model Membership {\n id String @id\n email String @unique\n organizationId String\n userId String\n @@unique([organizationId, userId])\n}\n');
  try {
    const { models } = loadPrismaModels(schema);
    assert.deepEqual(models.Membership.uniqueConstraints.map(item => item.fields), [
      ['organizationId', 'userId'],
      ['email'],
    ]);
    assert.equal(models.Membership.fields.some(field => field.name.startsWith('@@')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('enforces @@unique for inserts and updates', async () => {
  const { root, schema } = createSchema('model Membership {\n id String @id\n organizationId String\n userId String\n @@unique([organizationId, userId])\n}\n');
  const scriba = new Scriba();
  try {
    scriba.addTenant({ id: 'unique-model', path: ':memory:', schema, watchSchema: false });
    const memberships = scriba.entity('membership', 'unique-model');
    const first = await memberships.push({ organizationId: 'org-a', userId: 'user-a' });
    const second = await memberships.push({ organizationId: 'org-a', userId: 'user-b' });
    await assert.rejects(memberships.push({ organizationId: 'org-a', userId: 'user-a' }), error => error.code === 'SQLITE_CONSTRAINT_UNIQUE');
    await assert.rejects(second._table._updateDB(second, { userId: first.userId }), error => error.code === 'SQLITE_CONSTRAINT_UNIQUE');
    assert.deepEqual(scriba.inspectUniqueConflicts('unique-model', 'Membership', ['organizationId', 'userId']), []);
  } finally {
    scriba._tenants['unique-model']?.db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('reports existing duplicates before a unique index can be created', () => {
  const { root, schema } = createSchema('model User {\n id String @id\n email String\n}\n');
  const updated = path.join(root, 'updated.prisma');
  fs.writeFileSync(updated, 'model User {\n id String @id\n email String @unique\n}\n');
  const scriba = new Scriba();
  try {
    scriba.addTenant({ id: 'unique-conflict', path: ':memory:', schema, watchSchema: false });
    const db = scriba._tenants['unique-conflict'].db;
    db.prepare('INSERT INTO "User" (id, email, createdAt, updatedAt) VALUES (?, ?, ?, ?)').run('a', 'duplicate@example.test', '2020-01-01', '2020-01-01');
    db.prepare('INSERT INTO "User" (id, email, createdAt, updatedAt) VALUES (?, ?, ?, ?)').run('b', 'duplicate@example.test', '2020-01-01', '2020-01-01');
    assert.deepEqual(scriba.inspectUniqueConflicts('unique-conflict', 'User', ['email']), [{ email: 'duplicate@example.test', count: 2 }]);
    assert.throws(() => scriba.loadSchema('unique-conflict', updated), /active duplicate records exist/);
  } finally {
    scriba._tenants['unique-conflict']?.db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
