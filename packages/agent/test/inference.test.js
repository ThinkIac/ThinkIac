import assert from 'node:assert/strict'
import test from 'node:test'
import { describeInferenceCapabilities, runInference } from '../inference.js'

test('encaminha embedding pelo evento existente com resposta tipada', async () => {
  const result = await runInference({ kind: 'embedding', input: { text: 'olá' } }, async (name, payload) => {
    assert.equal(name, 'llm:embed')
    assert.equal(payload.text, 'olá')
    return [0.6, 0.8]
  })
  assert.equal(result.ok, true)
  assert.equal(result.output.dimensions, 2)
})

test('visão encaminha imagens ao llm sem executar tools', async () => {
  const result = await runInference({
    kind: 'vision', input: { text: 'Descreva', images: [{ url: 'https://example.test/a.png' }] }, tools: [{ type: 'function' }],
  }, async (name, payload) => {
    assert.equal(name, 'llm:call')
    assert.equal(payload.messages[0].content[1].type, 'image_url')
    assert.equal(payload.tools.length, 1)
    return { success: true, text: 'Uma imagem.', model: 'vision-model' }
  })
  assert.equal(result.ok, true)
  assert.equal(result.output.text, 'Uma imagem.')
})

test('rejeita STT sem áudio autorizado antes de chamar um provider', async () => {
  const result = await runInference({ kind: 'stt', input: {} }, async () => null)
  assert.deepEqual(result, { ok: false, kind: 'stt', error: { code: 'invalid_input', message: 'STT exige input.audioPath de um áudio já autorizado pelo Runtime.' } })
})

test('capabilities declara separadamente visão e tipos ainda indisponíveis', () => {
  const info = describeInferenceCapabilities({ accesses: [{ capabilities: { vision: { supported: true } } }] })
  assert.equal(info.protocol, 'thinkiac.inference/v1')
  assert.equal(info.kinds.find(item => item.kind === 'vision').available, true)
  assert.equal(info.kinds.find(item => item.kind === 'stt').available, true)
})
