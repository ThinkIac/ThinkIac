import assert from 'node:assert/strict'
import { actionHash, classifyAction, describeCommand, isReadOnly, redact, structuredInput } from '../lib/engine.js'
import { onToolBefore } from '../hooks.js'

let passed = 0
async function test(name, fn) { await fn(); passed++; console.log(`PASS ${name}`) }

await test('allows read-only diagnostics', () => {
  assert.equal(classifyAction({ sessionId: 's1', tool: 'read_file', input: {} }).classification, 'safe')
  assert.equal(classifyAction({ sessionId: 's1', tool: 'run_runtime_tool', input: { package: 'tasks', tool: 'listTasks' } }).classification, 'safe')
})

await test('requires confirmation for state, external and cost actions', () => {
  assert.equal(classifyAction({ sessionId: 's1', tool: 'patch_file', input: {} }).classification, 'needs_confirmation')
  assert.equal(classifyAction({ sessionId: 's1', tool: 'run_runtime_tool', input: { package: 'ntfy', tool: 'sendNtfyNotification' } }).classification, 'needs_confirmation')
  assert.equal(classifyAction({ sessionId: 's1', tool: 'call_llm', input: {} }).classification, 'needs_confirmation')
})

await test('lets GeckoView navigation flow but gates explicit external effects', () => {
  for (const tool of ['browser_list_tabs', 'browser_get_page_state', 'browser_find', 'browser_navigate', 'browser_fill', 'browser_scroll']) {
    assert.equal(classifyAction({ sessionId: 's1', tool, input: {} }).classification, 'safe')
  }
  assert.equal(classifyAction({ sessionId: 's1', tool: 'browser_click', input: { name: 'Próxima página' } }).classification, 'safe')
  const external = classifyAction({ sessionId: 's1', tool: 'browser_click', input: { name: 'Publicar', allowExternalEffect: true } })
  assert.equal(external.classification, 'needs_confirmation')
  assert.equal(external.category, 'external')
})

await test('classifies local writes as changes even when reversible', () => {
  // O wrapper run_runtime_tool contém "run_" e antes casava com a regra de
  // execução, fazendo toda tool de runtime pedir confirmação.
  for (const tool of ['createTask', 'updateTransaction', 'registerPattern', 'setWorkspaceFocus', 'memory_remember', 'notebook_create_note']) {
    assert.equal(
      classifyAction({ sessionId: 's1', tool: 'run_runtime_tool', input: { package: 'p', tool } }).classification,
      'needs_confirmation',
      `${tool} deveria ser reconhecida como alteração`
    )
  }
})

await test('assigns a deterministic category to every action family', () => {
  assert.equal(classifyAction({ sessionId: 's1', tool: 'read_file' }).category, 'read')
  assert.equal(classifyAction({ sessionId: 's1', tool: 'patch_file' }).category, 'local_write')
  assert.equal(classifyAction({ sessionId: 's1', tool: 'delete_file' }).category, 'destructive')
  assert.equal(classifyAction({ sessionId: 's1', tool: 'run_shell' }).category, 'execution')
  assert.equal(classifyAction({ sessionId: 's1', tool: 'get_secret' }).category, 'sensitive')
  assert.equal(classifyAction({ sessionId: 's1', tool: 'request_tool_access', input: { tool_names: ['browser_find'] } }).category, 'capability_expansion')
  assert.equal(classifyAction({ sessionId: 's1', tool: 'request_tool_access', input: { tool_names: ['browser_find'] } }).classification, 'needs_confirmation')
})

await test('still confirms destructive, external and costly actions', () => {
  const cases = [
    ['deleteTask', 'needs_confirmation'],
    ['filemanage_move', 'needs_confirmation'],
    ['rebootAurora', 'needs_confirmation'],
    ['wp_publish_draft', 'needs_confirmation'],
    ['run_crew', 'needs_confirmation'],
    ['video_generate', 'needs_confirmation'],
    ['listTasks', 'safe']
  ]
  for (const [tool, expected] of cases) {
    assert.equal(
      classifyAction({ sessionId: 's1', tool: 'run_runtime_tool', input: { package: 'p', tool } }).classification,
      expected,
      `${tool} deveria classificar como ${expected}`
    )
  }
  assert.equal(classifyAction({ sessionId: 's1', tool: 'run_shell', input: {} }).classification, 'needs_confirmation')
})

await test('blocks secret and irreversible bypass actions', () => {
  assert.equal(classifyAction({ sessionId: 's1', tool: 'get_secret', input: {} }).classification, 'blocked')
  assert.equal(classifyAction({ sessionId: 's1', tool: 'run_runtime_tool', input: { package: 'file-manager', tool: 'filemanage_permanentDelete' } }).classification, 'blocked')
})

await test('redacts secret fields and binds approval to action', () => {
  assert.deepEqual(redact({ password: 'x', nested: { apiKey: 'y' } }), { password: '[redacted]', nested: { apiKey: '[redacted]' } })
  assert.notEqual(actionHash({ sessionId: 's1', tool: 'write_file', input: { path: 'a' } }), actionHash({ sessionId: 's1', tool: 'write_file', input: { path: 'b' } }))
  assert.equal(structuredInput({ id: 'd1', tool: 'write_file', reason: 'state' })[0].governanceDecisionId, 'd1')
})

await test('describes the real command and its parameters for the approval card', () => {
  const command = describeCommand({ sessionId: 's1', tool: 'run_runtime_tool', input: { package: 'ntfy', tool: 'sendNtfyNotification', args: { topic: 'ops', message: 'deploy', token: 'segredo' } } })
  assert.equal(command.command, 'ntfy.sendNtfyNotification')
  assert.deepEqual(command.params.map(p => p.name), ['topic', 'message', 'token'])
  assert.equal(command.params.find(p => p.name === 'token').value, '[redacted]')
  assert.ok(command.signature.includes('topic=ops'))
  // Valores longos são truncados, não jogados inteiros dentro do card.
  const long = describeCommand({ sessionId: 's1', tool: 'write_file', input: { content: 'x'.repeat(2000) } })
  assert.ok(long.params[0].value.length < 700)
  assert.equal(structuredInput({ id: 'd1', tool: 'write_file', reason: 'state' }, command)[0].command.command, 'ntfy.sendNtfyNotification')
})

await test('separates read-only actions from cheap local writes', () => {
  assert.equal(isReadOnly({ tool: 'read_file', input: {} }), true)
  assert.equal(isReadOnly({ tool: 'run_runtime_tool', input: { package: 'tasks', tool: 'listTasks' } }), true)
  // createTask é 'safe' no engine, mas altera estado: o modo manual precisa
  // conseguir distinguir os dois casos.
  assert.equal(isReadOnly({ tool: 'run_runtime_tool', input: { package: 'tasks', tool: 'createTask' } }), false)
})

await test('does not duplicate a decision for an action already gated by Aurora', async () => {
  const payload = { sessionId: 's1', tool: 'write_file', payload: { path: 'a' }, governed: true }
  assert.equal(await onToolBefore(payload), payload)
})

console.log(`\n${passed} tests passed`)
