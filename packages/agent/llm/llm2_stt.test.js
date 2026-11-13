import assert from 'node:assert/strict'
import { buildSlots, getNextSlot } from './llm_keys.js'
import { selectHttpSTTSlots } from './llm2.js'

let passed = 0
function test(name, fn) {
  fn()
  passed++
  console.log(`PASS ${name}`)
}

const pool = (name, provider, extra = {}) => ({
  name,
  provider,
  enabled: true,
  ...extra,
})

test('pool exclusivamente CLI não oferece slot para STT', () => {
  const slots = buildSlots({
    llm: { pools: [pool('codex-engineer', 'codex-cli')] },
  })

  assert.ok(slots.length > 0)
  assert.ok(slots.every(slot => slot.mode === 'cli'))
  assert.deepEqual(selectHttpSTTSlots(slots), [])
})

test('pool HTTP válido oferece slot para STT', () => {
  const slots = buildSlots({
    llm: {
      pools: [
        pool('openrouter-stt', 'openrouter', {
          api_keys: ['test-key'],
          base_url: 'https://openrouter.ai/api/v1',
        }),
      ],
    },
  })

  const eligible = selectHttpSTTSlots(slots)
  assert.equal(eligible.length, 1)
  assert.equal(eligible[0].mode, 'http')
  assert.match(eligible[0].url, /^https:/)
})

test('configuração mista exclui CLI e mantém round-robin entre slots HTTP', () => {
  const slots = buildSlots({
    llm: {
      pools: [
        pool('codex-engineer', 'codex-cli'),
        pool('openrouter-stt', 'openrouter', {
          api_keys: ['key-a', 'key-b'],
          base_url: 'https://openrouter.ai/api/v1',
        }),
      ],
    },
  })

  const eligible = selectHttpSTTSlots(slots)
  assert.equal(eligible.length, 2)
  assert.ok(eligible.every(slot => slot.mode === 'http'))
  assert.notEqual(getNextSlot(eligible).id, getNextSlot(eligible).id)
})

test('slot HTTP com URL inválida é rejeitado', () => {
  assert.deepEqual(selectHttpSTTSlots([
    { mode: 'http', url: 'sem-protocolo' },
    { mode: 'http', url: 'ftp://example.com/chat/completions' },
  ]), [])
})

console.log(`\n${passed} testes passaram`)
