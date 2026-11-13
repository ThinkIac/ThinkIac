import test from 'node:test'
import assert from 'node:assert/strict'
import { ModelGateway, normalizeModelResponse } from './model_gateway.js'

const raw = {
  _model: 'm1', _provider: 'p1', usage: { prompt_tokens: 3, completion_tokens: 2 },
  choices: [{ finish_reason: 'tool_calls', message: {
    content: 'vou executar', reasoning_content: 'razão',
    tool_calls: [{ id: 'c1', function: { name: 'sum', arguments: '{"a":1}' } }],
  } }],
}

test('normaliza resposta comum e streaming no mesmo ModelResponse', async () => {
  const gateway = new ModelGateway({
    call: async () => raw,
    stream: async () => raw,
  })
  const common = await gateway.request({ mode: 'call' })
  const streamed = await gateway.request({ mode: 'stream' })

  assert.deepEqual({ ...common, raw: null, mode: null }, { ...streamed, raw: null, mode: null })
  assert.equal(common.ok, true)
  assert.equal(common.toolCalls[0].name, 'sum')
  assert.equal(common.usage.inputTokens, 3)
})

test('normaliza erros do provider sem expor campos arbitrários', async () => {
  const gateway = new ModelGateway({ call: async () => { throw Object.assign(new Error('sem cota'), { code: 'RATE_LIMIT', retryable: true, secret: 'x' }) } })
  const response = await gateway.request({ mode: 'call' })
  assert.deepEqual(response.error, { code: 'RATE_LIMIT', message: 'sem cota', retryable: true, category: 'provider' })
  assert.equal(response.ok, false)
  assert.equal('secret' in response.error, false)
})

test('aceita formato simples do evento llm:call', () => {
  const response = normalizeModelResponse({ success: true, text: 'oi', model: 'm2', provider: 'p2' })
  assert.equal(response.text, 'oi')
  assert.equal(response.model, 'm2')
})
