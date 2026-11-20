import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
const { db, dispatch, mail, databaseState } = vi.hoisted(() => ({ db: {}, databaseState: {}, dispatch: vi.fn(), mail: vi.fn() }));
vi.mock('logos', () => ({ getProxy: () => db, scriba: { instance: { _tenants: { auth: { get db() { return databaseState.connection; } } } } }, dispatchEvent: dispatch, isPublicRoute: () => false, isPublicView: () => false }));
vi.mock('./mcp-auth.js', () => ({ createMcpAuth: () => ({}) }));
import { login, createAccount } from './index.js';
function collection() {
 const rows = [];
 const store = { rows, findOne: q => rows.find(r => Object.entries(q).every(([k,v]) => r[k] === v)), query: q => rows.filter(r => Object.entries(q).every(([k,v]) => r[k] === v)), async push(value) { const row = { id: String(rows.length + 1), ...value }; rows.push(row); store[row.id] = row; return row; }, async delete() {} };
 return store;
}
const response = () => { const res = { setHeader: vi.fn(), status: vi.fn(() => res), send: vi.fn() }; return res; };
let localConnection;
beforeEach(() => { localConnection = new Database(':memory:'); databaseState.connection = localConnection; vi.clearAllMocks(); db.user = collection(); db.session = collection(); db.emailverification = collection(); db.appentitlement = collection(); db.permissionMembership = collection(); db.permissionGroup = collection(); db.permissionGrant = collection(); dispatch.mockResolvedValue({ granted: true }); mail.mockResolvedValue({}); });
afterEach(() => { if (localConnection.open) localConnection.close(); });
test('login normalizes email, returns HTTP errors and limits attempts per socket peer', async () => {
 const { hashPasswordAsync } = await import('./password-async.js');
 await db.user.push({ email: 'admin@example.test', password: await hashPasswordAsync('test-password'), role: 'admin' });
 const req = { socket: { remoteAddress: '192.0.2.42' }, body: { email: ' Admin@Example.Test ', password: 'test-password' } };
 expect((await login(req, response())).success).toBe(true);
 const invalid = response();
 await login({ ...req, body: { email: 'missing@example.test', password: 'wrong' } }, invalid);
 expect(invalid.status).toHaveBeenCalledWith(400);
 for (let i = 0; i < 18; i++) await login({ ...req, body: {} }, response());
 const blocked = response();
 await login(req, blocked);
 expect(blocked.status).toHaveBeenCalledWith(429);
 expect(blocked.setHeader).toHaveBeenCalledWith('Retry-After', '900');
 expect((await login({ ...req, socket: { remoteAddress: '192.0.2.43' } }, response())).success).toBe(true);
});
test('login uses separate client limits behind an explicitly trusted proxy', async () => {
 const proxy = { remoteAddress: '::ffff:198.51.100.10' };
 vi.stubEnv('AUTH_LOGIN_TRUSTED_PROXY_IPS', '198.51.100.10');
 try {
   const request = { socket: proxy, headers: { 'x-real-ip': '2001:db8::1' } };
   for (let i = 0; i < 20; i++) await login(request, response());

   const blocked = response();
   await login({ ...request, headers: { 'x-real-ip': '2001:0DB8:0:0::1' } }, blocked);
   expect(blocked.status).toHaveBeenCalledWith(429);

   const otherClient = response();
   await login({ ...request, headers: { 'x-real-ip': '2001:db8::2' } }, otherClient);
   expect(otherClient.status).toHaveBeenCalledWith(400);

   for (let i = 0; i < 20; i++) await login({ socket: proxy }, response());
   const invalidHeader = response();
   await login({ ...request, headers: { 'x-real-ip': '192.0.2.1, 192.0.2.2' } }, invalidHeader);
   expect(invalidHeader.status).toHaveBeenCalledWith(429);
 } finally {
   vi.unstubAllEnvs();
 }
});

test('login uses the socket limit for peers outside the trusted proxy list', async () => {
 vi.stubEnv('AUTH_LOGIN_TRUSTED_PROXY_IPS', '198.51.100.10');
 try {
   const socket = { remoteAddress: '198.51.100.11' };
   for (let i = 0; i < 20; i++) {
     await login({ socket, headers: { 'x-real-ip': `192.0.2.${i + 1}` } }, response());
   }
   const blocked = response();
   await login({ socket, headers: { 'x-real-ip': '192.0.2.21' } }, blocked);
   expect(blocked.status).toHaveBeenCalledWith(429);
 } finally {
   vi.unstubAllEnvs();
 }
});

test('paid account is created without provisioning a tenant during account creation', async () => {
 db.proxyCredential=collection();
 const admin=await db.user.push({id:'admin',email:'admin@example.test',username:'admin-user',role:'admin'});
 dispatch.mockImplementation(async (event,payload)=>{
   if(event==='billing:grant-trial') return {granted:true};
   return payload;
 });
 const originalFetch=globalThis.fetch;
 globalThis.fetch=vi.fn(async()=>new Response('ready',{status:200}));
 try {
   const result=await createAccount({user:{id:admin.id},body:{name:'Paid',email:'paid@example.test',username:'paid-user',password:'test-password',plan:'pro'}},response());
   expect(result.success).toBe(true);
   expect(db.user[result.userId].tenantStatus).toBeUndefined();
   expect(dispatch).not.toHaveBeenCalledWith('thinkiac:tenant:claim',expect.anything());
   expect(dispatch).not.toHaveBeenCalledWith('thinkiac:tenant:create',expect.anything());
 } finally { globalThis.fetch=originalFetch; }
});

test('login shares normalized account limits across IPs and database connections', async () => {
 const directory = mkdtempSync(join(tmpdir(), 'thinkiac-login-'));
 const filename = join(directory, 'auth.db');
 const connections = [new Database(filename), new Database(filename)];
 const clock = vi.spyOn(Date, 'now').mockReturnValue(120000);
 try {
   const { hashPasswordAsync } = await import('./password-async.js');
   await db.user.push({ email: 'shared@example.test', password: await hashPasswordAsync('correct-password') });
   const request = (i, email = 'shared@example.test', password = 'wrong') => {
     databaseState.connection = connections[i % 2];
     return { socket: { remoteAddress: `192.0.2.${100 + i}` }, body: { email, password } };
   };
   expect((await login(request(0, undefined, 'correct-password'), response())).success).toBe(true);
   const attempts = await Promise.all(Array.from({ length: 12 }, async (_, i) => {
     const res = response();
     await login(request(i + 1, i % 2 ? ' SHARED@Example.Test ' : undefined), res);
     return res.status.mock.calls[0][0];
   }));
   expect(attempts.filter(status => status === 400)).toHaveLength(10);
   expect(attempts.filter(status => status === 429)).toHaveLength(2);
   clock.mockReturnValue(179000);
   const blocked = response();
   await login(request(13, undefined, 'correct-password'), blocked);
   expect(blocked.status).toHaveBeenCalledWith(429);
   expect(blocked.setHeader).toHaveBeenCalledWith('Retry-After', '1');
   const independent = response();
   await login(request(14, 'other@example.test'), independent);
   expect(independent.status).toHaveBeenCalledWith(400);
   clock.mockReturnValue(180000);
   expect((await login(request(15, undefined, 'correct-password'), response())).success).toBe(true);
 } finally {
   clock.mockRestore();
   for (const connection of connections) connection.close();
   rmSync(directory, { recursive: true, force: true });
 }
});

test('login returns 503 when the account limiter cannot reserve an attempt', async () => {
 databaseState.connection.close();
 const res = response();
 await login({ socket: { remoteAddress: '192.0.2.200' }, body: { email: 'admin@example.test' } }, res);
 expect(res.status).toHaveBeenCalledWith(503);
});
