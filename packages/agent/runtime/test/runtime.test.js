import test from 'node:test'
import assert from 'node:assert/strict'
import { AgentRegistry, createAgentExecutor, createAgentHost, createAgentRuntime, normalizeAgentEvent, validateAgainstSchema } from '../index.js'

function adapter() { const handlers = new Set(); return { request: (path) => path, on: (handler) => { handlers.add(handler); return () => handlers.delete(handler) }, emit: (message) => handlers.forEach((handler) => handler(message)) } }

test('registry mantém contrato independente do host', () => {
  const registry = new AgentRegistry({ definitions: [{ id: 'agent', adapter: adapter() }], defaultAgentId: 'agent' })
  assert.equal(registry.defaultAgentId, 'agent')
  assert.deepEqual(registry.list().map((item) => item.id), ['agent'])
  assert.equal(registry.resolve('inexistente').id, 'agent')
})
test('runtime encaminha eventos normalizados com identidade do agente', () => {
  const agent = adapter(); const runtime = createAgentRuntime({ definitions: [{ id: 'agent', adapter: agent }], defaultAgentId: 'agent' }); let received
  runtime.on((event) => { received = event }); agent.emit({ type: 'chat:event', event: 'token', data: { text: 'oi' } })
  assert.equal(received.agentId, 'agent'); assert.equal(received.type, 'agent.run.delta'); assert.equal(normalizeAgentEvent('agent', { type: 'sessions:updated' }).type, 'agent.session.updated')
})

test('AgentHost expõe apenas portas neutras e preserva o adapter injetado', async () => {
  const calls = []
  const host = createAgentHost({
    events: { call: async (...args) => { calls.push(args); return { ok: true } } },
    sockets: { pushToSession: (sessionId, payload) => ({ sessionId, payload }) },
    storage: { getProxy: (name) => ({ name }) },
  })
  assert.deepEqual(await host.events.call('agent.run.started', { id: 'r1' }), { ok: true })
  assert.deepEqual(calls, [['agent.run.started', { id: 'r1' }]])
  assert.deepEqual(host.sockets.pushToSession('s1', { type: 'delta' }), { sessionId: 's1', payload: { type: 'delta' } })
  assert.deepEqual(host.storage.getProxy('bags'), { name: 'bags' })
})

test('executor portátil usa portas injetadas para modelo, tools e trace', async () => {
  const events = []; let calls = 0
  const executor = createAgentExecutor({
    callModel: async () => (++calls === 1 ? { success: true, tool_calls: [{ id: '1', name: 'add', input: { a: 2, b: 3 } }] } : { success: true, text: '5', model: 'test' }),
    resolveTools: async () => [{ name: 'add', inputSchema: {}, handler: ({ a, b }) => a + b }],
    emitTrace: async (event) => events.push(event),
  })
  const result = await executor.run({ goal: 'some' })
  assert.equal(result.success, true); assert.equal(result.text, '5'); assert.equal(result.steps, 2)
  assert.deepEqual(events.map((event) => event.type), ['tool_calls', 'tool_result', 'final'])
})

test('executor conserva uso e custo da chamada do modelo no resultado', async () => {
  const executor = createAgentExecutor({
    callModel: async () => ({ success: true, text: 'ok', model: 'm', usage: { prompt_tokens: 3, completion_tokens: 2 } }),
    estimateCost: (_model, usage) => usage.total_tokens * 0.001,
  })
  const result = await executor.run({ goal: 'x' })
  assert.deepEqual(result.usage, { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 })
  assert.equal(result.costUsd, 0.005)
})

test('executor valida saída estruturada e encadeia execuções sem host específico', async () => {
  const answers = ['nope', '{"answer":"ok"}', 'chain']
  const executor = createAgentExecutor({ callModel: async () => ({ success: true, text: answers.shift() }) })
  const structured = await executor.run({
    goal: 'json', outputSchema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] },
  })
  assert.deepEqual(structured.output, { answer: 'ok' }); assert.equal(structured.steps, 2)
  const chain = await executor.runChain([{ name: 'one', input: 'first' }])
  assert.equal(chain.results.one.text, 'chain')
})

test('executor anexa identidade monotônica e motivo terminal sem quebrar eventos legados', async () => {
  const events = []
  const executor = createAgentExecutor({
    callModel: async () => ({ success: true, text: 'feito' }),
    emitTrace: async (event) => events.push(event),
  })
  const result = await executor.run({ workflow: { runId: 'run-1', taskId: 'task-1', phase: 'checked' } })
  assert.equal(result.terminalReason, 'completed')
  assert.equal(events[0].type, 'final')
  assert.equal(events[0].runId, 'run-1')
  assert.equal(events[0].taskId, 'task-1')
  assert.equal(events[0].phase, 'checked')
  assert.equal(events[0].sequence, 0)
})

test('executor aplica orçamento de tool calls e hooks neutros', async () => {
  let modelCalls = 0
  const hooks = []
  const executor = createAgentExecutor({
    callModel: async () => ({ success: true, tool_calls: [{ id: String(++modelCalls), name: 'touch', input: {} }] }),
    beforeTool: async () => hooks.push('before'),
    afterTool: async () => { hooks.push('after'); return { phase: 'changed' } },
  })
  const result = await executor.run({
    tools: [{ name: 'touch', inputSchema: {}, handler: async () => ({ success: true }) }],
    workflow: { runId: 'run-budget', budget: { maxSteps: 4, maxToolCalls: 1 } },
  })
  assert.equal(result.terminalReason, 'budget_exhausted')
  assert.deepEqual(hooks, ['before', 'after'])
  assert.equal(result.phase, 'changed')
  assert.equal(result.trace.at(-1).type, 'budget_exhausted')
})

test('executor externaliza resultado extenso e redige trace pelo host', async () => {
  let calls = 0
  const persisted = []
  const executor = createAgentExecutor({
    callModel: async () => (++calls === 1 ? { success: true, tool_calls: [{ id: '1', name: 'large', input: {} }] } : { success: true, text: 'ok' }),
    persistArtifact: async (artifact) => { persisted.push(artifact); return { id: 'artifact:1' } },
    redactTrace: async (event) => JSON.parse(JSON.stringify(event).replaceAll('secret', '[REDACTED]')),
  })
  const result = await executor.run({
    tools: [{ name: 'large', inputSchema: {}, handler: async () => ({ value: 'secret'.repeat(100) }) }],
    workflow: { artifactThresholdBytes: 20 },
  })
  assert.equal(persisted.length, 1)
  assert.equal(result.trace[1].result.artifactRef, 'artifact:1')
  assert.doesNotMatch(JSON.stringify(result.trace), /secret/)
})

test('validador de schema cobre objetos aninhados, arrays, enum e const', () => {
  const schema = { type: 'object', required: ['protocol', 'items'], properties: { protocol: { const: 'v1' }, items: { type: 'array', minItems: 1, items: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['ok'] } } } } } }
  assert.equal(validateAgainstSchema({ protocol: 'v1', items: [{ status: 'ok' }] }, schema), null)
  assert.match(validateAgainstSchema({ protocol: 'v1', items: [{ status: 'bad' }] }, schema), /one of/)
})
