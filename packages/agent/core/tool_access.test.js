import test from 'node:test'
import assert from 'node:assert/strict'
import { grantToolAccess, getGrantedToolNames, consumeGrantedTool, extendAllowlist, clearToolAccess } from './tool_access.js'

test('concede somente tools existentes e isola a sessão', () => {
  clearToolAccess('a'); clearToolAccess('b')
  grantToolAccess({ sessionId: 'a', toolNames: ['browser_find'], reason: 'navegar', catalogNames: ['browser_find'] })
  assert.deepEqual(getGrantedToolNames('a'), ['browser_find'])
  assert.deepEqual(getGrantedToolNames('b'), [])
  assert.deepEqual(extendAllowlist(['read_file'], 'a'), ['read_file', 'browser_find', 'request_tool_access'])
})

test('recusa tools inexistentes e controles protegidos', () => {
  assert.throws(() => grantToolAccess({ sessionId: 'x', toolNames: ['missing'], catalogNames: [] }), /inexistentes/)
  assert.throws(() => grantToolAccess({ sessionId: 'x', toolNames: ['setGovernancePolicy'], catalogNames: ['setGovernancePolicy'] }), /não podem/)
})

test('expira e limita uso da concessão', () => {
  clearToolAccess('limited')
  const grant = grantToolAccess({ sessionId: 'limited', toolNames: ['browser_find'], catalogNames: ['browser_find'], ttlMs: 1000, maxUses: 1 })
  assert.equal(consumeGrantedTool('limited', 'browser_find', grant.grantedAt), true)
  assert.deepEqual(getGrantedToolNames('limited', grant.grantedAt), [])
  grantToolAccess({ sessionId: 'limited', toolNames: ['browser_find'], catalogNames: ['browser_find'], ttlMs: 1000 })
  assert.deepEqual(getGrantedToolNames('limited', Date.now() + 2000), [])
})
