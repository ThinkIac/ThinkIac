import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCodexAppServer } from './codex_app_server.js'
import { configuredCliTimeout } from './llm.js'

test('timeout do pool preserva null para desativar o limite configurável', () => {
  assert.equal(configuredCliTimeout({ timeout_ms: null }), null)
  assert.equal(configuredCliTimeout({ timeout_ms: 45_000 }), 45_000)
  assert.equal(configuredCliTimeout({}), undefined)
})

const fixture = `
import { createInterface } from 'node:readline';
const send = message => process.stdout.write(JSON.stringify(message)+'\\n');
createInterface({input:process.stdin}).on('line', line => {
 const m=JSON.parse(line);
 if(m.method==='initialize') send({id:m.id,result:{}});
 if(m.method==='thread/start') send({id:m.id,result:{thread:{id:'thread-1'}}});
 if(m.method==='turn/start') {
   send({id:m.id,result:{turn:{id:'turn-1'}}});
   if(process.env.FAIL_BEFORE_ACTION) {
     send({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'failed',error:{message:"You've hit your usage limit. Try again in 2 hours."}}}});
     return;
   }
   if(process.env.SKIP_APPROVAL) {
     send({method:'item/completed',params:{threadId:'thread-1',item:{id:'msg',type:'agentMessage',text:process.cwd()}}});
     send({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'completed'}}});
     return;
   }
   if(process.env.MCP_TOOL) {
     send({method:'item/started',params:{threadId:'thread-1',item:{id:'mcp-1',type:'mcpToolCall',tool:'read_file',arguments:{path:'a.js'}}}});
     send({method:'item/completed',params:{threadId:'thread-1',item:{id:'mcp-1',type:'mcpToolCall',tool:'read_file',aggregatedOutput:'ok'}}});
     send({method:'item/completed',params:{threadId:'thread-1',item:{id:'msg',type:'agentMessage',text:'done'}}});
     send({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'completed'}}});
     return;
   }
   send({method:'item/started',params:{threadId:'thread-1',item:{id:'item-1',type:'commandExecution',command:'native-action'}}});
   send({id:100,method:'item/commandExecution/requestApproval',params:{threadId:'thread-1',turnId:'turn-1',itemId:'item-1',command:'native-action'}});
 }
 if(m.id===100 && m.result) {
   send({method:'item/completed',params:{threadId:'thread-1',item:{id:'msg',type:'agentMessage',text:m.result.decision}}});
   send({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:process.env.FAIL_TURN?'failed':'completed',error:{message:'quota exhausted'}}}});
 }
});`

async function withFixture(fn) {
  const cwd = await mkdtemp(join(tmpdir(), 'agent-codex-rpc-'))
  const script = join(cwd, 'server.mjs')
  await writeFile(script, fixture)
  try { await fn({ bin: process.execPath, args: [script], cwd, input: 'test', timeoutMs: 3000 }) }
  finally { await rm(cwd, { recursive: true, force: true }) }
}
for (const decision of ['accept', 'decline']) {
  test(`RPC espera aprovação e responde ${decision}`, () => withFixture(async options => {
    const events = []
    const result = await runCodexAppServer({ ...options, sessionId: 'session-1', onProgress: event => events.push(event),
      requestApproval: async (request, context) => {
        assert.equal(context.sessionId, 'session-1')
        assert.equal(request.params.item.command, 'native-action')
        await new Promise(resolve => setTimeout(resolve, 10))
        return { decision }
      },
    })
    assert.equal(result.choices[0].message.content, decision)
    assert.equal(events[0].type, 'tool-step')
    assert.equal(events[0].itemId, 'item-1')
    assert.equal(events[0].origin, 'codex-native')
    assert.equal(events[0].governed, false)
  }))
}
test('limite antes de ação permite failover e sai classificado', () => withFixture(async options => {
  await assert.rejects(runCodexAppServer({ ...options, env: { FAIL_BEFORE_ACTION: '1' } }), error => {
    assert.equal(error.failureKind, 'credit')
    assert.equal(error.noRetry, false)
    return /usage limit/i.test(error.message)
  })
}))
test('modo nativo preserva a marcação observada para ações do Codex', () => withFixture(async options => {
  const events = []
  await runCodexAppServer({ ...options, sessionId: 'session-1', executionMode: 'codex-native',
    onProgress: event => events.push(event), requestApproval: async () => ({ decision: 'accept' }),
  })
  assert.equal(events[0].origin, 'codex-native')
  assert.equal(events[0].governed, false)
}))
test('tools MCP do modo padrão são marcadas como governadas pelo Runtime', () => withFixture(async options => {
  const events = []
  const result = await runCodexAppServer({ ...options, env: { MCP_TOOL: '1' }, sessionId: 'session-1', onProgress: event => events.push(event) })
  assert.equal(result.choices[0].message.content, 'done')
  assert.deepEqual(events.map(event => [event.origin, event.governed]), [['runtime', true], ['runtime', true]])
}))
test('falha depois de iniciar ação impede reexecução em outra conta', () => withFixture(async options => {
  await assert.rejects(runCodexAppServer({ ...options,
    env: { FAIL_TURN: '1' }, requestApproval: async () => ({ decision: 'accept' }),
  }), error => {
    assert.equal(error.noRetry, true)
    return /quota exhausted/.test(error.message)
  })
}))
test('cancelamento termina processo e pedido de aprovação', () => withFixture(async options => {
  const controller = new AbortController()
  let lifecycle
  await assert.rejects(runCodexAppServer({ ...options, signal: controller.signal,
    requestApproval: async (_, { signal }) => {
      lifecycle = signal
      controller.abort()
      return { decision: 'decline' }
    },
  }), /cancelado/)
  assert.equal(lifecycle.aborted, true)
}))
test('espera humana não consome timeout de execução', () => withFixture(async options => {
  const result = await runCodexAppServer({ ...options, timeoutMs: 500,
    requestApproval: async () => {
      await new Promise(resolve => setTimeout(resolve, 650))
      return { decision: 'accept' }
    },
  })
  assert.equal(result.choices[0].message.content, 'accept')
}))

test('provider conecta sessão auto, overrides por chamada, cwd e credencial MCP', () => withFixture(async options => {
  const { runCliSlot } = await import('./llm.js')
  const { buildSlots } = await import('./llm_keys.js')
  const { setPoliciesForTest } = await import('../../governance/lib/policy.js')
  setPoliciesForTest({ 'provider-test': { mode: 'auto', preset: 'read_only', updatedAt: '2026-01-01' } })
  const [slot] = buildSlots({ llm: { pools: [{ name: 'codex-test', provider: 'codex-cli', enabled: true,
    cli: { sandbox: 'danger-full-access', approval_policy: 'never' } }] } })
  const build = slot.cli.buildArgs
  let observed
  slot.cli.bin = process.execPath
  slot.cli.buildArgs = (model, opts, ctx) => {
    observed = { args: build(model, opts, ctx), ctx }
    return [...options.args, ...observed.args]
  }
  const result = await runCliSlot(slot, null, {
    messages: [{ role: 'user', content: 'probe' }], cwd: options.cwd, sessionId: 'provider-test',
    cliOpts: { sandbox: 'auto', approval_policy: 'on-request', turnToolsToken: 'turn-test-token' },
    extraEnv: { SKIP_APPROVAL: '1', THINKIAC_MCP_TOKEN: 'provider-test-token' },
  })
  assert.equal(result.choices[0].message.content, options.cwd)
  assert.ok(observed.args.includes('sandbox_mode="workspace-write"'))
  assert.ok(observed.args.includes('approval_policy="on-request"'))
  assert.equal(observed.ctx.sessionPolicy.mode, 'auto')
  assert.equal(observed.ctx.mcpEnv.THINKIAC_MCP_TOKEN, 'provider-test-token')
  assert.equal(observed.ctx.mcpEnv.AGENT_SESSION_ID, 'provider-test')
  assert.equal(observed.ctx.mcpEnv.AGENT_TURN_TOOLS_TOKEN, 'turn-test-token')
  assert.ok(observed.args.some(arg=>arg.includes('AGENT_TURN_TOOLS_TOKEN')))
  assert.ok(observed.ctx.mcpEnv.AGENT_SESSION_TOKEN)
}))
