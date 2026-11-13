import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyCliFailure, describeCliFailure, isCreditFailure, parseRetryAt, cooldownFor, cliFailureDisposition } from './cli_failures.js'





const CODEX_USAGE_LIMIT = `[cli:codex] saiu com código 1: {"type":"error","message":"You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Jul 28th, 2026 7:00 PM."}`

test('classifica saldo/cota esgotada como credit', () => {
  const casos = [
    'Credit balance is too low to run this request',
    'Error: insufficient credits for this account',
    'You are out of credits. Purchase more credits to continue.',
    'quota exceeded for this organization',
    'Usage limit reached — resets at 4pm',
    'HTTP 402 Payment Required',
  ]
  for (const c of casos) assert.equal(classifyCliFailure(c), 'credit', c)
})

test('distingue rate limit, auth e modelo de falta de crédito', () => {
  assert.equal(classifyCliFailure('429 Too Many Requests'), 'rate_limit')
  assert.equal(classifyCliFailure('401 Missing bearer token'), 'auth')
  
  assert.equal(
    classifyCliFailure("There's an issue with the selected model (sabia-4-thinking). It may not exist or you may not have access to it."),
    'model',
  )
})

test('erro genérico e texto vazio ficam sem classificação', () => {
  assert.equal(classifyCliFailure('TypeError: undefined is not a function'), null)
  assert.equal(classifyCliFailure(''), null)
  assert.equal(classifyCliFailure(null), null)
})

test('describeCliFailure nomeia a conta e só fala do que sabe', () => {
  assert.match(
    describeCliFailure('credit', { bin: 'claude', account: 'pessoal' }),
    /Conta "pessoal" \(claude\) está sem crédito/,
  )
  assert.equal(describeCliFailure(null, { bin: 'claude' }), '')
})

test('isCreditFailure lê failureKind e cai no texto do erro', () => {
  assert.equal(isCreditFailure({ failureKind: 'credit' }), true)
  assert.equal(isCreditFailure({ failureKind: 'rate_limit' }), true)
  assert.equal(isCreditFailure({ failureKind: 'auth' }), false)
  assert.equal(isCreditFailure({ message: '[cli:claude] saiu com código 1', stderr: 'Credit balance is too low' }), true)
  assert.equal(isCreditFailure({ message: '[cli:claude] saiu com código 1' }), false)
})

test('política de falha tira conta sem cota do rodízio na primeira ocorrência', () => {
  const err = new Error(CODEX_USAGE_LIMIT)
  err.failureKind = 'credit'
  const disposition = cliFailureDisposition(err)
  assert.equal(disposition.reason, 'credit')
  assert.equal(disposition.forceDisable, true)
  assert.ok(disposition.cooldownMs > 0)
})

test('política de falha preserva tolerância para erro desconhecido', () => {
  assert.deepEqual(cliFailureDisposition(new Error('socket reset')), {
    reason: null,
    forceDisable: false,
    cooldownMs: 0,
  })
})

test('limite de uso do Codex conta como cota, não como erro genérico', () => {
  assert.equal(classifyCliFailure(CODEX_USAGE_LIMIT), 'credit')
  assert.equal(isCreditFailure({ message: CODEX_USAGE_LIMIT }), true)
  
  assert.equal(classifyCliFailure('Usage limit reached — resets at 4pm'), 'credit')
})

test('parseRetryAt lê a hora de retomada anunciada pelo CLI', () => {
  
  assert.equal(parseRetryAt(CODEX_USAGE_LIMIT), Date.parse('Jul 28, 2026 7:00 PM'))

  const rel = parseRetryAt('try again in 42 minutes')
  assert.ok(Math.abs(rel - (Date.now() + 42 * 60_000)) < 2000)

  assert.equal(parseRetryAt('out of credits'), null)
  assert.equal(parseRetryAt(''), null)
})

test('cooldownFor converte a retomada em prazo, com piso, teto e sem prazo p/ auth', () => {
  
  assert.equal(cooldownFor('credit', 'out of credits'), 60 * 60_000)
  assert.equal(cooldownFor('rate_limit', '429 Too Many Requests'), 5 * 60_000)

  
  
  assert.equal(cooldownFor('auth', '401 unauthorized'), 0)
  assert.equal(cooldownFor('model', 'issue with the selected model'), 0)
  assert.equal(cooldownFor(null, 'boom'), 0)

  
  assert.equal(cooldownFor('credit', 'try again at Jan 1st, 2020 7:00 PM'), 60 * 60_000)

  
  assert.equal(cooldownFor('credit', 'try again in 90 days'), 24 * 60 * 60_000)

  
  const alvo = new Date(Date.now() + 3600_000)
  const ms = cooldownFor('credit', `try again at ${alvo.toDateString()} ${alvo.toTimeString().slice(0, 5)}`)
  assert.ok(ms > 0 && ms <= 3600_000 + 30_000)
})
