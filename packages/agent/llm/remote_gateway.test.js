import { test, expect, vi, beforeEach } from 'vitest';
const { config, events, runCliSlot } = vi.hoisted(()=>({ config:{ llm:{ pools:[] } },events:vi.fn(),runCliSlot:vi.fn() }));
const httpPool=()=>({id:'primary',provider:'openrouter',enabled:true,api_keys:['fixture-key'],base_url:'https://provider.test/v1',model:'fixture/model',capabilities:{tools:{supported:true},streaming:true}});
const cliPool=(remote_api)=>({id:'codex-engineer',provider:'codex-cli',enabled:true,remote_api,remote_api_priority:100,model:'gpt-5.6-terra',capabilities:{tools:{supported:true},streaming:true}});
vi.mock('../utils/config.js',()=>({getConfig:()=>config,getDefaultModel:()=> 'fixture/model',getEmbedModel:()=> 'fixture/model'}));
vi.mock('../host/agent_host.js',()=>({eventCall:events}));
vi.mock('./llm.js',()=>({runCliSlot}));
vi.mock('./providers/ollama.js',()=>({applyOllamaDiscovery:c=>c,refreshOllamaDiscovery:async c=>c}));
vi.mock('./terminal_accounts.js',()=>({
 discoverTerminalCodexModels:()=>[],
 mergeWithTerminalAccounts:accounts=>accounts,
 mergeWithTerminalCodexAccounts:accounts=>accounts,
 mergeWithTerminalAntigravityAccounts:accounts=>accounts,
 mergeWithTerminalOpencodeAccounts:accounts=>accounts,
}));
import { onLlmCall, routeRemoteLlm } from './llm2.js';
beforeEach(()=>{vi.clearAllMocks();config.llm.pools=[httpPool()];});
test('Auto resolves an enabled HTTP pool with actual catalog access mode',async()=>{
 const route=await routeRemoteLlm({requirements:{requires:{tools:true}}});
 expect(route.success).toBe(true);expect(route.pool).toBe('primary');expect(route.model).toBe('fixture/model');
});
test('remote API excludes an HTTP pool explicitly disabled for Orbit',async()=>{
 config.llm.pools=[{...httpPool(),remote_api:false}];
 expect((await routeRemoteLlm({requirements:{requires:{tools:true}}})).success).toBe(false);
});
test('remote API exposes only CLI pools with explicit remote_api opt-in',async()=>{
 config.llm.pools=[cliPool(false)];
 expect((await routeRemoteLlm({requirements:{requires:{tools:true}}})).success).toBe(false);
 config.llm.pools=[cliPool(true)];
 const route=await routeRemoteLlm({requirements:{requires:{tools:true}}});
 expect(route.success).toBe(true);expect(route.pool).toBe('codex-engineer');expect(route.model).toBe('gpt-5.6-terra');
});
test('remote API can execute the opted-in Codex pool without resolving message paths',async()=>{
 config.llm.pools=[cliPool(true)];
 runCliSlot.mockResolvedValue({model:'gpt-5.6-terra',choices:[{message:{content:'CODEX_OK'},finish_reason:'stop'}],usage:{prompt_tokens:3,completion_tokens:1}});
 const route=await routeRemoteLlm({requirements:{requires:{tools:true}}});
 const result=await onLlmCall({model:route.model,pool:route.pool,messages:[{role:'user',content:'/etc/passwd'}],remoteRequest:true,sessionId:'provider:test'});
 expect(result.success).toBe(true);expect(result.text).toBe('CODEX_OK');
 expect(runCliSlot).toHaveBeenCalledWith(expect.objectContaining({poolName:'codex-engineer'}),'gpt-5.6-terra',expect.objectContaining({messages:[{role:'user',content:'/etc/passwd'}],sessionId:'provider:test'}));
});
test('remote API priority makes opted-in Codex win Orbit auto without changing local auto',async()=>{
 config.llm.pools=[httpPool(),cliPool(true)];
 const route=await routeRemoteLlm({requirements:{requires:{tools:true}}});
 expect(route.success).toBe(true);expect(route.pool).toBe('codex-engineer');
});
test('gateway routes restrict routing to an exact configured pool and model',async()=>{
 config.llm.pools=[httpPool(),cliPool(false)];
 const route=await routeRemoteLlm({gatewayRoutes:[{poolId:'codex-engineer',modelId:'gpt-5.6-terra',enabled:true,priority:10}],requirements:{requires:{tools:true}}});
 expect(route.success).toBe(true);expect(route.pool).toBe('codex-engineer');expect(route.model).toBe('gpt-5.6-terra');
});
test('stream forwards options, tool deltas, final usage-only chunk and session identity',async()=>{
 const sent=[];
 const original=globalThis.fetch;
 globalThis.fetch=vi.fn(async(_url,options)=>{
   const body=JSON.parse(options.body);sent.push(body);
   const chunks=[{choices:[{index:0,delta:{content:'oi'}}]}, {choices:[{index:0,delta:{tool_calls:[{index:0,id:'tool1',type:'function',function:{name:'lookup',arguments:'{}'}}]}}]}, {choices:[{index:0,delta:{},finish_reason:'tool_calls'}]}, {choices:[],usage:{prompt_tokens:4,completion_tokens:2,total_tokens:6,cost:0.001}}];
   return new Response(chunks.map(c=>'data: '+JSON.stringify(c)+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
 });
 try {
 const chunks=[];
 const result=await onLlmCall({model:'fixture/model',pool:'primary',messages:[{role:'user',content:'/etc/passwd'}],tools:[{name:'lookup',input_schema:{type:'object'}}],stream:true,remoteRequest:true,sessionId:'billing-proxy:c:test',requestOptions:{max_tokens:12,temperature:0,tool_choice:'auto'},onChunk:c=>chunks.push(c)});
 expect(result.success).toBe(true);expect(result.usage.total_tokens).toBe(6);expect(result.tool_calls[0].name).toBe('lookup');expect(result.finish_reason).toBe('tool_calls');
 expect(sent[0].max_tokens).toBe(12);expect(sent[0].temperature).toBe(0);expect(sent[0].messages.at(-1).content).toBe('/etc/passwd');
 expect(sent[0].stream_options.include_usage).toBe(true);expect(chunks).toHaveLength(4);
 expect(events).toHaveBeenCalledWith('agent:token:usage',expect.objectContaining({sessionId:'billing-proxy:c:test',usage:expect.objectContaining({total_tokens:6})}));
 }finally{globalThis.fetch=original;}
});
test('nonstream preserves finish reason and does not read message paths',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=vi.fn(async(_url,options)=>{
  expect(JSON.parse(options.body).messages.at(-1).content).toBe('/etc/passwd');
  return new Response(JSON.stringify({model:'fixture/model',choices:[{message:{content:'limited'},finish_reason:'length'}],usage:{prompt_tokens:5,completion_tokens:2}}));
 });
 try {const result=await onLlmCall({model:'fixture/model',pool:'primary',messages:[{role:'user',content:'/etc/passwd'}],remoteRequest:true,sessionId:'billing-proxy:c:test'});expect(result.success).toBe(true);expect(result.finish_reason).toBe('length');}
 finally{globalThis.fetch=original;}
});
