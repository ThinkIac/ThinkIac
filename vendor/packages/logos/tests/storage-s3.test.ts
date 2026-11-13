import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { S3StorageProvider } from '../src/modules/storage-s3';

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true }); });

describe('S3StorageProvider', () => {
  it('uses path-style SigV4 requests and verifies the object metadata after upload', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'logos-s3-'));
    roots.push(root);
    const file = path.join(root, 'report.txt');
    fs.writeFileSync(file, 'important');
    const sha256 = '34a989eb3e220e6b0b19fcb3c08c06f3a5eb237313b66b5766fa6e629783a7d5';
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'x-amz-meta-sha256': sha256 } }));
    const provider = new S3StorageProvider({ endpoint: 'https://minio.test/root', bucket: 'tenant-a', accessKeyId: 'access', secretAccessKey: 'secret', fetch });

    await expect(provider.put({ key: 'exports/report.txt', file, sha256, size: 9 })).resolves.toEqual({ sha256 });
    expect(fetch).toHaveBeenNthCalledWith(1, expect.objectContaining({ pathname: '/root/tenant-a/exports/report.txt' }), expect.objectContaining({ method: 'PUT' }));
    const headers = fetch.mock.calls[0][1].headers;
    expect(headers.authorization).toContain('AWS4-HMAC-SHA256 Credential=access/');
    expect(headers['x-amz-meta-sha256']).toBe(sha256);
  });
});
