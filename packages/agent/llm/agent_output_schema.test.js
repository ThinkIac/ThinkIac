










import assert from 'node:assert/strict'
import test from 'node:test'

import { __testables } from './llm.js'

const { extractJsonBlock, schemaMismatch, schemaInstruction } = __testables

test('JSON limpo é aceito como está', () => {
    assert.deepEqual(extractJsonBlock('{"a":1,"b":"x"}'), { a: 1, b: 'x' })
})

test('JSON dentro de cerca ```json é desembrulhado', () => {
    const text = 'Aqui está:\n```json\n{"ok": true}\n```\nEspero ter ajudado!'
    assert.deepEqual(extractJsonBlock(text), { ok: true })
})

test('prosa antes e depois do JSON não impede a extração', () => {
    assert.deepEqual(extractJsonBlock('Claro! {"n": 2} pronto.'), { n: 2 })
})

test('chave de fechamento DENTRO de string não corta o JSON no lugar errado', () => {
    
    
    assert.deepEqual(extractJsonBlock('{"texto":"a}b","n":1}'), { texto: 'a}b', n: 1 })
})

test('array no topo é suportado', () => {
    assert.deepEqual(extractJsonBlock('```\n[1,2,3]\n```'), [1, 2, 3])
})

test('resposta sem JSON nenhum devolve null (e não lança)', () => {
    assert.equal(extractJsonBlock('Desculpe, não consegui.'), null)
    assert.equal(extractJsonBlock(''), null)
    assert.equal(extractJsonBlock(undefined), null)
})

test('JSON sintaticamente quebrado devolve null em vez de objeto pela metade', () => {
    assert.equal(extractJsonBlock('{"a": 1,,,}'), null)
})

test('schemaMismatch aprova objeto com todos os required', () => {
    const schema = { type: 'object', properties: { id: {}, nome: {} }, required: ['id', 'nome'] }
    assert.equal(schemaMismatch({ id: 'x', nome: 'y' }, schema), null)
})

test('schemaMismatch nomeia os campos obrigatórios que faltam', () => {
    const schema = { type: 'object', required: ['id', 'nome', 'idade'] }
    const problem = schemaMismatch({ id: 'x' }, schema)
    assert.match(problem, /nome/)
    assert.match(problem, /idade/)
})

test('schemaMismatch cobra o tipo do topo', () => {
    assert.match(schemaMismatch([1, 2], { type: 'object' }), /objeto JSON/)
    assert.match(schemaMismatch({ a: 1 }, { type: 'array' }), /array JSON/)
    assert.match(schemaMismatch('texto', {}), /objeto JSON/)
})

test('campo obrigatório presente com valor null/false conta como presente', () => {
    
    
    const schema = { type: 'object', required: ['ativo', 'total', 'nota'] }
    assert.equal(schemaMismatch({ ativo: false, total: 0, nota: null }, schema), null)
})

test('a instrução de formato carrega o schema literal para o modelo', () => {
    const schema = { type: 'object', required: ['id'] }
    const txt = schemaInstruction(schema)
    assert.ok(txt.includes(JSON.stringify(schema)))
    assert.match(txt, /SOMENTE/)
})
