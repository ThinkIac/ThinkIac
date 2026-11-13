import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { AddressInfo } from 'net';
import { gunzipSync } from 'zlib';
import express from 'express';
import { it, expect } from 'vitest';
import { compressedAssets, precompressAssets } from '../../modules/svelte';

function get(port: number, requestPath: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const request = http.request({ port, path: requestPath, headers }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve({ status: response.statusCode || 0, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    request.on('error', reject);
    request.end();
  });
}

it('negotiates compressed immutable assets and preserves identity/range fallback', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logos-assets-'));
  let server: http.Server | undefined;
  try {
    const name = 'pkg.DOM.0123456789abcdef0123456789abcdef.mjs';
    const file = path.join(dir, name);
    const source = 'export const text = "' + 'example'.repeat(1000) + '";';
    fs.writeFileSync(file, source); await precompressAssets([file]);
    const app = express(); app.use(compressedAssets(dir) as any, express.static(dir));
    server = await new Promise<http.Server>(resolve => {
      const listening = app.listen(0, () => resolve(listening));
    });
    const port = (server.address() as AddressInfo).port;
    const gzip = await get(port, '/' + name, { 'Accept-Encoding': 'gzip' });
    expect(gzip.headers['content-encoding']).toBe('gzip');
    expect(gzip.headers['vary']).toContain('Accept-Encoding');
    expect(gzip.headers['cache-control']).toContain('immutable');
    expect(gunzipSync(gzip.body).toString()).toBe(source);
    const identity = await get(port, '/' + name, { 'Accept-Encoding': 'identity' });
    expect(identity.headers['content-encoding']).toBeUndefined();
    expect(identity.body.toString()).toBe(source);
    const range = await get(port, '/' + name, { 'Accept-Encoding': 'gzip', Range: 'bytes=0-9' });
    expect(range.status).toBe(206);
    expect(range.headers['content-encoding']).toBeUndefined();
  } finally {
    await new Promise<void>(resolve => server ? server.close(() => resolve()) : resolve());
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
