import test from 'node:test';
import assert from 'node:assert/strict';
import { createMcpHttpClient } from './mcp_http_client.js';
test('client authenticates listing and shares a server-issued session for parallel calls',async()=>{
 const seen=[];
 const client=createMcpHttpClient({token:'secret',fetchImpl:async(url,options)=>{
  seen.push({url,...options});
  const value=url.endsWith('/session')?{sessionId:'issued',expiresAt:Date.now()+60000}:url.endsWith('/tools')?[]:{result:'ok'};
  return {ok:true,json:async()=>value};
 }});
 await client.listTools();
 assert.deepEqual(await Promise.all([client.callTool('a',{sessionId:'forged'}),client.callTool('a',{})]),['ok','ok']);
 assert.equal(seen.filter(x=>x.url.endsWith('/session')).length,1);
 for(const req of seen){assert.equal(req.headers.Authorization,'Bearer secret');assert.equal(req.redirect,'error');}
 for(const req of seen.filter(x=>x.url.endsWith('/call')))assert.equal(req.headers['mcp-session-id'],'issued');
});
test('client retries only pre-execution INVALID_SESSION, preserves approval errors',async()=>{
 let calls=0;let sessions=0;
 const client=createMcpHttpClient({token:'secret',fetchImpl:async(url)=>{
  if(url.endsWith('/session'))return {ok:true,json:async()=>({sessionId:String(++sessions),expiresAt:Date.now()+60000})};
  calls++;return {ok:false,status:calls===1?401:409,json:async()=>({code:calls===1?'INVALID_SESSION':'CONFIRMATION_REQUIRED',decisionId:'decision'})};
 }});
 await assert.rejects(client.callTool('a',{}),e=>e.code==='CONFIRMATION_REQUIRED'&&e.decisionId==='decision');
 assert.equal(calls,2);assert.equal(sessions,2);
});
test('missing credentials fail locally before sending traffic',async()=>{
 const client=createMcpHttpClient({token:'',fetchImpl:async()=>assert.fail('must not fetch')});
 await assert.rejects(client.listTools(),/THINKIAC_MCP_TOKEN/);
});
