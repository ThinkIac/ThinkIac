import assert from 'node:assert/strict'
import test from 'node:test'

import { createChatEventState } from '../core/chat_event_state.js'

test('timeout encerra o ciclo, preserva replay e rejeita finalização duplicada', () => {
  const state = createChatEventState();
  state.begin('timeout-session');
  state.push('timeout-session', 'timeout', { retryable: true });
  assert.equal(state.current('timeout-session').terminal, true);
  assert.equal(state.push('timeout-session', 'done', { response: 'late' }), null);
  assert.deepEqual(state.replay('timeout-session').events.map(item => item.event), ['timeout']);
});

test('novo ciclo aceita seq reiniciado sem confundir com o epoch anterior', () => {
  let n = 0
  const state = createChatEventState({ createEpoch: () => `epoch-${++n}` })
  state.begin('s1')
  const old = state.push('s1', 'start', {})
  state.push('s1', 'done', { response: 'a' })

  state.begin('s1')
  const fresh = state.push('s1', 'start', {})
  const replay = state.replay('s1', { epoch: old.epoch, seq: 47 })

  assert.equal(fresh.id, 1)
  assert.equal(fresh.epoch, 'epoch-2')
  assert.equal(replay.cursorMismatch, true)
  assert.deepEqual(replay.events, [fresh])
})

test('reconnect no mesmo epoch devolve apenas eventos posteriores ao cursor', () => {
  const state = createChatEventState({ createEpoch: () => 'epoch-a' })
  state.begin('s1')
  state.push('s1', 'start', {})
  state.push('s1', 'token', { text: 'a' })
  const last = state.push('s1', 'token', { text: 'b' })

  assert.deepEqual(state.replay('s1', { epoch: 'epoch-a', seq: 2 }).events, [last])
})

test('um ciclo aceita exatamente um evento terminal', () => {
  const state = createChatEventState({ createEpoch: () => 'epoch-a' })
  state.begin('s1')
  const done = state.push('s1', 'done', { response: 'ok' })

  assert.ok(done)
  assert.equal(state.push('s1', 'error', { error: 'late' }), null)
  assert.equal(state.current('s1').events.length, 1)
})
