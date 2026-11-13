import test from 'node:test'
import assert from 'node:assert/strict'
import {
  registerTool,
  invokeTool,
  hasTool,
  listToolSchemas,
  deleteTool,
  buildSchema,
} from '../core/registry.js'






let seq = 0
const nextName = () => `__test_tool_${process.pid}_${seq++}`

const schema = (over = {}) => ({
  description: 'ferramenta de teste',
  input_schema: { type: 'object', properties: {}, required: [] },
  ...over,
})

test('schema vazio produz objeto sem propriedades nem obrigatórios', () => {
  assert.deepEqual(buildSchema([]), { type: 'object', properties: {}, required: [] })
  assert.deepEqual(buildSchema(), { type: 'object', properties: {}, required: [] })
})

test('parâmetro sem optional entra como obrigatório', () => {
  const out = buildSchema([{ name: 'q', type: 'string', description: 'consulta' }])

  assert.deepEqual(out, {
    type: 'object',
    properties: { q: { type: 'string', description: 'consulta' } },
    required: ['q'],
  })
})

test('parâmetro optional fica fora de required mas continua no schema', () => {
  const out = buildSchema([
    { name: 'q', type: 'string', description: 'consulta' },
    { name: 'limite', type: 'number', description: 'máximo', optional: true },
  ])

  assert.deepEqual(Object.keys(out.properties), ['q', 'limite'])
  assert.deepEqual(out.required, ['q'], 'só o não-opcional é exigido')
  assert.equal(out.properties.limite.type, 'number')
})

test('parâmetros repetidos: o último vence nas propriedades', () => {
  const out = buildSchema([
    { name: 'x', type: 'string', description: 'primeiro' },
    { name: 'x', type: 'number', description: 'segundo' },
  ])

  assert.equal(out.properties.x.type, 'number')
  
  
  assert.deepEqual(out.required, ['x', 'x'])
})

test('registro fica consultável e some depois de removido', () => {
  const name = nextName()
  assert.equal(hasTool(name), false)

  registerTool(name, schema(), async () => 'ok')
  assert.equal(hasTool(name), true)

  deleteTool(name)
  assert.equal(hasTool(name), false)
})

test('remover tool inexistente não estoura', () => {
  assert.doesNotThrow(() => deleteTool(nextName()))
})

test('invocação passa o input e devolve o resultado', async () => {
  const name = nextName()
  let recebido
  registerTool(name, schema(), async input => {
    recebido = input
    return { eco: input.valor }
  })

  const out = await invokeTool(name, { valor: 42 })
  assert.deepEqual(out, { eco: 42 })
  assert.deepEqual(recebido, { valor: 42 })

  deleteTool(name)
})

test('invocação sem input entrega objeto vazio, não undefined', async () => {
  const name = nextName()
  let recebido = 'não chamado'
  registerTool(name, schema(), async input => { recebido = input })

  await invokeTool(name)
  assert.deepEqual(recebido, {})

  deleteTool(name)
})

test('invocar tool inexistente falha com o nome no erro', async () => {
  const name = nextName()

  await assert.rejects(() => invokeTool(name), new RegExp(`Tool "${name}" not found`))
})

test('erro de dentro da tool propaga para quem invocou', async () => {
  const name = nextName()
  registerTool(name, schema(), async () => { throw new Error('falhou por dentro') })

  await assert.rejects(() => invokeTool(name), /falhou por dentro/)

  deleteTool(name)
})

test('função síncrona também é aceita', async () => {
  const name = nextName()
  registerTool(name, schema(), () => 'valor síncrono')

  assert.equal(await invokeTool(name), 'valor síncrono')

  deleteTool(name)
})

test('registrar o mesmo nome substitui a implementação anterior', async () => {
  const name = nextName()
  registerTool(name, schema({ description: 'antiga' }), async () => 'antiga')
  registerTool(name, schema({ description: 'nova' }), async () => 'nova')

  assert.equal(await invokeTool(name), 'nova')
  const entrada = listToolSchemas().filter(t => t.name === name)
  assert.equal(entrada.length, 1, 'não pode duplicar a entrada no catálogo')
  assert.equal(entrada[0].description, 'nova')

  deleteTool(name)
})

test('catálogo expõe nome, descrição, schema e modo — e nada mais', () => {
  const name = nextName()
  const input_schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] }
  registerTool(name, schema({ input_schema }), async () => null)

  const entrada = listToolSchemas().find(t => t.name === name)
  assert.deepEqual(Object.keys(entrada).sort(), ['description', 'input_schema', 'mode', 'name'])
  assert.deepEqual(entrada.input_schema, input_schema)
  
  assert.equal(entrada.fn, undefined)

  deleteTool(name)
})

test('modo default é sandbox e pode ser sobrescrito', () => {
  const padrao = nextName()
  const permanente = nextName()
  registerTool(padrao, schema(), async () => null)
  registerTool(permanente, schema(), async () => null, 'permanent')

  const catalogo = listToolSchemas()
  assert.equal(catalogo.find(t => t.name === padrao).mode, 'sandbox')
  assert.equal(catalogo.find(t => t.name === permanente).mode, 'permanent')

  deleteTool(padrao)
  deleteTool(permanente)
})
