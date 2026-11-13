import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getSessionSpecialistId,
  setSessionSpecialistId,
  clearSessionSpecialistId,
  listSessionSpecialistOverrides,
  resolveSessionSpecialist,
  setSpecialistStoreForTest,
} from '../lib/session.js'
import { discoverAgentFiles } from '../lib/discovery.js'

test.beforeEach(() => {
  setSpecialistStoreForTest({})
})

test('sessão sem override começa null', () => {
  assert.equal(getSessionSpecialistId('s1'), null)
})

test('setSessionSpecialistId fixa e getSessionSpecialistId lê de volta', () => {
  setSessionSpecialistId('s1', 'pkg:ntfy')
  assert.equal(getSessionSpecialistId('s1'), 'pkg:ntfy')
})

test('sessões diferentes não vazam override uma pra outra', () => {
  setSessionSpecialistId('s1', 'pkg:ntfy')
  setSessionSpecialistId('s2', 'pkg:hermes')
  assert.equal(getSessionSpecialistId('s1'), 'pkg:ntfy')
  assert.equal(getSessionSpecialistId('s2'), 'pkg:hermes')
})

test('"none" limpa o override, igual a null', () => {
  setSessionSpecialistId('s1', 'pkg:ntfy')
  setSessionSpecialistId('s1', 'none')
  assert.equal(getSessionSpecialistId('s1'), null)
  assert.equal(listSessionSpecialistOverrides().s1, undefined)
})

test('clearSessionSpecialistId limpa explicitamente', () => {
  setSessionSpecialistId('s2', 'pkg:ntfy')
  clearSessionSpecialistId('s2')
  assert.equal(getSessionSpecialistId('s2'), null)
})

test('setSessionSpecialistId exige sessionId', () => {
  assert.throws(() => setSessionSpecialistId(null, 'pkg:ntfy'), /sessionId/)
})

test('resolveSessionSpecialist devolve null sem override', () => {
  assert.equal(resolveSessionSpecialist('sX'), null)
})

test('resolveSessionSpecialist resolve um especialista genérico existente', () => {
  const files = discoverAgentFiles({ includeRoot: false })
  assert.ok(files.length > 0, 'precisa de ao menos um AGENT.md pra este teste fazer sentido')
  setSessionSpecialistId('s1', `pkg:${files[0].pkg}`)
  const resolved = resolveSessionSpecialist('s1')
  assert.ok(resolved)
  assert.equal(resolved.kind, 'generic')
})

test('override apontando pra especialista inexistente se autocura: limpa e devolve null', () => {
  setSessionSpecialistId('s1', 'pkg:__nao-existe__')
  assert.equal(getSessionSpecialistId('s1'), 'pkg:__nao-existe__')
  const resolved = resolveSessionSpecialist('s1')
  assert.equal(resolved, null)
  assert.equal(getSessionSpecialistId('s1'), null, 'override morto deveria ter sido limpo')
})
