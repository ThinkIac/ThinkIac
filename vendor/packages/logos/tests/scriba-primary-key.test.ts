import { expect, it, vi } from 'vitest';
import path from 'node:path';
import { bootstrap } from '../src/index';
import { runAsPackage } from '../src/kernel/authority-context';
import { loadType } from '../src/kernel/type-source';
import { makeWorkspace } from './helpers';

it('routes typed keys through the active package authority and preserves legacy indexing', async () => {
  const workspace = makeWorkspace();
  const schema = `model User {
  slug String @id
  name String
}
model Membership {
  account String
  code Int
  @@id([account, code])
}
`;
  const source = `exports.read = (key) -> await User[key]
exports.membership = (key) -> await Membership[key]
exports.legacy = (id) -> User[id]
`;
  const north = workspace.pkg('north', { 'package.json': '{"name":"north"}', 'schema.prisma': schema, 'read.type': source });
  const south = workspace.pkg('south', { 'package.json': '{"name":"south"}', 'schema.prisma': schema, 'read.type': source });
  const readByPrimaryKey = vi.fn((tenant, model, key) => (key.slug === 'missing' ? null : { tenant, model, key }));
  const getScriba = vi.fn(() => ({ readByPrimaryKey }));
  const runtime = await bootstrap({
    workspace: workspace.root,
    externalModules: [],
    authority: { grants: { north: { database: ['north', 'south'] }, south: { database: ['south'] } } },
    modules: [{
      name: 'db', phase: 'boot',
      api: { getScriba, getProxy: () => ({ User: { 7: { name: 'legacy' } } }) },
      install() {},
    }],
  });
  try {
    const northern = loadType(path.join(north, 'read.type'));
    const southern = loadType(path.join(south, 'read.type'));
    const run = (tenant, fn) => runAsPackage(runtime.container.authority, tenant, fn);
    await expect(northern.read('ana')).rejects.toMatchObject({ code: 'SCRIBA_READ_DENIED' });
    await expect(run('north', () => southern.read('ana'))).rejects.toMatchObject({ code: 'SCRIBA_READ_DENIED' });
    await expect(run('ungranted', () => northern.read('ana'))).rejects.toMatchObject({ code: 'SCRIBA_READ_DENIED' });
    await expect(run('north', () => northern.read(7))).rejects.toMatchObject({ code: 'SCRIBA_INVALID_KEY' });
    await expect(run('north', () => northern.membership({ account: 'main' }))).rejects.toMatchObject({ code: 'SCRIBA_INVALID_KEY' });
    expect(getScriba).not.toHaveBeenCalled();
    await expect(run('north', () => northern.read('ana'))).resolves.toEqual({ tenant: 'north', model: 'User', key: { slug: 'ana' } });
    await expect(run('south', () => southern.read('ana'))).resolves.toEqual({ tenant: 'south', model: 'User', key: { slug: 'ana' } });
    await expect(run('north', () => northern.membership({ code: 7, account: 'main' }))).resolves.toEqual({
      tenant: 'north', model: 'Membership', key: { account: 'main', code: 7 },
    });
    await expect(run('north', () => northern.read('missing'))).resolves.toBeNull();
    expect(run('north', () => northern.legacy(7).name)).toBe('legacy');
  } finally {
    await runtime.close();
    workspace.cleanup();
  }
});
