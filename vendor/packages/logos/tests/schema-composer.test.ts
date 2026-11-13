import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { composePackageSchema } from '../src/database/schema-composer';

const roots: string[] = [];
function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'logos-schema-'));
  roots.push(root);
  return root;
}

afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));

describe('package schema composition', () => {
  it('combines prisma and scriba fragments while the primary field wins', () => {
    const root = workspace();
    fs.mkdirSync(path.join(root, 'features'), { recursive: true });
    fs.writeFileSync(path.join(root, 'schema.prisma'), 'model Task {\n id String @id\n title String\n}\n');
    fs.writeFileSync(path.join(root, 'features', 'audit.scriba'), 'model Task {\n title Int\n score Int?\n}\nmodel Audit {\n id String @id\n}\n');
    fs.writeFileSync(path.join(root, 'features', 'status.prisma'), 'enum Status {\n OPEN\n}\nmodel Task {\n status Status?\n}\n');

    const result = composePackageSchema(root)!;
    expect(result.sources.map(source => path.relative(root, source))).toEqual(['schema.prisma', 'features/audit.scriba', 'features/status.prisma']);
    expect(result.schema).toContain('title String');
    expect(result.schema).not.toContain('title Int');
    expect(result.schema).toContain('score Int?');
    expect(result.schema).toContain('status Status?');
    expect(result.schema).toContain('model Audit');
    expect(fs.readFileSync(result.outputPath, 'utf8')).toBe(result.schema);
  });

  it('rejects conflicting declarations made by two fragments', () => {
    const root = workspace();
    fs.mkdirSync(path.join(root, 'a')); fs.mkdirSync(path.join(root, 'b'));
    fs.writeFileSync(path.join(root, 'a', 'one.prisma'), 'model Task {\n score Int\n}\n');
    fs.writeFileSync(path.join(root, 'b', 'two.scriba'), 'model Task {\n score String\n}\n');
    expect(() => composePackageSchema(root)).toThrow(/DB_SCHEMA_FRAGMENT_CONFLICT:model:Task:score/);
  });
});
