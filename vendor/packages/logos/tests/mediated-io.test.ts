import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Container } from '../src/kernel/container';
import { makeWorkspace } from './helpers';
import { installDb } from './db-module';

function manifest(name: string, overrides: Record<string, any> = {}) {
  return {
    name,
    version: '1.0.0',
    runtime: {
      contractVersion: 1,
      mode: 'strict',
      provides: { services: {}, tools: [], events: [], eventSchemas: {} },
      requires: { services: {} },
      permissions: {
        tools: { invoke: [], exposeToAgents: [], administer: [] },
        events: { publish: [], subscribe: [], transform: [], veto: [], request: [] },
        data: {
          database: ['self'],
          files: [{ root: 'data', access: 'read-write' }],
          secrets: ['API_TOKEN'],
        },
        network: [{ origin: 'https://allowed.example', methods: ['GET'] }],
        process: {
          spawn: [{ executable: process.execPath, args: ['-e', '*'], cwd: ['data'], env: ['SAFE_VALUE'] }],
        },
        ui: [],
        ...overrides,
      },
    },
  };
}

describe('mediated package I/O', () => {
  it('enforces database ownership before returning a proxy', () => {
    const ws = makeWorkspace('logos-mediated-db-');
    try {
      ws.pkg('pilot', { 'package.json': JSON.stringify(manifest('pilot')) });
      const container = new Container({ workspace: ws.root });
      installDb(container);
      const ctx = container.packageContext('pilot');
      expect(() => ctx.db.use('other')).toThrowError(expect.objectContaining({ code: 'AUTHORITY_DENIED' }));
    } finally {
      ws.cleanup();
    }
  });

  it('confines reads and writes to granted roots after resolving symlinks', async () => {
    const ws = makeWorkspace('logos-mediated-files-');
    const outside = path.join(ws.root, 'outside.txt');
    try {
      ws.pkg('pilot', {
        'package.json': JSON.stringify(manifest('pilot')),
        'data/inside.txt': 'inside',
      });
      fs.writeFileSync(outside, 'outside');
      fs.symlinkSync(outside, path.join(ws.root, 'pilot', 'data', 'escape.txt'));
      const ctx = new Container({ workspace: ws.root }).packageContext('pilot');

      await expect(ctx.files.readFile('data/inside.txt', 'utf8')).resolves.toBe('inside');
      await expect(ctx.files.readFile('../outside.txt', 'utf8')).rejects.toMatchObject({ code: 'RESOURCE_BOUNDARY_DENIED' });
      await expect(ctx.files.readFile('data/escape.txt', 'utf8')).rejects.toMatchObject({ code: 'RESOURCE_BOUNDARY_DENIED' });
      await expect(ctx.files.writeFile('data/escape.txt', 'overwrite')).rejects.toMatchObject({ code: 'RESOURCE_BOUNDARY_DENIED' });
      expect(fs.readFileSync(outside, 'utf8')).toBe('outside');
      await expect(ctx.files.writeFile('other/no.txt', 'no')).rejects.toMatchObject({ code: 'AUTHORITY_DENIED' });
    } finally {
      ws.cleanup();
    }
  });

  it('returns redacted secret handles and never records the value', async () => {
    const ws = makeWorkspace('logos-mediated-secret-');
    try {
      ws.pkg('pilot', { 'package.json': JSON.stringify(manifest('pilot')) });
      const container = new Container({
        workspace: ws.root,
        authority: { secrets: { API_TOKEN: 'super-secret-value' } },
      });
      const secret = container.packageContext('pilot').secrets.get('API_TOKEN');

      expect(String(secret)).toBe('[REDACTED]');
      expect(JSON.stringify(secret)).not.toContain('super-secret-value');
      await expect(secret.withValue(value => value.length)).resolves.toBe(18);
      expect(JSON.stringify(container.authority.report('pilot'))).not.toContain('super-secret-value');
      expect(() => container.packageContext('pilot').secrets.get('OTHER')).toThrowError(
        expect.objectContaining({ code: 'AUTHORITY_DENIED' }),
      );
    } finally {
      ws.cleanup();
    }
  });

  it('reauthorizes every redirect and blocks an ungranted destination', async () => {
    const ws = makeWorkspace('logos-mediated-network-');
    try {
      ws.pkg('pilot', { 'package.json': JSON.stringify(manifest('pilot')) });
      const fakeFetch = vi.fn()
        .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://blocked.example/final' } }));
      const ctx = new Container({ workspace: ws.root, authority: { fetch: fakeFetch } }).packageContext('pilot');

      await expect(ctx.network.fetch('https://allowed.example/start')).rejects.toMatchObject({ code: 'AUTHORITY_DENIED' });
      expect(fakeFetch).toHaveBeenCalledTimes(1);
      expect(fakeFetch.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
    } finally {
      ws.cleanup();
    }
  });

  it('allows only declared executable, argv shape, cwd and environment keys', async () => {
    const ws = makeWorkspace('logos-mediated-process-');
    try {
      ws.pkg('pilot', {
        'package.json': JSON.stringify(manifest('pilot')),
        'data/.keep': '',
      });
      const container = new Container({ workspace: ws.root });
      container.createPackageScope('pilot');
      const ctx = container.packageContext('pilot');

      const child = ctx.process.spawn(process.execPath, ['-e', 'process.stdout.write(process.env.SAFE_VALUE || "")'], {
        cwd: 'data', env: { SAFE_VALUE: 'ok' }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout?.on('data', chunk => { output += chunk.toString(); });
      await new Promise<void>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', code => code === 0 ? resolve() : reject(new Error(`exit ${code}`)));
      });
      expect(output).toBe('ok');

      expect(() => ctx.process.spawn(process.execPath, ['--version'], { cwd: 'data' })).toThrowError(
        expect.objectContaining({ code: 'PROCESS_BOUNDARY_DENIED' }),
      );
      expect(() => ctx.process.spawn(process.execPath, ['-e', '0'], { cwd: 'data', env: { HOME: '/tmp' } })).toThrowError(
        expect.objectContaining({ code: 'PROCESS_BOUNDARY_DENIED' }),
      );
      expect(container.effectInventory().flatMap(scope => scope.resources)).toContainEqual(
        expect.objectContaining({ kind: 'child-process' }),
      );
      await container.disposeAllScopes();
    } finally {
      ws.cleanup();
    }
  });
});
