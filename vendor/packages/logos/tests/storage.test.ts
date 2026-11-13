// Storage Mesh contract: the local copy is authoritative until a verified
// replica exists. These tests deliberately use a fake provider: the core must
// be deterministic and never require the network to boot or serve a package.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorageMesh, StorageUnavailableError, type StorageProvider } from '../src/modules/storage';

const roots: string[] = [];

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'logos-storage-'));
  roots.push(root);
  return root;
}

function provider(overrides: Partial<StorageProvider> = {}): StorageProvider {
  return {
    name: 'test-s3',
    async put({ sha256 }) { return { sha256 }; },
    async get() { return Buffer.from('remote'); },
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('StorageMesh', () => {
  it('records a local file and a durable outbox entry before any provider I/O', async () => {
    const root = tempRoot();
    const remote = provider({ put: vi.fn().mockRejectedValue(new Error('offline')) });
    const storage = new StorageMesh({ root, provider: remote });
    const file = path.join(root, 'uploads', 'report.txt');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'important');

    await storage.track(file);

    expect(storage.status(file)).toMatchObject({ state: 'pending', local: true });
    expect(storage.outbox()).toHaveLength(1);
    expect(vi.mocked(remote.put)).not.toHaveBeenCalled();
  });

  it('freezes only after remote upload and SHA-256 verification succeed', async () => {
    const root = tempRoot();
    const put = vi.fn(async ({ sha256 }) => ({ sha256 }));
    const storage = new StorageMesh({ root, provider: provider({ put }) });
    const file = path.join(root, 'uploads', 'report.txt');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'important');
    await storage.track(file);

    await storage.sync();
    const frozen = await storage.freeze(file);

    expect(put).toHaveBeenCalledTimes(1);
    expect(frozen.state).toBe('frozen');
    expect(fs.existsSync(file)).toBe(false);
    expect(storage.outbox()).toEqual([]);
  });

  it('does not remove a local file when the provider rejects its digest', async () => {
    const root = tempRoot();
    const storage = new StorageMesh({
      root,
      provider: provider({ put: async () => ({ sha256: 'wrong' }) }),
    });
    const file = path.join(root, 'uploads', 'report.txt');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'important');
    await storage.track(file);

    await expect(storage.freeze(file)).rejects.toThrow('digest mismatch');
    expect(fs.existsSync(file)).toBe(true);
    expect(storage.status(file).state).toBe('failed');
  });

  it('rehydrates a frozen file and emits storage:file-ready', async () => {
    const root = tempRoot();
    const storage = new StorageMesh({ root, provider: provider({ get: async () => Buffer.from('important') }) });
    const file = path.join(root, 'uploads', 'report.txt');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'important');
    await storage.track(file);
    await storage.freeze(file);
    const emit = vi.fn();
    storage.onEvent(emit);

    await storage.ensure(file);

    expect(fs.readFileSync(file, 'utf8')).toBe('important');
    expect(storage.status(file).state).toBe('hot');
    expect(emit).toHaveBeenCalledWith('storage:file-ready', expect.objectContaining({ path: file }));
  });

  it('surfaces temporary unavailability as EAGAIN and emits rehydration-pending', async () => {
    const root = tempRoot();
    const storage = new StorageMesh({ root, provider: provider({ get: async () => { throw new Error('offline'); } }) });
    const file = path.join(root, 'uploads', 'report.txt');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'important');
    await storage.track(file);
    await storage.freeze(file);
    const emit = vi.fn();
    storage.onEvent(emit);

    await expect(storage.ensure(file)).rejects.toBeInstanceOf(StorageUnavailableError);
    await expect(storage.ensure(file)).rejects.toMatchObject({ code: 'EAGAIN', retryAfterMs: expect.any(Number) });
    expect(storage.status(file).state).toBe('degraded');
    expect(emit).toHaveBeenCalledWith('storage:rehydration-pending', expect.objectContaining({ path: file }));
  });

  it('refuses active databases and code paths even when asked to freeze them', async () => {
    const root = tempRoot();
    const storage = new StorageMesh({ root, provider: provider() });
    const db = path.join(root, 'packages', 'memory', '.database', 'main.db');
    fs.mkdirSync(path.dirname(db), { recursive: true });
    fs.writeFileSync(db, 'sqlite');
    await storage.track(db);

    await expect(storage.freeze(db)).rejects.toThrow('not eligible');
    expect(fs.existsSync(db)).toBe(true);
  });
});
