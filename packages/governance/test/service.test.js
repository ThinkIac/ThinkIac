import assert from 'node:assert/strict'
import { evaluateAction, hasApprovedAction, resolveConfirmation, resolveDeviceConfirmation, consumeApproval, listPending, setGovernanceEventDispatcherForTest, setGovernanceStoreForTest, setSessionPolicy } from '../service.js'
import { DEFAULT_MODE, getDefaultPolicy, getPolicy, setDefaultPolicy, setPoliciesForTest } from '../lib/policy.js'
import { setSemiClassifierForTest } from '../lib/semi.js'

setPoliciesForTest({})

let passed = 0
async function test(name, fn) { await fn(); passed++; console.log(`PASS ${name}`) }

const sessionId = `governance-test-${Date.now()}`
// Os casos de fluxo de confirmação abaixo precisam do gate estrito, então a
// sessão base é fixada em 'manual' em vez de herdar DEFAULT_MODE (hoje 'auto')
// — o que eles testam é o mecanismo de aprovação, não o default vigente.
setSessionPolicy({ sessionId, mode: 'manual' })
const rows = []
setGovernanceStoreForTest({
  governanceDecision: {
    async push(row) { const saved = { ...row, id: `d${rows.length + 1}` }; rows.push(saved); return saved },
    findOne(where) { return rows.find(row => Object.entries(where).every(([key, value]) => row[key] === value)) },
    query(where, { limit } = {}) { return rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value)).slice(0, limit) }
  }
})

await test('requires a confirmation for a mutable action', async () => {
  const decision = await evaluateAction({ sessionId, tool: 'write_file', input: { path: 'a.txt' } })
  assert.equal(decision.classification, 'needs_confirmation')
  assert.equal(decision.allowed, false)
  assert.ok(decision.decisionId)
  await resolveConfirmation({ sessionId, decisionId: decision.decisionId, approved: true })
  assert.equal((await consumeApproval({ sessionId, decisionId: decision.decisionId, tool: 'write_file', input: { path: 'a.txt' } })).allowed, true)
})

await test('consumes an approval exactly once', async () => {
  const decision = await evaluateAction({ sessionId, tool: 'write_file', input: { path: 'b.txt' } })
  await resolveConfirmation({ sessionId, decisionId: decision.decisionId, approved: true })
  await consumeApproval({ sessionId, decisionId: decision.decisionId, tool: 'write_file', input: { path: 'b.txt' } })
  await assert.rejects(
    () => consumeApproval({ sessionId, decisionId: decision.decisionId, tool: 'write_file', input: { path: 'b.txt' } }),
    /já foi consumida/
  )
})

await test('blocks an execution without a traceable session', async () => {
  const decision = await evaluateAction({ tool: 'write_file', input: { path: 'c.txt' } })
  assert.equal(decision.classification, 'blocked')
})

await test('lists pending confirmations and drops them once resolved', async () => {
  const decision = await evaluateAction({ sessionId, tool: 'delete_file', input: { path: 'd.txt' } })
  const pending = listPending({ sessionId })
  const mine = pending.find(row => row.id === decision.decisionId)
  assert.ok(mine, 'a pendência deve aparecer na lista')
  assert.ok(mine.question.includes('delete_file'))
  assert.equal(mine.confirmLabel, 'Aprovar ação')
  await resolveConfirmation({ sessionId, decisionId: decision.decisionId, approved: false })
  assert.equal(listPending({ sessionId }).some(row => row.id === decision.decisionId), false)
})

await test('publishes an Android confirmation and resolves its silent action', async () => {
  const events = []
  setGovernanceEventDispatcherForTest(async (name, payload) => events.push({ name, payload }))
  const decision = await evaluateAction({ sessionId, tool: 'write_file', input: { path: 'android.txt' } })
  const notice = events.find(event => event.name === 'device:notify')
  assert.equal(notice.payload.id, `governance:${decision.decisionId}`)
  assert.equal(notice.payload.interaction, 'confirm')
  assert.match(notice.payload.click, /open=chat/)
  assert.match(notice.payload.click, new RegExp(`session=${encodeURIComponent(sessionId)}`))

  const resolved = await resolveDeviceConfirmation({ id: notice.payload.id, action: 'confirm' })
  assert.equal(resolved.status, 'approved')
  assert.equal(rows.find(row => row.id === decision.decisionId).resolution, 'approved_by_android_notification')
  setGovernanceEventDispatcherForTest()
})

await test('cancels from Android without resuming and ignores unrelated notifications', async () => {
  const events = []
  setGovernanceEventDispatcherForTest(async (name, payload) => events.push({ name, payload }))
  const decision = await evaluateAction({ sessionId, tool: 'write_file', input: { path: 'android-cancel.txt' } })

  assert.equal(await resolveDeviceConfirmation({ id: 'chat:response-1', action: 'cancel' }), null)
  assert.equal(await resolveDeviceConfirmation({ id: `governance:${decision.decisionId}`, action: 'submit' }), null)

  const resolved = await resolveDeviceConfirmation({ id: `governance:${decision.decisionId}`, action: 'cancel' })
  assert.equal(resolved.status, 'denied')
  assert.equal(rows.find(row => row.id === decision.decisionId).resolution, 'denied_by_android_notification')
  assert.equal(events.some(event => event.name === 'governance:approved'), false)
  setGovernanceEventDispatcherForTest()
})

await test('acknowledges a repeated identical resolution without resuming twice', async () => {
  const approvedDecision = await evaluateAction({ sessionId, tool: 'write_file', input: { path: 'retry.txt' } })
  const first = await resolveConfirmation({ sessionId, decisionId: approvedDecision.decisionId, approved: true })
  const repeated = await resolveConfirmation({ sessionId, decisionId: approvedDecision.decisionId, approved: true })
  assert.equal(first.status, 'approved')
  assert.deepEqual(repeated, { id: approvedDecision.decisionId, status: 'approved', alreadyResolved: true })
  await assert.rejects(
    () => resolveConfirmation({ sessionId, decisionId: approvedDecision.decisionId, approved: false }),
    /já foi resolvida/
  )

  await consumeApproval({ sessionId, decisionId: approvedDecision.decisionId, tool: 'write_file', input: { path: 'retry.txt' } })
  const afterConsumption = await resolveConfirmation({ sessionId, decisionId: approvedDecision.decisionId, approved: true })
  assert.equal(afterConsumption.status, 'consumed')
  assert.equal(afterConsumption.alreadyResolved, true)
})

await test('approval emits an internal resume event without creating a user message', async () => {
  const events = []
  setGovernanceEventDispatcherForTest(async (name, payload) => events.push({ name, payload }))
  const decision = await evaluateAction({ sessionId, tool: 'write_file', input: { path: 'resume.txt' } })
  await resolveConfirmation({ sessionId, decisionId: decision.decisionId, approved: true })
  assert.equal(hasApprovedAction({ sessionId }), true)
  assert.deepEqual(events.filter(event => event.name === 'governance:approved'), [{
    name: 'governance:approved',
    payload: { sessionId, decisionId: decision.decisionId }
  }])
  setGovernanceEventDispatcherForTest()
})

await test('manual mode confirms every state change but lets reads through', async () => {
  const s = `${sessionId}-manual`
  setSessionPolicy({ sessionId: s, mode: 'manual' })
  // createTask é "safe" pro engine (barato e reversível), mas ainda altera
  // estado: no manual o usuário quer decidir.
  const write = await evaluateAction({ sessionId: s, tool: 'run_runtime_tool', input: { package: 'tasks', tool: 'createTask' } })
  assert.equal(write.classification, 'needs_confirmation')
  assert.ok(write.structuredInput[0].command, 'o card precisa carregar o comando e os parâmetros')
  const read = await evaluateAction({ sessionId: s, tool: 'run_runtime_tool', input: { package: 'tasks', tool: 'listTasks' } })
  assert.equal(read.allowed, true)
})

await test('new sessions start in Semi with the Read only preset', async () => {
  const policy = getPolicy(`${sessionId}-default`)
  assert.equal(DEFAULT_MODE, 'semi')
  assert.equal(policy.mode, 'semi')
  assert.equal(policy.preset, 'read_only')
  const write = await evaluateAction({ sessionId: `${sessionId}-default`, tool: 'write_file', input: { path: 'a.txt' } })
  assert.equal(write.classification, 'needs_confirmation')
})

await test('new sessions inherit the configured default without changing explicit policies', async () => {
  setPoliciesForTest({})
  setDefaultPolicy({ mode: 'manual', preset: 'workspace_edits' })
  assert.equal(getDefaultPolicy().mode, 'manual')
  assert.equal(getPolicy(`${sessionId}-configured-default`).mode, 'manual')
  setSessionPolicy({ sessionId: `${sessionId}-explicit-policy`, mode: 'auto' })
  assert.equal(getPolicy(`${sessionId}-explicit-policy`).mode, 'auto')
  setPoliciesForTest({})
})

await test('keeps a legacy Semi prompt as a Custom policy', async () => {
  setPoliciesForTest({ legacy: { mode: 'semi', prompt: 'pode editar arquivos' } })
  const policy = getPolicy('legacy')
  assert.equal(policy.preset, 'custom')
  setPoliciesForTest({})
})

await test('workspace edits only lets LLM-approved local writes through', async () => {
  const s = `${sessionId}-workspace`
  setSessionPolicy({ sessionId: s, mode: 'semi', preset: 'workspace_edits' })
  setSemiClassifierForTest(async () => ({ text: '{"decision":"allow","risk":"low","reason":"edição local permitida"}' }))
  const edit = await evaluateAction({ sessionId: s, tool: 'patch_file', input: { path: 'a.txt' } })
  assert.equal(edit.allowed, true)
  for (const action of [
    { tool: 'delete_file', input: { path: 'a.txt' } },
    { tool: 'run_shell', input: { command: 'npm test' } },
    { tool: 'run_runtime_tool', input: { package: 'ntfy', tool: 'sendNtfyNotification' } },
  ]) {
    const decision = await evaluateAction({ sessionId: s, ...action })
    assert.equal(decision.classification, 'needs_confirmation')
  }
})

await test('auto mode approves risky actions but keeps blocked ones blocked', async () => {
  const s = `${sessionId}-auto`
  setSessionPolicy({ sessionId: s, mode: 'auto' })
  const risky = await evaluateAction({ sessionId: s, tool: 'run_shell', input: { command: 'rm -rf build' } })
  assert.equal(risky.allowed, true)
  assert.equal(risky.autoApproved, true, 'o aviso de risco assumido precisa acompanhar a aprovação')
  const blocked = await evaluateAction({ sessionId: s, tool: 'get_secret', input: {} })
  assert.equal(blocked.classification, 'blocked')
  assert.equal(blocked.allowed, false)
})

await test('semi mode follows the session policy through the classifier', async () => {
  const s = `${sessionId}-semi`
  setSessionPolicy({ sessionId: s, mode: 'semi', prompt: 'pode editar arquivos, mas nunca apagar nada' })
  setSemiClassifierForTest(async ({ messages }) => {
    const text = messages[0].content
    const allow = !/delete|remove/i.test(text)
    return { text: JSON.stringify({ decision: allow ? 'allow' : 'confirm', risk: allow ? 'low' : 'high', reason: 'política da sessão' }) }
  })
  const edit = await evaluateAction({ sessionId: s, tool: 'patch_file', input: { path: 'a.txt' } })
  assert.equal(edit.allowed, true)
  const remove = await evaluateAction({ sessionId: s, tool: 'run_runtime_tool', input: { package: 'file-manager', tool: 'filemanage_delete', args: { path: 'a.txt' } } })
  assert.equal(remove.classification, 'needs_confirmation')
})

await test('semi mode falls back to asking when the classifier fails or has no policy', async () => {
  const s = `${sessionId}-semi-fail`
  setSessionPolicy({ sessionId: s, mode: 'semi', prompt: 'liberdade total' })
  setSemiClassifierForTest(async () => { throw new Error('modelo fora do ar') })
  const failed = await evaluateAction({ sessionId: s, tool: 'run_shell', input: { command: 'ls' } })
  assert.equal(failed.classification, 'needs_confirmation')

  const empty = `${sessionId}-semi-empty`
  setSessionPolicy({ sessionId: empty, mode: 'semi', prompt: '' })
  setSemiClassifierForTest(async () => ({ text: '{"decision":"allow","risk":"low","reason":"x"}' }))
  const noPolicy = await evaluateAction({ sessionId: empty, tool: 'run_shell', input: { command: 'ls' } })
  assert.equal(noPolicy.classification, 'needs_confirmation')
})

await test('persistent authorization is internal, repeatable, audited and cannot override blocks', async () => {
  const action = { sessionId: `${sessionId}-flow`, tool: 'run_runtime_tool', input: { package: 'desta-casa', tool: 'destaCasaSolicitarVisita', args: { id: 'A' } } }
  let active = true
  const authorize = () => active ? { id: 'grant1', workflowId: 'wf1', nodeId: 'n1' } : null
  for (let i = 0; i < 2; i++) {
    const result = await evaluateAction(action, { authorize })
    assert.equal(result.allowed, true)
    assert.match(result.reason, /grant1/)
  }
  const blocked = await evaluateAction({ sessionId: action.sessionId, tool: 'get_secret', input: {} }, { authorize })
  assert.equal(blocked.classification, 'blocked')
  active = false
  assert.equal((await evaluateAction(action, { authorize })).allowed, false)
  assert.equal((await evaluateAction({ ...action, authorize: { id: 'forged' } })).allowed, false)
  assert.equal((await evaluateAction(action, { authorize: () => { throw Error('unavailable') } })).allowed, false)
})

await test('report review overrides auto, blocks self approval and retains full parameters',async()=>{
 const id=sessionId+'-reports';setSessionPolicy({sessionId:id,mode:'auto'});
 const action={sessionId:id,tool:'sendEmail',input:{body:'a'.repeat(2000)}};
 const decision=await evaluateAction(action,{requireReview:true});
 assert.equal(decision.allowed,false);assert.equal(decision.command.params[0].value.length,2000);
 assert.equal((await evaluateAction(action,{requireReview:true})).decisionId,decision.decisionId);
 for(const tool of ['resolveGovernanceConfirmation','setGovernancePolicy']){
  assert.equal((await evaluateAction({sessionId:id,tool},{requireReview:true})).classification,'blocked');
  assert.equal((await evaluateAction({sessionId:id,tool:'run_runtime_tool',input:{package:'governance',tool}},{requireReview:true})).classification,'blocked');
 }
 await assert.rejects(resolveConfirmation({sessionId:id,decisionId:decision.decisionId,approved:true}),/Mesa de relatórios/);
 let wakes=0;setGovernanceEventDispatcherForTest(async()=>wakes++);
 await resolveConfirmation({sessionId:id,decisionId:decision.decisionId,approved:true},{deferResume:true});assert.equal(wakes,0);
 await assert.rejects(consumeApproval({sessionId:id,decisionId:decision.decisionId,tool:'sendEmail',input:{body:'modified'}}),/não corresponde/);
 assert.equal((await consumeApproval({sessionId:id,decisionId:decision.decisionId,tool:'sendEmail',input:action.input})).allowed,true);
 setGovernanceEventDispatcherForTest(null);
});

await test('does not write derived policy fields to a strict persisted record', async () => {
  const strictRows = []
  setGovernanceStoreForTest({
    governanceDecision: {
      async push(row) {
        const saved = { ...row, id: 'strict-1' }
        strictRows.push(saved)
        return new Proxy(saved, {
          set(target, property, value) {
            if (!(property in target)) throw new Error(`unknown persisted field: ${String(property)}`)
            target[property] = value
            return true
          }
        })
      },
      findOne(where) { return strictRows.find(row => Object.entries(where).every(([key, value]) => row[key] === value)) },
      query(where) { return strictRows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value)) }
    }
  })
  const result = await evaluateAction({ sessionId: `${sessionId}-strict`, tool: 'read_file', input: { path: 'a.txt' } })
  assert.equal(result.allowed, true)
  assert.equal(result.policySource, 'read-only-proof')
  assert.equal('policySource' in strictRows[0], false)
})

console.log(`\n${passed} tests passed`)
