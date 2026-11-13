import { test, expect, vi, beforeEach } from 'vitest';
const { db, dispatch, mail } = vi.hoisted(() => ({ db: {}, dispatch: vi.fn(), mail: vi.fn() }));
vi.mock('logos', () => ({ getProxy: () => db, dispatchEvent: dispatch, isPublicRoute: () => false, isPublicView: () => false }));
vi.mock('./email_delivery.js', () => ({ queueVerificationEmail: mail }));
vi.mock('./mcp-auth.js', () => ({ createMcpAuth: () => ({}) }));
import { register, login, identityProvider, confirmEmail, createAccount } from './index.js';
import { createEmailVerification } from './email_verification.js';
function collection() {
 const rows = [];
 const store = { rows, findOne: q => rows.find(r => Object.entries(q).every(([k,v]) => r[k] === v)), query: q => rows.filter(r => Object.entries(q).every(([k,v]) => r[k] === v)), async push(value) { const row = { id: String(rows.length + 1), ...value }; rows.push(row); store[row.id] = row; return row; }, async delete() {} };
 return store;
}
const response = () => { const res = { setHeader: vi.fn(), status: vi.fn(() => res), send: vi.fn() }; return res; };
beforeEach(() => { vi.clearAllMocks(); db.user = collection(); db.session = collection(); db.emailverification = collection(); db.appentitlement = collection(); dispatch.mockResolvedValue({ granted: true }); mail.mockResolvedValue({}); });
test('registration starts a usable session before email delivery finishes', async () => {
 mail.mockReturnValue(new Promise(() => {}));
 // An app account exercises registration without calling real infrastructure.
 const result = await register({ body: { name: 'New', email: 'new@example.test', username: 'new-user', password: 'test-password', flow: 'app', app: 'lectio' } }, response());
 expect(result.success).toBe(true);
 expect(result.requiresEmailVerification).toBe(false);
 const user = db.user.rows[0];
 expect(user.emailVerified).toBe(false);
 const session = db.session.rows[0];
 const resolved = await identityProvider.resolve({ headers: { cookie: `sessionId=${session.id}` } });
 expect(resolved.user.id).toBe(user.id);
 const signedIn = await login({ body: { email: user.email, password: 'test-password' } }, response());
 expect(signedIn.success).toBe(true);
 expect(signedIn.redirectUrl).toBe('/redirect/home');
 expect(dispatch).not.toHaveBeenCalledWith('billing:grant-trial', expect.anything());
});
test('confirmation requests credit for the authenticated account, never a supplied user ID', async () => {
 const user = await db.user.push({ id: 'u', email: 'new@example.test', emailVerified: false, tenantStatus: null });
 const verification = createEmailVerification({ userId: user.id, email: user.email });
 await db.emailverification.push(verification.record);
 const result = await confirmEmail({ body: { token: verification.token, userId: 'attacker' } }, response());
 expect(result.success).toBe(true);
 expect(user.emailVerified).toBe(true);
 expect(dispatch).toHaveBeenCalledWith('billing:grant-trial', { userId: 'u' });
 expect((await confirmEmail({ body: { token: verification.token } }, response())).status).toBe(400);
});

test('complete signup: session immediately, no tenant provisioning, $5 only after confirmation', async () => {
 const { onResolveProxyToken } = await import('./index.js');
 db.proxyCredential = collection();
 const originalFetch = globalThis.fetch;
 globalThis.fetch = vi.fn(async () => new Response('ready', { status: 200 }));
 dispatch.mockImplementation(async (event, payload) => {
   if (event === 'billing:grant-trial') return { granted: true };
   return payload;
 });
 try {
 const result = await register({body:{name:'Customer',email:'customer@example.test',username:'customer',password:'test-password'}},response());
 expect(result.success).toBe(true);expect(result.requiresEmailVerification).toBe(false);expect(db.session.rows).toHaveLength(1);
 const user=db.user.rows[0];
 expect(user.tenantStatus).toBeNull();
 expect(user.tenantId).toBeUndefined();
 expect(dispatch).not.toHaveBeenCalledWith('thinkiac:tenant:claim',expect.anything());
 expect(dispatch).not.toHaveBeenCalledWith('thinkiac:tenant:create',expect.anything());
 const verification=createEmailVerification({userId:user.id,email:user.email});
 await db.emailverification.push(verification.record);
 expect((await confirmEmail({body:{token:verification.token}},response())).success).toBe(true);
 expect(user.welcomeCreditStatus).toBe('granted');
 expect(dispatch).toHaveBeenCalledWith('billing:grant-trial', { userId: user.id });
 } finally { globalThis.fetch = originalFetch; }
});

test('billing outage does not undo confirmation and recovery grants once later',async()=>{
 const {recoverActivations}=await import('./activation.js');
 const user=await db.user.push({id:'u',email:'new@example.test',emailVerified:false,tenantStatus:'ready'});
 const verification=createEmailVerification({userId:user.id,email:user.email});await db.emailverification.push(verification.record);
 dispatch.mockRejectedValue(new Error('billing offline'));
 expect((await confirmEmail({body:{token:verification.token}},response())).success).toBe(true);
 expect(user.emailVerified).toBe(true);expect(user.welcomeCreditStatus).toBe('pending');
 db.user.all=()=>db.user.rows;
 const grant=vi.fn(async id=>{db.user[id].welcomeCreditStatus='granted';});
 await recoverActivations(db,{provision:vi.fn(),grant});
 await recoverActivations(db,{provision:vi.fn(),grant});
 expect(grant).toHaveBeenCalledTimes(1);
});

test('activation recovery does not provision a tenant when no provisioner is supplied', async () => {
 const { recoverActivations } = await import('./activation.js');
 const user = await db.user.push({ id: 'u', username: 'new-user', emailVerified: true, tenantStatus: 'pending' });
 const provision = vi.fn();
 db.user.all = () => db.user.rows;
 await recoverActivations(db, { grant: vi.fn() });
 expect(user.tenantStatus).toBe('pending');
 expect(provision).not.toHaveBeenCalled();
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
