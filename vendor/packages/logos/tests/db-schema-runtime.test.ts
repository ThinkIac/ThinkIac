import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { Container } from '../src/kernel/container';
import { installDb } from './db-module';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));

it('composes and reloads prisma/scriba fragments on an open tenant', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'logos-db-live-'));
  roots.push(root);
  const folder = `live${Date.now()}`;
  const dir = path.join(root, folder);
  fs.mkdirSync(path.join(dir, 'features'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: folder }));
  fs.writeFileSync(path.join(dir, 'schema.prisma'), 'model Note {\n id String @id\n title String\n}\n');
  const container = new Container({ workspace: root });
  const db = installDb(container);
  await container.bus.emit('package:wiring', { pkg: container.registry.getPackage(folder) });
  const connection = db.getScriba()._tenants[folder].db;
  await (db.getProxy(folder) as any).note.push({ title: 'kept' });

  const fragment = path.join(dir, 'features', 'tags.scriba');
  fs.writeFileSync(fragment, 'model Note {\n tag String?\n}\nmodel Tag {\n id String @id\n}\n');
  await container.bus.emit('db:schema_changed', { pkg: folder });
  expect(db.getScriba()._tenants[folder].db).toBe(connection);
  expect((db.getProxy(folder) as any).tag).toBeTruthy();
  expect((db.getProxy(folder) as any).note.findOne({ title: 'kept' }).title).toBe('kept');
  expect((db.getProxy(folder) as any).note._fields.some((field: any) => field.name === 'tag')).toBe(true);

  fs.rmSync(fragment);
  await container.bus.emit('db:schema_changed', { pkg: folder });
  expect((db.getProxy(folder) as any).note.findOne({ title: 'kept' }).title).toBe('kept');
  expect((db.getProxy(folder) as any).tag).toBeUndefined();
  expect((db.getProxy(folder) as any).note._fields.some((field: any) => field.name === 'tag')).toBe(false);
  db.getScriba()._tenants[folder].db.close();
  delete (globalThis as any)[folder];
});
