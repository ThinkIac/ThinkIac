import test from 'node:test'
import assert from 'node:assert/strict'
import { __testables } from '../llm/llm.js'

const { textFromCliNdjson } = __testables











const LEAKED_TURN = [
  '{"type":"system","subtype":"init","cwd":"/root/.agent/cli-workspaces/orbit-x","session_id":"c42b5077","tools":[],"model":"claude-fable-5"}',
  '{"type":"stream_event","event":{"type":"message_start","message":{"role":"assistant","content":[]}}}',
  '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"signature_delta","signature":"abc"}}}',
  '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"run_shell","input":{"command":"cd packages/lectio && find . -type f"}}]}}',
  '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tu_1","content":"./BLUEPRINT.md\\n./package.json"}]}}',
  '{"type":"result","subtype":"success","is_error":false,"stop_reason":"end_turn","result":"","usage":{"input_tokens":4,"output_tokens":49}}',
].join('\n')

test('turno que termina sem texto visível não vaza o protocolo', () => {
  const out = textFromCliNdjson(LEAKED_TURN)
  assert.equal(out, '')
})

test('nenhum fragmento do protocolo/tool call escapa pro texto', () => {
  const out = textFromCliNdjson(LEAKED_TURN)
  for (const leak of ['tool_use', 'stream_event', 'run_shell', 'session_id', 'packages/lectio', 'BLUEPRINT.md']) {
    assert.ok(!out.includes(leak), `vazou "${leak}" no texto visível`)
  }
})

test('o texto do evento result é a palavra final', () => {
  const ndjson = [
    '{"type":"system","subtype":"init","session_id":"abc"}',
    '{"type":"assistant","message":{"content":[{"type":"text","text":"Olá"}]}}',
    '{"type":"result","subtype":"success","result":"Olá, tudo certo."}',
  ].join('\n')
  
  assert.equal(textFromCliNdjson(ndjson), 'Olá, tudo certo.')
})

test('stream truncado antes do result cai nos blocos de texto do assistant', () => {
  const ndjson = [
    '{"type":"system","subtype":"init","session_id":"abc"}',
    '{"type":"assistant","message":{"content":[{"type":"text","text":"parte 1 "}]}}',
    '{"type":"assistant","message":{"content":[{"type":"text","text":"parte 2"}]}}',
  ].join('\n')
  assert.equal(textFromCliNdjson(ndjson), 'parte 1 parte 2')
})

test('blocos tool_use nunca entram no texto, mesmo com texto junto', () => {
  const ndjson = [
    '{"type":"assistant","message":{"content":[{"type":"text","text":"Vou verificar."},{"type":"tool_use","name":"run_shell","input":{"command":"ls -la"}}]}}',
  ].join('\n')
  assert.equal(textFromCliNdjson(ndjson), 'Vou verificar.')
})

test('stdout que não é NDJSON volta intacto (binário que ignorou --output-format)', () => {
  assert.equal(textFromCliNdjson('resposta em texto puro\ncom duas linhas'), 'resposta em texto puro\ncom duas linhas')
})

test('linhas não-JSON no meio do NDJSON são ignoradas, não coladas no texto', () => {
  const ndjson = [
    'warning: something benign on stdout',
    '{"type":"result","subtype":"success","result":"ok"}',
  ].join('\n')
  assert.equal(textFromCliNdjson(ndjson), 'ok')
})

test('entradas vazias/nulas não quebram', () => {
  assert.equal(textFromCliNdjson(''), '')
  assert.equal(textFromCliNdjson(null), '')
  assert.equal(textFromCliNdjson(undefined), '')
})
