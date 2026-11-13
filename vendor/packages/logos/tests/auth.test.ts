// tests/auth.test.ts — the built-in credential guard and its neutral override.

import { describe, it, expect, afterEach } from 'vitest';
import { Container } from '../src/kernel/container';
// The credential guard is supplied by the reusable module, not by Lógos.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { expectedCredential, buildCredentialGuard } = require('../../modules/credentials');

function mockRes() {
  return {
    statusCode: 200,
    body: null as any,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: any) { this.body = payload; return this; },
  };
}

const cleanup: string[] = [];
afterEach(() => { for (const k of cleanup) delete process.env[k]; cleanup.length = 0; });

describe('expectedCredential', () => {
  it('prefers the package-scoped token over the global one', () => {
    process.env.MYPKG_ENV_AUTH_TOKEN = 'scoped';
    process.env.AUTH_TOKEN = 'global';
    cleanup.push('MYPKG_ENV_AUTH_TOKEN', 'AUTH_TOKEN');
    expect(expectedCredential('mypkg')).toBe('scoped');
  });

  it('falls back to the global token, then null', () => {
    process.env.AUTH_TOKEN = 'global';
    cleanup.push('AUTH_TOKEN');
    expect(expectedCredential('other')).toBe('global');
    delete process.env.AUTH_TOKEN;
    expect(expectedCredential('other')).toBeNull();
  });
});

describe('buildCredentialGuard', () => {
  it('calls next() when the bearer token matches', async () => {
    process.env.PKG_ENV_AUTH_TOKEN = 'good';
    cleanup.push('PKG_ENV_AUTH_TOKEN');
    const guard = buildCredentialGuard(new Container({ workspace: '/x' }), 'pkg');
    let nexted = false;
    const res = mockRes();
    await guard({ headers: { authorization: 'Bearer good' } }, res, () => { nexted = true; });
    expect(nexted).toBe(true);
  });

  it('401s on a wrong/missing token', async () => {
    process.env.PKG_ENV_AUTH_TOKEN = 'good';
    cleanup.push('PKG_ENV_AUTH_TOKEN');
    const guard = buildCredentialGuard(new Container({ workspace: '/x' }), 'pkg');
    const res = mockRes();
    await guard({ headers: { authorization: 'Bearer wrong' } }, res, () => {});
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toMatch(/Invalid or missing/);
  });

  it('reports a helpful message when no token is configured', async () => {
    const guard = buildCredentialGuard(new Container({ workspace: '/x' }), 'pkg');
    const res = mockRes();
    await guard({ headers: {} }, res, () => {});
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toMatch(/not configured/);
  });

  it('lets a provider override the decision via credential:verify', async () => {
    const container = new Container({ workspace: '/x' });
    container.bus.on('credential:verify', () => ({ allowed: true }));
    const guard = buildCredentialGuard(container, 'pkg');
    let nexted = false;
    await guard({ headers: {} }, mockRes(), () => { nexted = true; });
    expect(nexted).toBe(true);
  });

  it('honors a custom status/message from the override', async () => {
    const container = new Container({ workspace: '/x' });
    container.bus.on('credential:verify', () => ({ allowed: false, status: 403, message: 'forbidden' }));
    const guard = buildCredentialGuard(container, 'pkg');
    const res = mockRes();
    await guard({ headers: {} }, res, () => {});
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});
