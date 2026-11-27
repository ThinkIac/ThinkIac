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
    const isolatedRead = runtime.container.state('runtime:capabilities').get('scriba:primary-key');
    const request = { operation: 'read', model: 'User', key: 'ana', tenant: 'south' };
    expect(() => run('north', () => isolatedRead(request, { package: 'south' }))).toThrow('Invalid isolated Scriba read');
    await expect(run('north', () => isolatedRead(request, { package: 'north' }))).resolves.toEqual({
      tenant: 'north', model: 'User', key: { slug: 'ana' },
    });
  } finally {
    await runtime.close();
    workspace.cleanup();
  }
});

const isolationProvider = process.env.LOGOS_TEST_ISOLATION_PROVIDER;
it.skipIf(!isolationProvider)('reads typed keys across the isolated process boundary', async () => {
  const { provideIsolation } = require(isolationProvider!);
  const workspace = makeWorkspace();
  for (const name of ['north', 'south']) {
    workspace.pkg(name, {
      'package.json': JSON.stringify({ name }),
      'schema.prisma': 'model User {\n  slug String @id\n}',
      'read.type': '###*\n# @register_tool read\n###\nexports.read = (key) -> await User[key]\n',
    });
  }
  const readByPrimaryKey = vi.fn((tenant, model, key) => ({ tenant, model, key }));
  const isolation = provideIsolation({ authority: { runAsPackage } });
  const runtime = await bootstrap({
    workspace: workspace.root, externalModules: [],
    authority: { grants: { north: { database: ['north'] } } },
    modules: [
      isolation,
      { name: 'db', phase: 'boot', api: { getScriba: () => ({ readByPrimaryKey }) }, install() {} },
    ],
  });
  try {
    const start = (folder: string) => isolation.api.isolatedRunnerFor(runtime.container, {
      ...runtime.container.registry.getPackage(folder), isolated: true,
    });
    const north = await start('north');
    const south = await start('south');
    await expect(north.invoke(north.manifest.tools[0].id, ['ana'])).resolves.toEqual({
      tenant: 'north', model: 'User', key: { slug: 'ana' },
    });
    await expect(north.invoke(north.manifest.tools[0].id, [12])).rejects.toThrow('Invalid primary key');
    await expect(south.invoke(south.manifest.tools[0].id, ['ana'])).rejects.toThrow('Cannot read User');
    expect(readByPrimaryKey).toHaveBeenCalledTimes(1);
  } finally {
    await runtime.close();
    workspace.cleanup();
  }
});
