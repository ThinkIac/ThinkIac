







import assert from 'node:assert/strict'
import test from 'node:test'

import { sanitizeTitles, padTitles, STATIC_TITLES } from './thinking_titles.js'

test('frases válidas passam limpas e no máximo 5', () => {
  const out = sanitizeTitles(['Reading the diff', 'Checking imports', 'Tracing the call', 'Writing tests', 'Reviewing edge cases', 'Extra one'])
  assert.equal(out.length, 5)
  assert.equal(out[0], 'Reading the diff')
})

test('pontuação final e espaços duplicados são normalizados', () => {
  assert.deepEqual(sanitizeTitles(['  Reading   the diff.  ']), ['Reading the diff'])
  assert.deepEqual(sanitizeTitles(['Thinking…']), ['Thinking'])
})

test('duplicatas (ignorando caixa) entram uma vez só', () => {
  assert.deepEqual(sanitizeTitles(['Reading files', 'reading FILES']), ['Reading files'])
})

test('item inválido é descartado sem invalidar os demais', () => {
  
  
  const out = sanitizeTitles([null, 42, 'x'.repeat(80), 'Parsing the schema', {}])
  assert.deepEqual(out, ['Parsing the schema'])
})

test('entrada que não é lista vira lista vazia (não lança)', () => {
  assert.deepEqual(sanitizeTitles(undefined), [])
  assert.deepEqual(sanitizeTitles('Reading files'), [])
  assert.deepEqual(sanitizeTitles(null), [])
})

test('padTitles completa até 3 usando as estáticas', () => {
  const out = padTitles(['Parsing the schema'])
  assert.equal(out.length, 3)
  assert.equal(out[0], 'Parsing the schema')
  assert.ok(out.slice(1).every(t => STATIC_TITLES.includes(t)))
})

test('padTitles não repete uma estática que o modelo já devolveu', () => {
  const out = padTitles(['Connecting the dots'])
  const lower = out.map(t => t.toLowerCase())
  assert.equal(new Set(lower).size, lower.length)
})

test('modelo mudo resulta nas 3 estáticas — nunca cabeçalho vazio', () => {
  const out = padTitles([])
  assert.equal(out.length, 3)
  assert.ok(out.every(t => STATIC_TITLES.includes(t)))
})

test('já tendo 3+ frases, padTitles não acrescenta nada', () => {
  const mine = ['A one', 'B two', 'C three', 'D four']
  assert.deepEqual(padTitles(mine), mine)
})
