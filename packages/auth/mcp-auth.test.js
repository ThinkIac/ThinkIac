import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMcpAuth } from './mcp-auth.js';
test('dedicated credentials are hashed, expire, revoke, and enforce tool scopes', async () => {
 const dir=mkdtempSync(join(tmpdir(),'mcp-auth-'));
 try {
 const auth=createMcpAuth({ directory:dir, resolveUser:async id=>({id,role:'admin',tenantId:'tenant',emailVerified:true}), canAccess:async()=>true });
 const issued=auth.issue({userId:'user',tenantId:'tenant',scopes:['mcp:connect','mcp:tools:read','mcp:tool:agenda.list'],ttlMs:60000});
 assert.ok(!readFileSync(join(dir,'credentials.json'),'utf8').includes(issued.token));
 const identity=await auth.authenticate(issued.token);
 assert.equal(identity.principal.subject,'user');
 assert.equal(await auth.authorize(identity,{qualifiedName:'agenda.list'}),true);
 assert.equal(await auth.authorize(identity,{qualifiedName:'auth.delete'}),false);
 assert.equal(await auth.authenticate('tiac.llm.secret'),null);
 auth.revoke(issued.credentialId);
 assert.equal(await auth.authenticate(issued.token),null);
 const expired=auth.issue({userId:'user',tenantId:'tenant',scopes:['mcp:connect'],ttlMs:1});
 await new Promise(r=>setTimeout(r,5)); assert.equal(await auth.authenticate(expired.token),null);
 } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('user removal, tenant changes and entitlement denial invalidate access',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'mcp-auth-')); let user={id:'u',tenantId:'t',emailVerified:true};
 try {
 const auth=createMcpAuth({directory:dir,resolveUser:async()=>user,canAccess:async()=>false});
 const issued=auth.issue({userId:'u',tenantId:'t',scopes:['mcp:connect','mcp:tool:agenda.list']});
 const identity=await auth.authenticate(issued.token);
 assert.equal(await auth.authorize(identity,{qualifiedName:'agenda.list'}),false);
 user={...user,tenantId:'other'}; assert.equal(await auth.authenticate(issued.token),null);
 user=null; assert.equal(await auth.authenticate(issued.token),null);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
