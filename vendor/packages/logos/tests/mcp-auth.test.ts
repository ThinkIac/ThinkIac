import { it, expect, afterEach } from 'vitest';
import { Container } from '../src/kernel/container';
import { makeWorkspace } from './helpers';
import { mcpApi } from './mcp-module';
const cleanup: any[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0)) await fn(); });
async function boot(extra: any = {}) {
 const ws = makeWorkspace(); cleanup.push(() => ws.cleanup());
 const events: any[] = [];
 const auth = { authenticate: async (token: string) => token === 'invalid' ? null : ({ credentialId: token, principal: { subject: 'user' }, tenantId: 'tenant', scopes: ['mcp:connect', 'mcp:tools:read'], expiresAt: Date.now()+60000 }), authorize: async () => true, audit: (e: any) => events.push(e) };
 const c = new Container({ workspace: ws.root });
 const { server } = await mcpApi(extra.container || c).createMcpHttpServer({ workspace: ws.root, port: 0, auth, ...extra });
 cleanup.unshift(() => new Promise(r => server.close(r)));
 return { base: `http://127.0.0.1:${server.address().port}`, server, events };
}
it('requires authentication on every endpoint and binds loopback', async () => {
 const {base, server} = await boot(); expect(server.address().address).toBe('127.0.0.1');
 for (const [path, method] of [['/mcp','GET'],['/mcp/tools','GET'],['/mcp/call','POST'],['/mcp/session','POST']]) {
  expect((await fetch(base+path,{method})).status).toBe(401);
  expect((await fetch(base+path,{method, headers:{Authorization:'Bearer invalid'}})).status).toBe(401);
 }
});
it('binds issued sessions to credentials and ignores forged legacy ids', async () => {
 const {base} = await boot();
 const headers = { Authorization:'Bearer one', 'Content-Type':'application/json' };
 const session = await (await fetch(base+'/mcp/session',{method:'POST',headers})).json();
 expect(session.sessionId.length).toBeGreaterThan(30);
 for (const h of [{}, {'x-session-id':'fake'}, {'mcp-session-id':session.sessionId, Authorization:'Bearer two'}]) {
  expect((await fetch(base+'/mcp/call',{method:'POST',headers:{...headers,...h},body:JSON.stringify({name:'x',sessionId:'fake'})})).status).toBe(401);
 }
});
it('limits requests and audits without secrets', async () => {
 const {base, events} = await boot({maxRequestsPerMinute:1});
 await fetch(base+'/mcp',{headers:{Authorization:'Bearer secret'}});
 expect((await fetch(base+'/mcp')).status).toBe(429);
 await new Promise(r=>setTimeout(r,10));
 expect(JSON.stringify(events)).not.toContain('Bearer');
 expect(events[0]).toMatchObject({status:200,principal:'user'});
});
it('rejects accidental remote exposure', async () => {
 await expect(mcpApi(new Container()).createMcpHttpServer({host:'0.0.0.0'})).rejects.toThrow('allowRemote');
});
it('filters discovery and denies execution outside scope without running handlers', async () => {
 const ws=makeWorkspace(); cleanup.push(()=>ws.cleanup());
 const c=new Container({workspace:ws.root}); let ran=0;
 c.state('tools').set('kernel',[
  {name:'allowed',qualifiedName:'pkg.allowed',handler:async()=>++ran},
  {name:'hidden',qualifiedName:'pkg.hidden',handler:async()=>++ran},
  {name:'conditional',qualifiedName:'pkg.conditional',condition:{only:['unavailable']},handler:async()=>++ran},
 ]);
 const auth={authenticate:async()=>({credentialId:'one',principal:{subject:'user'},scopes:['mcp:connect','mcp:tools:read'],expiresAt:Date.now()+60000}),authorize:async (_:any,t:any)=>t.name!=='hidden'};
 const {base}=await boot({container:c,auth});
 const headers={Authorization:'Bearer one','Content-Type':'application/json'};
 expect((await (await fetch(base+'/mcp/tools',{headers})).json()).map((t:any)=>t.name)).toEqual(['allowed']);
 const session=await (await fetch(base+'/mcp/session',{method:'POST',headers})).json();
 for(const name of ['hidden','conditional']) expect((await fetch(base+'/mcp/call',{method:'POST',headers:{...headers,'mcp-session-id':session.sessionId},body:JSON.stringify({name})})).status).toBe(403);
 expect(ran).toBe(0);
});
it('rejects expired sessions, changed principals and tenants',async()=>{
 let subject='u';let tenant='t';
 const auth={authenticate:async()=>({credentialId:'one',principal:{subject},tenantId:tenant,scopes:['mcp:connect'],expiresAt:Date.now()+60000}),authorize:async()=>true};
 const {base}=await boot({auth,sessionTtlMs:80}); const headers={Authorization:'Bearer one'};
 const session=await (await fetch(base+'/mcp/session',{method:'POST',headers})).json();
 const invoke=()=>fetch(base+'/mcp/call',{method:'POST',headers:{...headers,'mcp-session-id':session.sessionId}});
 subject='other';expect((await invoke()).status).toBe(401);subject='u';tenant='other';expect((await invoke()).status).toBe(401);tenant='t';
 await new Promise(r=>setTimeout(r,85));expect((await invoke()).status).toBe(401);
});
it('fails closed without adapter or with policy errors',async()=>{
 for(const auth of [undefined,{authenticate:async()=>{throw Error('secret')},authorize:async()=>true}]){
  const {base}=await boot({auth});const res=await fetch(base+'/mcp',{headers:{Authorization:'Bearer one'}});
  expect(res.status).toBe(503);expect(await res.text()).not.toContain('secret');
 }
});
it('requires connect and read scopes independently',async()=>{
 let scopes:string[]=[];
 const auth={authenticate:async()=>({credentialId:'one',principal:{subject:'u'},scopes,expiresAt:Date.now()+60000}),authorize:async()=>true};
 const {base}=await boot({auth});const headers={Authorization:'Bearer one'};
 expect((await fetch(base+'/mcp',{headers})).status).toBe(403);
 scopes=['mcp:connect'];expect((await fetch(base+'/mcp',{headers})).status).toBe(200);
 expect((await fetch(base+'/mcp/tools',{headers})).status).toBe(403);
});
