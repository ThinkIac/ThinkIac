



import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { cliFailureDisposition } from './cli_failures.js'
import {
  orderSlotsForFallback,
  estimateRequestInputTokens,
  resolveRequestMaxTokens,
  sanitizePinnedProviderError,
  sanitizeProviderError,
  canFailoverAfter,
} from './llm.js'

test('roteador streaming troca A limitada por B sem aviso e respeita noRetry', async () => {
  
  
  const source = readFileSync(new URL('./llm.js', import.meta.url), 'utf8')
  const start = source.indexOf('export async function callLLMStream(')
  const end = source.indexOf('// ── Fallback helpers', start)
  assert.ok(start >= 0 && end > start)
  const body = source.slice(start, end).replace('export async function', 'async function')
  for (const noRetry of [false, true]) {
    const accounts = ['a', 'blocked', 'b'].map(id => ({ id, mode: 'cli', provider: 'codex-cli', model: 'gpt-5.6-sol' }))
    const calls = [], notices = [], failures = [], tokens = []
    const deps = {
      normalizeToolOrder: messages => messages,
      getConfig: () => ({ llm: {} }), buildSlots: () => accounts,
      getNextSlot: () => accounts[0],
      getSlotStatus: () => accounts.map(s => ({ id: s.id, blocked: s.id === 'blocked' })),
      orderSlotsForFallback, estimateRequestInputTokens, resolveRequestMaxTokens,
      canFailoverAfter, cliFailureDisposition, sanitizeProviderError, sanitizePinnedProviderError,
      acquireSlotLease: async () => () => {},
      isElm: () => false,
      runCliSlot: async (account, model, options) => {
        calls.push([account.id, model])
        if (account.id === 'a') throw Object.assign(new Error("You've hit your usage limit. Try again in 2 hours."), { noRetry })
        options.onToken('OK')
        return { choices: [{ message: { content: 'OK' } }] }
      },
      reportSlotFailure: (id, message, disposition) => {
        failures.push({ id, disposition })
        return { disabled: disposition.forceDisable, disabled_until: disposition.cooldownMs ? 'future' : null }
      },
      reportSlotSuccess: () => {},
      notifySlotDisabled: async (...args) => notices.push(args),
      stampModel: data => data,
    }
    const execute = new Function(...Object.keys(deps), `${body}; return callLLMStream`)(...Object.values(deps))
    const pending = execute({ system: '', messages: [], model: 'gpt-5.6-sol', onToken: t => tokens.push(t) })
    if (noRetry) await assert.rejects(pending, e => e.noRetry === true)
    else assert.equal((await pending).choices[0].message.content, 'OK')
    assert.deepEqual(calls, noRetry ? [['a', 'gpt-5.6-sol']] : [['a', 'gpt-5.6-sol'], ['b', 'gpt-5.6-sol']])
    assert.deepEqual(tokens, noRetry ? [] : ['OK'])
    assert.deepEqual(notices, [])
    assert.equal(failures[0].disposition.forceDisable, true)
    assert.ok(failures[0].disposition.cooldownMs > 0)
  }
})

const slot = (id, provider) => ({ id, provider, model: `${provider}-model` })

test('orderSlotsForFallback: conta atual → outras contas do MESMO provider → outros modelos', () => {
  const cliA = slot('claude[0]', 'claude-cli')
  const cliB = slot('claude[1]', 'claude-cli')
  const cliC = slot('claude[2]', 'claude-cli')
  const or   = slot('openrouter[0]', 'openrouter')
  const all  = [cliA, cliB, cliC, or]

  
  const order = orderSlotsForFallback(all, all, cliB).map(s => s.id)
  assert.deepEqual(order, ['claude[1]', 'claude[0]', 'claude[2]', 'openrouter[0]'])
})

test('orderSlotsForFallback: Codex troca de conta mantendo o modelo do pool', () => {
  const codexA = { ...slot('codex[0]', 'codex-cli'), model: 'gpt-5.6-sol', cli: { account: 'a' } }
  const codexB = { ...slot('codex[1]', 'codex-cli'), model: 'gpt-5.6-sol', cli: { account: 'b' } }
  const fallback = { ...slot('openrouter[0]', 'openrouter'), model: 'openai/gpt-4o-mini' }

  const order = orderSlotsForFallback([codexA, codexB, fallback], [codexA, codexB], codexA)
  assert.deepEqual(order.map(s => [s.cli?.account ?? null, s.model]), [
    ['a', 'gpt-5.6-sol'],
    ['b', 'gpt-5.6-sol'],
    [null, 'openai/gpt-4o-mini'],
  ])
})

test('orderSlotsForFallback: escala pra slots fora do pool do propósito (outro modelo base)', () => {
  const cli = slot('claude[0]', 'claude-cli')
  const or  = slot('openrouter[0]', 'openrouter')
  const all = [cli, or]
  const usable = [cli] 

  const order = orderSlotsForFallback(all, usable, cli).map(s => s.id)
  assert.deepEqual(order, ['claude[0]', 'openrouter[0]'])
})

test('orderSlotsForFallback: override explícito permanece estritamente no pool selecionado', () => {
  const groqA = { ...slot('free-groq[0]', 'groq'), poolName: 'free-groq' }
  const groqB = { ...slot('free-groq[1]', 'groq'), poolName: 'free-groq' }
  const deepseek = { ...slot('openrouter[0]', 'openrouter'), poolName: 'openrouter' }

  const order = orderSlotsForFallback(
    [groqA, groqB, deepseek],
    [groqA, groqB],
    groqA,
    { strictScope: true },
  ).map(s => s.id)

  assert.deepEqual(order, ['free-groq[0]', 'free-groq[1]'])
})

test('orderSlotsForFallback: dedupe por id (sem repetir slots)', () => {
  const cli = slot('claude[0]', 'claude-cli')
  const all = [cli]
  const order = orderSlotsForFallback(all, all, cli)
  assert.equal(order.length, 1)
})

test('orderSlotsForFallback: pula contas ainda em cooldown', () => {
  const codexA = slot('codex[0]', 'codex-cli')
  const codexB = slot('codex[1]', 'codex-cli')
  const codexC = slot('codex[2]', 'codex-cli')
  const order = orderSlotsForFallback(
    [codexA, codexB, codexC],
    [codexA, codexB, codexC],
    codexB,
    { blockedIds: new Set(['codex[0]']) },
  )
  assert.deepEqual(order.map(s => s.id), ['codex[1]', 'codex[2]'])
})

test('failover só repete turno que ainda não produziu efeitos', () => {
  assert.equal(canFailoverAfter(Object.assign(new Error('usage limit'), { failureKind: 'credit' })), true)
  assert.equal(canFailoverAfter(Object.assign(new Error('usage limit após tool'), { noRetry: true })), false)
  assert.equal(canFailoverAfter(Object.assign(new Error('efeito legado'), { noRetry: 'performed-action' })), false)
  assert.equal(canFailoverAfter(Object.assign(new Error('cancelado'), { name: 'AbortError' })), false)
})

test('sanitizeProviderError: mensagem limpa, sem vazar o erro cru do cli', () => {
  const raw = new Error('[cli:claude] saiu com código 1')
  raw.stderr = 'Credit balance is too low'
  const clean = sanitizeProviderError(raw)

  assert.doesNotMatch(clean.message, /cli:claude/)
  assert.doesNotMatch(clean.message, /código 1/)
  assert.doesNotMatch(clean.message, /Credit balance/)
  assert.equal(clean.sanitized, true)
  assert.equal(clean.cause, raw) 
})

test('sanitizeProviderError: tolera null/undefined', () => {
  const clean = sanitizeProviderError(null)
  assert.match(clean.message, /tente novamente/i)
  assert.equal(clean.sanitized, true)
})

test('sanitizePinnedProviderError: identifica a seleção sem expor resposta crua do provider', () => {
  const raw = new Error('[free-groq] HTTP 429: secret provider payload')
  const clean = sanitizePinnedProviderError(raw, {
    model: 'llama-3.1-8b-instant',
    poolName: 'free-groq',
  })

  assert.match(clean.message, /llama-3\.1-8b-instant/)
  assert.match(clean.message, /free-groq/)
  assert.match(clean.message, /não troquei automaticamente/i)
  assert.doesNotMatch(clean.message, /secret provider payload/)
  assert.equal(clean.cause, raw)
})

test('sanitizePinnedProviderError: pool do aparelho não sugere chave ou cota', () => {
  const clean = sanitizePinnedProviderError(new Error('connection refused'), {
    model: 'local:qwen2.5-0.5b', poolName: 'thinkiac-mobile-local',
  })
  assert.match(clean.message, /modelo foi baixado/i)
  assert.doesNotMatch(clean.message, /chave, a cota/i)
})

test('resolveRequestMaxTokens: limita o global ao TPM conhecido do acesso free', () => {
  const selected = { metadata: { limits: { tpm: 6000 } } }
  assert.equal(resolveRequestMaxTokens({ llm: { max_tokens: 8192 } }, selected, 44), 5956)
})

test('resolveRequestMaxTokens: preserva o global quando o acesso não declara teto', () => {
  assert.equal(resolveRequestMaxTokens({ llm: { max_tokens: 8192 } }, null), 8192)
  assert.equal(resolveRequestMaxTokens({ llm: { max_tokens: 4096 } }, { metadata: { limits: { tpm: 6000 } } }), 4096)
})

test('estimateRequestInputTokens: inclui system, mensagens, tools e overhead do protocolo', () => {
  const small = estimateRequestInputTokens({ system: 'a', messages: [{ role: 'user', content: 'b' }] })
  const withTools = estimateRequestInputTokens({
    system: 'a',
    messages: [{ role: 'user', content: 'b' }],
    tools: [{ name: 'search', input_schema: { type: 'object' } }],
  })
  assert.ok(small >= 32)
  assert.ok(withTools > small)
})
