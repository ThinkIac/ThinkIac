import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { clearSession, getSession } from './session.js'

const memoryDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'sessions')

test('preserva tool_calls com content vazio ao recarregar a sessão', () => {
  const id = `tool-protocol-reload-${Date.now()}`
  const path = join(memoryDir, `${id}.json`)
  mkdirSync(memoryDir, { recursive: true })
  writeFileSync(path, JSON.stringify({
    id,
    messages: [
      { role: 'assistant', content: '', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'call-1', content: '{"answer":42}' },
    ],
  }))

  const session = getSession(id)
  assert.equal(session.messages.length, 2)
  assert.equal(session.messages[0].tool_calls[0].id, 'call-1')
  assert.equal(session.messages[1].tool_call_id, 'call-1')

  clearSession(id)
  assert.equal(existsSync(path), false)
})
