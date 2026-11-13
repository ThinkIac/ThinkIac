import test from 'node:test'
import assert from 'node:assert/strict'
import { configureAgentHost, eventCall, getHostProxy, pushToHostSession, resetAgentHost } from '../host/agent_host.js'

test('núcleo Agent usa portas de host configuráveis', async () => {
  const events = []
  configureAgentHost({
    events: { call: async (...args) => { events.push(args); return { delivered: true } } },
    sockets: { pushToSession: (sessionId, payload) => ({ sessionId, payload }) },
    storage: { getProxy: (name) => ({ name }) },
  })
  try {
    assert.deepEqual(await eventCall('agent:message', { message: 'oi' }), { delivered: true })
    assert.deepEqual(events, [['agent:message', { message: 'oi' }]])
    assert.deepEqual(pushToHostSession('s1', { type: 'status' }), { sessionId: 's1', payload: { type: 'status' } })
    assert.deepEqual(getHostProxy('bags'), { name: 'bags' })
  } finally {
    resetAgentHost()
  }
})
