// S3-compatible storage adapter.  It intentionally uses only the S3 data
// plane: tenant provisioning belongs to a separate, vendor-aware package.

'use strict';

import crypto from 'crypto';
import fs from 'fs';
import { StorageProvider } from './storage';

type S3Fetch = (input: string | URL, init?: any) => Promise<any>;

export interface S3StorageOptions {
  name?: string;
  endpoint: string;
  region?: string;
  bucket: string;
  prefix?: string;
  accessKeyId: string;
  secretAccessKey: string;
  fetch?: S3Fetch;
}

function digest(value: Buffer | string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function hmac(key: Buffer | string, value: string): Buffer {
  return crypto.createHmac('sha256', key).update(value, 'utf8').digest();
}
function awsDate(now: Date) {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { stamp: iso, day: iso.slice(0, 8) };
}
function encodePath(value: string): string {
  return value.split('/').map(segment => encodeURIComponent(segment).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');
}

/** A minimal, path-style SigV4 client for immutable blobs and HEAD checks. */
export class S3StorageProvider implements StorageProvider {
  readonly name: string;
  private readonly endpoint: URL;
  private readonly region: string;
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly fetchImpl: S3Fetch;

  constructor(options: S3StorageOptions) {
    if (!options.endpoint || !options.bucket || !options.accessKeyId || !options.secretAccessKey) throw new Error('S3 provider requires endpoint, bucket and credentials');
    this.name = options.name || 's3';
    this.endpoint = new URL(options.endpoint);
    this.region = options.region || 'us-east-1';
    this.bucket = options.bucket;
    this.prefix = (options.prefix || '').replace(/^\/+|\/+$/g, '');
    this.accessKeyId = options.accessKeyId;
    this.secretAccessKey = options.secretAccessKey;
    this.fetchImpl = options.fetch || (globalThis as any).fetch;
    if (!this.fetchImpl) throw new Error('S3 provider requires fetch (Node 18+)');
  }

  async put(input: { key: string; file: string; sha256: string; size: number }): Promise<{ sha256: string }> {
    const body = fs.readFileSync(input.file);
    if (body.length !== input.size || digest(body) !== input.sha256) throw new Error('local file changed before S3 upload');
    await this.request('PUT', this.objectPath(input.key), body, { 'x-amz-meta-sha256': input.sha256 });
    const head = await this.request('HEAD', this.objectPath(input.key));
    const remoteSha = head.headers.get('x-amz-meta-sha256');
    if (remoteSha !== input.sha256) throw new Error('remote digest mismatch');
    return { sha256: remoteSha };
  }

  async get(input: { key: string }): Promise<Buffer> {
    const response = await this.request('GET', this.objectPath(input.key));
    return Buffer.from(await response.arrayBuffer());
  }

  /** Health probe used by setup flows; does not list or expose tenant data. */
  async check(): Promise<void> { await this.request('HEAD', this.bucketPath()); }

  private objectPath(key: string): string {
    const prefix = this.prefix ? `${this.prefix}/` : '';
    return `${this.bucketPath()}/${encodePath(`${prefix}${key}`)}`;
  }

  private bucketPath(): string { return `/${encodePath(this.bucket)}`; }

  private async request(method: string, pathname: string, body?: Buffer, extraHeaders: Record<string, string> = {}): Promise<Response> {
    const { stamp, day } = awsDate(new Date());
    const payloadHash = digest(body || Buffer.alloc(0));
    const url = new URL(this.endpoint.toString());
    url.pathname = `${this.endpoint.pathname.replace(/\/$/, '')}${pathname}`;
    const headers: Record<string, string> = {
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': stamp,
      ...extraHeaders,
    };
    const sorted = Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value.trim().replace(/\s+/g, ' ')] as const).sort(([a], [b]) => a.localeCompare(b));
    const canonicalHeaders = sorted.map(([key, value]) => `${key}:${value}\n`).join('');
    const signedHeaders = sorted.map(([key]) => key).join(';');
    const canonicalRequest = [method, url.pathname, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const scope = `${day}/${this.region}/s3/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${stamp}\n${scope}\n${digest(canonicalRequest)}`;
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${this.secretAccessKey}`, day), this.region), 's3'), 'aws4_request');
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const response = await this.fetchImpl(url, { method, headers, body });
    if (!response.ok) throw new Error(`S3 ${method} ${pathname} failed (${response.status})`);
    return response;
  }
}
