/**
 * Testes de mcp_schema — a rede que impede uma tool malformada de derrubar o
 * chat inteiro (a API rejeita a requisição toda com 400 se qualquer chave de
 * propriedade fugir de ^[a-zA-Z0-9_.-]{1,64}$).
 *
 * Roda com: node llm/mcp_schema.test.js
 */

import { sanitizeTools, sanitizeSchema, VALID_KEY } from './mcp_schema.js'

let passed = 0, failed = 0
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`) }
  else { failed++; console.error(`  ❌ ${msg}`) }
}


{
  const tools = [{
    name: 'filemanage_copy',
    inputSchema: {
      type: 'object',
      properties: {
        '[input': { type: 'object' },
        '[input.path]': { type: 'string' },
        '[input.paths]': { type: 'array', items: { type: 'string' } },
      },
      required: ['[input', '[input.path]', '[input.paths]'],
    },
  }]
  let aviso = ''
  const [out] = sanitizeTools(tools, m => { aviso = m })
  const keys = Object.keys(out.inputSchema.properties)
  assert(keys.length === 0, 'chaves com colchete são removidas')
  assert(out.inputSchema.required.length === 0, 'required não cita chave removida')
  assert(/filemanage_copy\.\[input/.test(aviso), 'avisa qual tool/chave foi removida')
}


{
  const tools = [{
    name: 'ok_tool',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        'input.path': { type: 'string' },
        'a-b': { type: 'string' },
        n1: { type: 'number' },
      },
      required: ['session_id', 'input.path'],
    },
  }]
  let aviso = ''
  const [out] = sanitizeTools(tools, m => { aviso = m })
  assert(Object.keys(out.inputSchema.properties).length === 4, 'snake_case/dot/hífen preservados')
  assert(out.inputSchema.required.join(',') === 'session_id,input.path', 'required preservado')
  assert(aviso === '', 'nada a avisar quando tudo é válido')
}


{
  const [out] = sanitizeTools([{
    name: 'mix',
    inputSchema: {
      type: 'object',
      properties: { bom: { type: 'string' }, 'ru im': { type: 'string' } },
      required: ['bom', 'ru im'],
    },
  }])
  assert(Object.keys(out.inputSchema.properties).join() === 'bom', 'só a chave inválida sai')
  assert(out.inputSchema.required.join() === 'bom', 'required perde só a inválida')
}


{
  const dropped = []
  const s = sanitizeSchema({
    type: 'object',
    properties: {
      nested: { type: 'object', properties: { ok: { type: 'string' }, '[ruim]': { type: 'string' } } },
      lista: { type: 'array', items: { type: 'object', properties: { '[x]': { type: 'string' }, y: { type: 'string' } } } },
    },
  }, 'rec', dropped)
  assert(Object.keys(s.properties.nested.properties).join() === 'ok', 'saneia properties aninhadas')
  assert(Object.keys(s.properties.lista.items.properties).join() === 'y', 'saneia items de array')
  assert(dropped.length === 2, 'reporta as duas chaves aninhadas removidas')
}


{
  assert(sanitizeTools(null).length === 0, 'tools null → lista vazia')
  assert(sanitizeTools([{ name: 'sem_schema' }])[0].name === 'sem_schema', 'tool sem schema passa intacta')
  const [snake] = sanitizeTools([{ name: 's', input_schema: { type: 'object', properties: { '[a]': {} , b: {} } } }])
  assert(Object.keys(snake.input_schema.properties).join() === 'b', 'suporta input_schema (snake_case)')
  assert(snake.inputSchema === undefined, 'não inventa inputSchema quando veio input_schema')
}


{
  const longa = 'a'.repeat(65)
  assert(VALID_KEY.test('a'.repeat(64)) === true, 'chave de 64 chars é válida')
  assert(VALID_KEY.test(longa) === false, 'chave de 65 chars é inválida')
  const [out] = sanitizeTools([{ name: 'l', inputSchema: { type: 'object', properties: { [longa]: {} } } }])
  assert(Object.keys(out.inputSchema.properties).length === 0, 'chave longa demais é removida')
}

console.log(`\n${failed === 0 ? '✅' : '❌'} mcp_schema: ${passed} passaram, ${failed} falharam`)
process.exit(failed === 0 ? 0 : 1)
