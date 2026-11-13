import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runtimeHealth } from '../routes/health.js'

const home = readFileSync(join(import.meta.dirname, '..', 'views', 'Home.svelte'), 'utf8')
const chatRoutes = readFileSync(join(import.meta.dirname, '..', 'routes', 'chat.js'), 'utf8')

test('the Agent composer only calls chat endpoints declared by the backend', () => {
  const called = new Set(
    [...home.matchAll(/api\([`"'](\/chat(?:\/[^`"']*)?)[`"']/g)].map((match) => match[1]),
  )
  const declared = new Set(
    [...chatRoutes.matchAll(/@register_router\s+(chat(?:\/\S+)?)/g)].map((match) => `/${match[1]}`),
  )

  assert.ok(called.has('/chat/send'), 'the composer must use the non-blocking chat endpoint')
  for (const endpoint of called) {
    assert.ok(declared.has(endpoint), `frontend endpoint ${endpoint} has no matching backend route`)
  }
})

test('release health advertises the chat contract required by reconciliation', () => {
  const health = runtimeHealth()
  assert.equal(health.ok, true)
  assert.ok(health.contracts.includes('chat/send'))
  assert.ok(health.contracts.includes('chat/replay'))
  assert.ok(health.contracts.includes('websocket'))
})

test('the composer only clears a message after explicit server acceptance', () => {
  assert.match(home, /!r\?\.accepted && !r\?\.queued && !r\?\.forwarded/)
  assert.match(home, /r\?\.error \|\| "não foi possível enviar a mensagem/)
})

test('reconnect preserves an optimistic message until replay confirms it', () => {
  assert.match(home, /const hasLocalEcho = cached\?\.some/)
  assert.match(home, /\(staleStreaming \|\| loadingMap\[sid\]\) && !hasLocalEcho/)
  assert.match(home, /if \(!cached\?\.length\)/)
})

test('late history hydration cannot erase a message sent while loading', () => {
  assert.match(home, /const liveHistory = sessionCache\[sid\]/)
  assert.match(home, /liveHistory\?\.some\(\(item\) => item\?\._localEchoContent\)/)
  assert.match(home, /history = liveHistory/)
})

test('retry reuses a server checkpoint and normal turns checkpoint the user input early', () => {
  assert.match(chatRoutes, /retry = false/)
  assert.match(chatRoutes, /persistUserMessageEarly: true/)
  assert.match(chatRoutes, /reuseLastUserMessage: retry/)
})
