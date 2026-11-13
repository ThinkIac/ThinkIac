import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'

for (const unavailable of [false, true]) {
  test(`MCP stdio autenticado: servidor HTTP ${unavailable ? 'indisponível' : 'disponível'}`, async () => {
    const seen = []
    const server = createServer(async (req, res) => {
      let raw = ''
      for await (const chunk of req) raw += chunk
      seen.push({ url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null })
      res.setHeader('Content-Type', 'application/json')
      if (unavailable) { res.statusCode = 503; res.end(JSON.stringify({ error: 'test offline' })); return }
      if (req.url === '/mcp/tools') res.end(JSON.stringify([{ name: 'probe', description: 'test', inputSchema: { type: 'object' } }]))
      else if (req.url === '/mcp/session') res.end(JSON.stringify({ sessionId: 'issued-test-session', expiresAt: Date.now() + 60000 }))
      else res.end(JSON.stringify({ result: 'session-bound-ok' }))
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const transport = new StdioClientTransport({ command: process.execPath,
      args: [fileURLToPath(new URL('./mcp_server.js', import.meta.url))], stderr: 'pipe',
      env: { ...process.env, AGENT_MCP_HTTP_URL: `http://127.0.0.1:${server.address().port}`,
        THINKIAC_MCP_TOKEN: 'integration-test-token', AGENT_SESSION_ID: 'chat-test' },
    })
    let stderr = ''
    transport.stderr?.on('data', chunk => { stderr += chunk })
    const client = new Client({ name: 'integration-test', version: '1.0.0' })
    try {
      await client.connect(transport)
      const listed = await client.listTools()
      assert.ok(listed.tools.some(tool => tool.name === 'say_to_user'))
      if (!unavailable) {
        assert.ok(listed.tools.some(tool => tool.name === 'probe'))
        const result = await client.callTool({ name: 'probe', arguments: {} })
        assert.equal(result.isError, undefined)
        const call = seen.find(req => req.url === '/mcp/call')
        assert.equal(call.headers['mcp-session-id'], 'issued-test-session')
      } else {
        assert.equal(listed.tools.length, 2)
        assert.doesNotMatch(stderr, /ReferenceError|MCP_HTTP_URL is not defined/)
      }
      assert.ok(seen.length > 0)
      for (const req of seen) assert.equal(req.headers.authorization, 'Bearer integration-test-token')
    } finally {
      await client.close()
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
    }
  })
}

test('MCP do turno lista e chama ferramentas sem credencial MCP global',async()=>{
 const {openTurnTools,getTurnTools}=await import('../core/turn_tools.js');
 const calls=[];
 const bridge=openTurnTools('andar-agent-test',[{name:'delegateAndarSpecialist',input_schema:{type:'object',properties:{message:{type:'string'}}}}],async(name,args)=>{calls.push({name,args});return {memberId:'test-member'};});
 const server=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  res.setHeader('Content-Type','application/json');
  const turn=getTurnTools(String(req.headers.authorization).replace('Bearer ',''));
  if(req.url!=='/agent/session/tools'||!turn){res.statusCode=403;res.end(JSON.stringify({success:false}));return;}
  const body=JSON.parse(raw);
  try{res.end(JSON.stringify(body.operation==='list'?{success:true,tools:turn.tools}:{success:true,result:await turn.call(body.name,body.args)}));}
  catch(e){res.statusCode=400;res.end(JSON.stringify({success:false,error:e.message}));}
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('./mcp_server.js',import.meta.url))],stderr:'pipe',env:{...process.env,THINKIAC_MCP_TOKEN:'',AGENT_TURN_TOOLS_TOKEN:bridge.token,AGENT_BASE_URL:`http://127.0.0.1:${server.address().port}`}});
 const client=new Client({name:'test',version:'1'});
 try{
  await client.connect(transport);
  const listed=(await client.listTools()).tools;
  assert.deepEqual(listed.map(t=>t.name),['delegateAndarSpecialist']);
  const result=await client.callTool({name:'delegateAndarSpecialist',arguments:{message:'Faça'}});
  assert.equal(result.isError,undefined);assert.match(result.content[0].text,/test-member/);assert.equal(calls.length,1);
  assert.equal((await client.callTool({name:'deleteTask',arguments:{}})).isError,true);
  assert.equal((await client.callTool({name:'say_to_user',arguments:{message:'escape'}})).isError,true);
  bridge.close();assert.equal((await client.callTool({name:'delegateAndarSpecialist',arguments:{}})).isError,true);
 }finally{bridge.close();await client.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('modelo real chama ferramenta vinculada ao turno sem MCP global', {skip:process.env.AGENT_TURN_TOOLS_LIVE!=='1',timeout:120000},async()=>{
 const {openTurnTools,getTurnTools}=await import('../core/turn_tools.js');
 const {runCliSlot}=await import('./llm.js');const {buildSlots}=await import('./llm_keys.js');
 const {randomUUID}=await import('node:crypto');
 const nonce=randomUUID();let calls=0;
 const bridge=openTurnTools('turn-live',[{name:'checkRoomTools',description:'Read-only test of room tool access. Returns verification code.',input_schema:{type:'object',properties:{}}}],async()=>{calls++;return {verification:nonce};});
 const server=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  res.setHeader('Content-Type','application/json');
  const turn=getTurnTools(String(req.headers.authorization).replace('Bearer ',''));
  if(req.url!=='/agent/session/tools'||!turn){res.statusCode=403;res.end(JSON.stringify({success:false}));return;}
  const body=JSON.parse(raw);
  try{res.end(JSON.stringify(body.operation==='list'?{success:true,tools:turn.tools}:{success:true,result:await turn.call(body.name,body.args)}));}
  catch(e){res.statusCode=400;res.end(JSON.stringify({success:false,error:e.message}));}
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const [slot]=buildSlots({llm:{pools:[{name:'turn-live',provider:'codex-cli',enabled:true,cli:{sandbox:'read-only',approval_policy:'never'}}]}});
  const result=await runCliSlot(slot,null,{messages:[{role:'user',content:'Call the MCP tool checkRoomTools once, then reply with only its verification code. This is a read-only integration test. Do not read or modify files or call other tools.'}],cliOpts:{turnToolsToken:bridge.token,timeout_ms:90000},extraEnv:{THINKIAC_MCP_TOKEN:'',AGENT_BASE_URL:`http://127.0.0.1:${server.address().port}`}});
  assert.equal(calls,1);assert.ok(result.choices[0].message.content.includes(nonce));
 }finally{bridge.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
