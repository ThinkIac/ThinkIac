import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_TOOL_RESULT_MAX_CHARS,
  serializeToolResult,
} from '../llm/tool_results.js'

test('string curta passa intacta, sem reserialização', () => {
  assert.equal(serializeToolResult('resultado'), 'resultado')
  
  assert.doesNotMatch(serializeToolResult('resultado'), /^"/)
})

test('objeto vira JSON indentado', () => {
  assert.equal(serializeToolResult({ a: 1 }), '{\n  "a": 1\n}')
})

test('valores não-objeto viram sua forma JSON', () => {
  assert.equal(serializeToolResult(42), '42')
  assert.equal(serializeToolResult(true), 'true')
  assert.equal(serializeToolResult(null), 'null')
})

test('undefined não vira a string "undefined"', () => {
  
  
  const out = serializeToolResult(undefined)
  assert.notEqual(out, 'undefined')
})

test('estrutura circular cai no fallback em vez de estourar', () => {
  const circular = { nome: 'loop' }
  circular.self = circular

  assert.equal(serializeToolResult(circular), '{"error":"resultado não serializável"}')
})

test('BigInt também cai no fallback', () => {
  
  assert.equal(serializeToolResult({ n: 1n }), '{"error":"resultado não serializável"}')
})

test('resultado exatamente no limite não é truncado', () => {
  const exato = 'x'.repeat(DEFAULT_TOOL_RESULT_MAX_CHARS)

  assert.equal(serializeToolResult(exato), exato)
  assert.doesNotMatch(serializeToolResult(exato), /truncated/)
})

test('um caractere acima do limite é truncado com rodapé informativo', () => {
  const grande = 'x'.repeat(DEFAULT_TOOL_RESULT_MAX_CHARS + 1)
  const out = serializeToolResult(grande)

  assert.match(out, /\[tool result truncated\]/)
  assert.match(out, new RegExp(`original_chars=${DEFAULT_TOOL_RESULT_MAX_CHARS + 1}`))
  assert.match(out, new RegExp(`kept_chars=${DEFAULT_TOOL_RESULT_MAX_CHARS}`))
  assert.equal(out.slice(0, DEFAULT_TOOL_RESULT_MAX_CHARS), grande.slice(0, DEFAULT_TOOL_RESULT_MAX_CHARS))
})

test('limite customizado é respeitado', () => {
  const out = serializeToolResult('abcdefghij', 4)

  assert.match(out, /^abcd\n\n\[tool result truncated\]/)
  assert.match(out, /original_chars=10 kept_chars=4/)
})

test('objeto grande é truncado depois de serializado, não antes', () => {
  const out = serializeToolResult({ texto: 'y'.repeat(200) }, 50)

  assert.equal(out.slice(0, 50).length, 50)
  assert.match(out, /original_chars=\d+ kept_chars=50/)
  
  const original = Number(out.match(/original_chars=(\d+)/)[1])
  assert.ok(original > 200, `esperava contar o JSON serializado, veio ${original}`)
})

test('limite zero trunca tudo e ainda reporta o tamanho original', () => {
  const out = serializeToolResult('abc', 0)

  assert.match(out, /^\n\n\[tool result truncated\] original_chars=3 kept_chars=0$/)
})

test('o teto default é o contratado', () => {
  assert.equal(DEFAULT_TOOL_RESULT_MAX_CHARS, 24_000)
})
