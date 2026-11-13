// test/hooks.test.js — o hook tool_before é o gate das chamadas que NÃO passam
// pelo agentLoop (transporte MCP HTTP: Codex, Claude Code, `think agent:*`).
// Quando o bus dispara por veto(), devolver `veto: true` barra a tool, e o
// `code` é o que o transporte traduz em status HTTP.

import assert from 'node:assert/strict'
import { onToolBefore, resolveStructuredSubmission } from '../hooks.js'
import { resolveConfirmation, setGovernanceStoreForTest, setSessionPolicy } from '../service.js'
import { setPoliciesForTest } from '../lib/policy.js'

setPoliciesForTest({})

let passed = 0
async function test(name, fn) { await fn(); passed++; console.log(`PASS ${name}`) }

const rows = []
setGovernanceStoreForTest({
  governanceDecision: {
    async push(row) { const saved = { ...row, id: `d${rows.length + 1}` }; rows.push(saved); return saved },
    findOne(where) { return rows.find(row => Object.entries(where).every(([k, v]) => row[k] === v)) },
    query(where, { limit } = {}) { return rows.filter(row => Object.entries(where).every(([k, v]) => row[k] === v)).slice(0, limit) }
  }
})

const sessionId = `governance-hook-${Date.now()}`
setSessionPolicy({ sessionId, mode: 'manual' })

await test('submissão estruturada é resolvida pelo pacote e devolve continuidade genérica', async () => {
  const calls = []
  const notifications = []
  const out = await resolveStructuredSubmission({
    sessionId: 'session-structured',
    submissionId: 'submission-1',
    steps: [{ governanceDecisionId: 'decision-1', confirmLabel: 'Aprovar ação' }],
    responses: ['Aprovar ação'],
  }, {
    resolve: async value => calls.push(value),
    notify: async value => notifications.push(value),
  })
  assert.deepEqual(calls, [{ sessionId: 'session-structured', decisionId: 'decision-1', approved: true }])
  assert.equal(notifications[0].sessionId, 'session-structured')
  assert.match(notifications[0].text, /Continue a ação previamente proposta/)
  assert.equal(out.handled, true)
})

await test('CONFIRMATION_REQUIRED numa ação de estado com a sessão em modo manual', async () => {
  const out = await onToolBefore({ sessionId, tool: 'write_file', payload: { path: 'a.txt' } })
  assert.equal(out.veto, true)
  assert.equal(out.code, 'CONFIRMATION_REQUIRED')
  assert.match(out.reason, /CONFIRMAÇÃO NECESSÁRIA/)
  // O id da decisão precisa voltar: é com ele que o chamador repete a chamada
  // depois do humano decidir.
  assert.ok(out.details.decisionId)
  // O payload original segue no retorno: em pipeline() ele substitui o payload
  // e os handlers seguintes não podem perder tool/sessionId.
  assert.equal(out.tool, 'write_file')
  assert.equal(out.sessionId, sessionId)
})

await test('GOVERNANCE_BLOCKED no que o engine classifica como bypass', async () => {
  const out = await onToolBefore({ sessionId, tool: 'get_secret', payload: { name: 'OPENAI_API_KEY' } })
  assert.equal(out.veto, true)
  assert.equal(out.code, 'GOVERNANCE_BLOCKED')
  assert.match(out.reason, /AÇÃO BLOQUEADA/)
})

await test('MISSING_SESSION numa ação de estado sem sessão rastreável', async () => {
  const before = rows.length
  const out = await onToolBefore({ tool: 'write_file', payload: { path: 'c.txt' } })
  assert.equal(out.veto, true)
  assert.equal(out.code, 'MISSING_SESSION')
  assert.equal(rows.length, before + 1, 'a tentativa barrada precisa ficar na auditoria')
})

await test('leitura sem sessão continua passando', async () => {
  const out = await onToolBefore({ tool: 'listTasks', payload: {} })
  assert.equal(out.veto, undefined, 'barrar leitura derrubaria o think agent:tool de terminal')
})

await test('leitura com sessão passa', async () => {
  const out = await onToolBefore({ sessionId, tool: 'read_file', payload: { path: 'a.txt' } })
  assert.equal(out.veto, undefined)
})

await test('não reavalia o que o agentLoop já governou', async () => {
  const before = rows.length
  const out = await onToolBefore({ sessionId, tool: 'write_file', payload: { path: 'b.txt' }, governed: true })
  assert.equal(out.veto, undefined)
  assert.equal(rows.length, before, 'não deve gravar uma segunda decisão para a mesma ação')
})

await test('modo auto libera a ação de risco', async () => {
  const autoSession = `${sessionId}-auto`
  setSessionPolicy({ sessionId: autoSession, mode: 'auto' })
  const out = await onToolBefore({ sessionId: autoSession, tool: 'write_file', payload: { path: 'd.txt' } })
  assert.equal(out.veto, undefined)
})

await test('a chamada repetida com a confirmação aprovada executa', async () => {
  const input = { path: 'e.txt' }
  const first = await onToolBefore({ sessionId, tool: 'write_file', payload: input })
  const decisionId = first.details.decisionId
  await resolveConfirmation({ sessionId, decisionId, approved: true })

  const out = await onToolBefore({ sessionId, tool: 'write_file', payload: input }, { approval: { decisionId } })
  assert.equal(out.veto, undefined, 'com a aprovação em mãos a ação passa')
})

await test('a mesma aprovação não serve duas vezes', async () => {
  const input = { path: 'f.txt' }
  const first = await onToolBefore({ sessionId, tool: 'write_file', payload: input })
  const decisionId = first.details.decisionId
  await resolveConfirmation({ sessionId, decisionId, approved: true })

  await onToolBefore({ sessionId, tool: 'write_file', payload: input }, { approval: { decisionId } })
  const again = await onToolBefore({ sessionId, tool: 'write_file', payload: input }, { approval: { decisionId } })
  assert.equal(again.code, 'CONFIRMATION_DENIED')
  assert.match(again.reason, /consumida/)
})

await test('uma aprovação não vale para outra ação', async () => {
  const first = await onToolBefore({ sessionId, tool: 'write_file', payload: { path: 'g.txt' } })
  const decisionId = first.details.decisionId
  await resolveConfirmation({ sessionId, decisionId, approved: true })

  const out = await onToolBefore({ sessionId, tool: 'write_file', payload: { path: 'OUTRO.txt' } }, { approval: { decisionId } })
  assert.equal(out.code, 'CONFIRMATION_DENIED')
  assert.match(out.reason, /não corresponde/)
})

await test('CONFIRMATION_DENIED quando o humano negou', async () => {
  const input = { path: 'h.txt' }
  const first = await onToolBefore({ sessionId, tool: 'write_file', payload: input })
  const decisionId = first.details.decisionId
  await resolveConfirmation({ sessionId, decisionId, approved: false })

  const out = await onToolBefore({ sessionId, tool: 'write_file', payload: input }, { approval: { decisionId } })
  assert.equal(out.veto, true)
  assert.equal(out.code, 'CONFIRMATION_DENIED')
  assert.match(out.reason, /negou/)
})

await test('GOVERNANCE_ERROR quando a própria governança falha', async () => {
  setGovernanceStoreForTest({
    governanceDecision: {
      async push() { throw new Error('database unavailable') },
      findOne() { return null },
      query() { return [] },
    },
  })

  const out = await onToolBefore({
    sessionId: `${sessionId}-failure`,
    tool: 'write_file',
    payload: { path: 'i.txt' },
  })
  assert.equal(out.veto, true)
  assert.equal(out.code, 'GOVERNANCE_ERROR')
  assert.match(out.reason, /governança indisponível/i)
})

console.log(`\n${passed} tests passed`)
