import test from 'node:test'
import assert from 'node:assert/strict'
import { requestCodexApproval } from './codex_approval.js'
import { listPendingPermissions, resolvePendingPermission } from '../core/pending_permissions.js'

for (const decision of ['allow', 'deny']) {
  test(`aprovação nativa usa registro Runtime e decisão ${decision}`, async () => {
    const result = await requestCodexApproval({ id: 1, method: 'item/commandExecution/requestApproval', params: { command: 'touch /outside/probe', itemId: 'item-1' } }, {
      sessionId: 'approval-test', emit: async (session, type, payload) => {
        assert.equal(session, 'approval-test')
        assert.equal(type, 'permission_request')
        const [pending] = listPendingPermissions(session)
        assert.equal(pending.toolInput.command, 'touch /outside/probe')
        assert.equal(pending.requestId, payload.request_id)
        resolvePendingPermission(payload.request_id, decision)
      },
    })
    assert.deepEqual(result, { decision: decision === 'allow' ? 'accept' : 'decline' })
    assert.deepEqual(listPendingPermissions('approval-test'), [])
  })
}
test('sem sessão, erro da UI, cancelamento e timeout negam', async () => {
  const request = { id: 2, method: 'item/fileChange/requestApproval', params: {} }
  assert.deepEqual(await requestCodexApproval(request), { decision: 'decline' })
  assert.deepEqual(await requestCodexApproval(request, { sessionId: 'x', emit: () => { throw Error('offline') } }), { decision: 'decline' })
  const controller = new AbortController()
  assert.deepEqual(await requestCodexApproval(request, { sessionId: 'x', signal: controller.signal, emit: () => controller.abort() }), { decision: 'decline' })
  assert.deepEqual(await requestCodexApproval(request, { sessionId: 'x', timeoutMs: 5, emit: () => {} }), { decision: 'decline' })
  assert.deepEqual(listPendingPermissions('x'), [])
})
