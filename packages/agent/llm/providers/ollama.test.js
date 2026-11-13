import test from 'node:test'
import assert from 'node:assert/strict'

import {
  toCatalogModel,
  prettyOllamaName,
  ollamaBase,
  convertMessages,
  buildOllamaBody,
  compactOllamaInput,
  resolveOllamaOptions,
  applyOllamaDiscovery,
  refreshOllamaModels,
  getOllamaSnapshot,
  ollamaHasModel,
  runOllamaTurn,
  __setOllamaSnapshot,
} from './ollama.js'
import { buildModelCatalog, resolveModel } from '../model_catalog.js'
import { buildSlots } from '../llm_keys.js'

const BASE = 'http://ollama.test:11434'

const TAGS = {
  models: [
    {
      name: 'qwen2.5:3b', model: 'qwen2.5:3b', size: 1929912432,
      details: { parameter_size: '3.1B', context_length: 32768 },
      capabilities: ['completion', 'tools'],
    },
    {
      name: 'phi3:latest', model: 'phi3:latest', size: 2176178913,
      details: { parameter_size: '3.8B', context_length: 131072 },
      capabilities: ['completion'],
    },
    {
      name: 'lab/thinker:latest', model: 'lab/thinker:latest', size: 731000000,
      details: { parameter_size: '1.2B', context_length: 128000 },
      capabilities: ['completion', 'tools', 'thinking', 'vision'],
    },
    {
      name: 'nomic-embed-text:latest', model: 'nomic-embed-text:latest', size: 274302450,
      details: { parameter_size: '137M', context_length: 2048 },
      capabilities: ['embedding'],
    },
  ],
}

/** Instala um fetch falso e devolve o registro das chamadas. */
function stubFetch(handler) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null
    calls.push({ url: String(url), body })
    return handler(String(url), body, calls.length)
  }
  return { calls, restore: () => { globalThis.fetch = original } }
}

const jsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status, headers: { 'Content-Type': 'application/json' },
})

/** Resposta NDJSON como o /api/chat manda (uma linha por chunk). */
const ndjsonResponse = (chunks) => new Response(chunks.map(c => JSON.stringify(c)).join('\n') + '\n', {
  status: 200, headers: { 'Content-Type': 'application/x-ndjson' },
})



test('ollamaBase normaliza a URL do slot de volta pra raiz da API', () => {
  assert.equal(ollamaBase({ url: 'http://localhost:11434/v1/chat/completions' }), 'http://localhost:11434')
  assert.equal(ollamaBase({ baseUrl: 'http://host:1/v1/' }), 'http://host:1')
  assert.equal(ollamaBase({ baseUrl: 'http://host:1/' }), 'http://host:1')
  assert.equal(ollamaBase({}), 'http://localhost:11434')
})

test('prettyOllamaName tira o namespace, esconde :latest e mostra o tamanho', () => {
  assert.equal(prettyOllamaName('soyamigomike/qwen3.5-abliterated:latest', '4.5B'), 'Qwen3.5 Abliterated · 4.5B')
  assert.equal(prettyOllamaName('phi3:latest'), 'Phi3')
  assert.equal(prettyOllamaName('glm-5.2:cloud'), 'Glm 5.2 · cloud')
})

test('toCatalogModel traduz as capabilities do daemon em capacidades do catálogo', () => {
  const [qwen, phi, thinker, embed] = TAGS.models.map(toCatalogModel)

  assert.equal(qwen.capabilities.tools.supported, true)
  assert.equal(qwen.capabilities.tools.native, true)
  assert.equal(qwen.capabilities.contextWindow, 32768)
  assert.equal(qwen.capabilities.modalities.vision.input, false)
  assert.equal(qwen.capabilities.reasoning.supported, false)

  
  
  assert.equal(phi.capabilities.tools.supported, true)
  assert.equal(phi.capabilities.tools.native, false)
  assert.equal(phi.capabilities.tools.emulated, false)
  assert.match(phi.purpose.description, /tools por texto/)

  assert.equal(thinker.capabilities.reasoning.supported, true)
  assert.equal(thinker.capabilities.modalities.vision.input, true)
  assert.equal(thinker.name, 'Thinker · 1.2B')

  
  
  const capabilities = qwen.evidence.map(e => e.capability)
  assert.ok(capabilities.includes('tools.supported'))
  assert.ok(capabilities.includes('modalities.text.input'))
  assert.ok(qwen.evidence.every(e => e.score < 0.5), 'prior de qualidade local fica abaixo do neutro')

  assert.equal(embed._ollama.embedding, true)
})

test('refreshOllamaModels descobre tudo que está baixado, embeddings inclusive', async () => {
  const stub = stubFetch(() => jsonResponse(TAGS))
  try {
    const snapshot = await refreshOllamaModels(BASE, { force: true })
    assert.equal(snapshot.reachable, true)
    assert.match(stub.calls[0].url, /\/api\/tags$/)
    assert.deepEqual(snapshot.models.map(m => m.id), TAGS.models.map(m => m.model))

    
    
    
    assert.equal(ollamaHasModel(BASE, 'nomic-embed-text'), true)
    assert.equal(ollamaHasModel(BASE, 'phi3'), true)
    assert.equal(ollamaHasModel(BASE, 'llama3'), false)
  } finally {
    stub.restore()
    __setOllamaSnapshot(BASE, null)
  }
})

test('daemon sem `capabilities` em /api/tags é completado por /api/show', async () => {
  
  
  const stub = stubFetch((url, body) => url.endsWith('/api/tags')
    ? jsonResponse({ models: [
        { name: 'velho:7b', model: 'velho:7b', details: { parameter_size: '7B' } },
        { name: 'antigo:3b', model: 'antigo:3b', details: { parameter_size: '3B' } },
      ] })
    : jsonResponse({
        capabilities: body.model === 'velho:7b' ? ['completion', 'tools'] : ['completion'],
        details: { parameter_size: body.model === 'velho:7b' ? '7B' : '3B' },
        model_info: { context_length: 8192 },
      }))
  try {
    const { models } = await refreshOllamaModels(BASE, { force: true })
    
    assert.deepEqual(models.map(m => [m.id, m.capabilities.tools.native]), [
      ['velho:7b', true],
      ['antigo:3b', false],
    ])
    assert.equal(models[0].capabilities.contextWindow, 8192)
  } finally {
    stub.restore()
    __setOllamaSnapshot(BASE, null)
  }
})

test('daemon fora do ar vira snapshot inalcançável, não exceção', async () => {
  const stub = stubFetch(() => { throw new Error('ECONNREFUSED') })
  try {
    const snapshot = await refreshOllamaModels(BASE, { force: true })
    assert.equal(snapshot.reachable, false)
    assert.deepEqual(snapshot.models, [])
    assert.match(snapshot.error, /ECONNREFUSED/)
  } finally {
    stub.restore()
    __setOllamaSnapshot(BASE, null)
  }
})



const poolConfig = (extra = {}) => ({
  llm: {
    pools: [
      { id: 'local', label: 'Ollama · local', provider: 'ollama', base_url: BASE, model: 'qwen2.5:3b', enabled: true, ...extra },
      {
        id: 'remoto', provider: 'openrouter', model: 'vendor/remoto', api_keys: ['k'], enabled: true,
        
        
        capabilities: { tools: { supported: true } },
      },
    ],
  },
})

test('modelos baixados entram no catálogo como acessos autenticados e selecionáveis', async () => {
  const stub = stubFetch(() => jsonResponse(TAGS))
  try {
    await refreshOllamaModels(BASE, { force: true })
    const config = applyOllamaDiscovery(poolConfig())
    const catalog = buildModelCatalog(config, { slots: buildSlots(config) })
    const local = catalog.accesses.filter(a => a.provider === 'ollama')

    assert.deepEqual(local.map(a => a.id), ['qwen2.5:3b@local', 'phi3:latest@local', 'lab/thinker:latest@local'])
    
    
    assert.ok(local.every(a => a.authenticated && a.available && a.enabled))
    assert.equal(local[0].metadata.poolLabel, 'Ollama · local')

    const picked = resolveModel(catalog, { requires: { modalities: ['text:input'], tools: true }, override: 'qwen2.5:3b@local' })
    assert.equal(picked.ok, true, 'modelo com tools nativas deveria ser selecionável')
    assert.equal(picked.selected.metadata.poolName, 'local')
    const textOnly = resolveModel(catalog, { requires: { modalities: ['text:input'], tools: true }, override: 'phi3:latest@local' })
    assert.equal(textOnly.ok, true, 'modelo local sem tools nativas continua selecionável para conversa')

    
    const auto = resolveModel(catalog, { requires: { modalities: ['text:input'], tools: true } })
    assert.equal(auto.selected.provider, 'openrouter')
  } finally {
    stub.restore()
    __setOllamaSnapshot(BASE, null)
  }
})

test('daemon inalcançável deixa o pool indisponível em vez de listar modelo fantasma', () => {
  __setOllamaSnapshot(BASE, { reachable: false, models: [], cold: false })
  try {
    const config = applyOllamaDiscovery(poolConfig())
    const catalog = buildModelCatalog(config, { slots: buildSlots(config) })
    const local = catalog.accesses.filter(a => a.provider === 'ollama')
    assert.ok(local.every(a => a.available === false))
    const auto = resolveModel(catalog, { requires: { modalities: ['text:input'] } })
    assert.equal(auto.selected.provider, 'openrouter')
  } finally {
    __setOllamaSnapshot(BASE, null)
  }
})

test('default do pool cai num modelo baixado quando o do config não existe', () => {
  __setOllamaSnapshot(BASE, { models: TAGS.models.map(toCatalogModel) })
  try {
    const config = applyOllamaDiscovery(poolConfig({ model: 'llama3:70b' }))
    const pool = config.llm.pools[0]
    assert.equal(pool.model, 'qwen2.5:3b', 'primeiro modelo com tools nativas')
    assert.equal(pool.capabilities_model, 'qwen2.5:3b')
    
    assert.equal(poolConfig({ model: 'llama3:70b' }).llm.pools[0].model, 'llama3:70b')
  } finally {
    __setOllamaSnapshot(BASE, null)
  }
})



const HISTORY = [
  { role: 'user', content: 'que horas são?' },
  { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_time', arguments: '{"city":"Tokyo"}' } }] },
  { role: 'tool', tool_call_id: 'c1', content: '{"hour":9}' },
]

test('convertMessages nativo usa tool_calls/role tool do ollama', () => {
  const out = convertMessages(HISTORY)
  assert.deepEqual(out[1].tool_calls, [{ function: { name: 'get_time', arguments: { city: 'Tokyo' } } }])
  assert.equal(out[2].role, 'tool')
  assert.equal(out[2].tool_name, 'get_time')
})

test('convertMessages emulado reescreve o histórico no protocolo de texto', () => {
  const out = convertMessages(HISTORY, { emulated: true })
  
  assert.ok(out.every(m => m.role !== 'tool'))
  assert.match(out[1].content, /```tool_call\n\{"name":"get_time","input":\{"city":"Tokyo"\}\}\n```/)
  assert.match(out[2].content, /Resultado da ferramenta get_time/)
})

test('convertMessages extrai imagens base64 pro campo images', () => {
  const [message] = convertMessages([{
    role: 'user',
    content: [
      { type: 'text', text: 'o que é isso?' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
    ],
  }])
  assert.equal(message.content, 'o que é isso?')
  assert.deepEqual(message.images, ['QUJD'])
})

test('buildOllamaBody manda tools nativas ou preâmbulo de texto, nunca os dois', () => {
  const tools = [{ name: 'get_time', description: 'hora', input_schema: { type: 'object', properties: {} } }]

  const native = buildOllamaBody({ model: 'm', system: 'sys', messages: [], tools, emulated: false, think: true })
  assert.equal(native.tools[0].function.name, 'get_time')
  assert.equal(native.think, true)
  assert.equal(native.messages[0].content, 'sys')

  const emulated = buildOllamaBody({ model: 'm', system: 'sys', messages: [], tools, emulated: true })
  assert.equal(emulated.tools, undefined, 'mandar tools pra modelo sem suporte é HTTP 400')
  assert.match(emulated.messages[0].content, /```tool_call/)
})

test('compactOllamaInput limita somente o perfil local e preserva o último pedido', () => {
  const full = compactOllamaInput({
    system: 's'.repeat(20_000),
    messages: [
      { role: 'user', content: 'histórico antigo'.repeat(500) },
      { role: 'user', content: 'pedido mais recente' },
    ],
    maxInputTokens: 1800,
  })
  assert.ok(full.system.length < 4_000)
  assert.ok(full.system.includes('[contexto local resumido]'))
  assert.equal(full.messages.at(-1).content, 'pedido mais recente')
  assert.ok(full.system.length + full.messages.reduce((sum, message) => sum + message.content.length, 0) <= 6_300)
  const untouched = compactOllamaInput({ system: 'normal', messages: [{ role: 'user', content: 'oi' }] })
  assert.equal(untouched.system, 'normal')
  assert.equal(untouched.messages.length, 1)
})

test('resolveOllamaOptions dimensiona a janela pelo prompt, com teto e piso', () => {
  const short = resolveOllamaOptions({ contextWindow: 32768, messages: [{ content: 'oi' }], maxTokens: null })
  assert.equal(short.num_ctx, undefined, 'turno curto não pede janela maior que o default do daemon')

  const long = resolveOllamaOptions({
    contextWindow: 32768,
    messages: [{ content: 'x'.repeat(40_000) }],
    maxTokens: 2048,
  })
  assert.ok(long.num_ctx >= 12_288 && long.num_ctx <= 32_768, `num_ctx inesperado: ${long.num_ctx}`)
  assert.equal(long.num_predict, 2048)

  
  
  const operational = resolveOllamaOptions({
    contextWindow: 131072,
    system: 's'.repeat(80_000),
    messages: [{ content: 'oi' }],
    tools: [{ name: 'tool', input_schema: { type: 'object', properties: { payload: { type: 'string', description: 'd'.repeat(4_000) } } } }],
    maxTokens: 4096,
  })
  assert.ok(operational.num_ctx >= 28_672 && operational.num_ctx <= 32_768,
    `janela operacional inesperada: ${operational.num_ctx}`)

  
  const tiny = resolveOllamaOptions({ contextWindow: 2048, messages: [{ content: 'x'.repeat(80_000) }] })
  assert.equal(tiny.num_ctx, 4096)

  
  const forced = resolveOllamaOptions({ contextWindow: 32768, messages: [], overrides: { num_ctx: 30_000 } })
  assert.equal(forced.num_ctx, 30_000)
})



const slotFor = (model) => ({ provider: 'ollama', baseUrl: BASE, model, providerOptions: null })

test('runOllamaTurn separa thinking de resposta e devolve o shape interno', async () => {
  __setOllamaSnapshot(BASE, { models: [toCatalogModel(TAGS.models[2])] })
  const stub = stubFetch(() => ndjsonResponse([
    { message: { role: 'assistant', thinking: 'vou somar' } },
    { message: { role: 'assistant', content: 'quatro' } },
    { done: true, done_reason: 'stop', prompt_eval_count: 11, eval_count: 3 },
  ]))
  try {
    const tokens = []
    const events = []
    const res = await runOllamaTurn(slotFor('lab/thinker:latest'), {
      chainModel: 'lab/thinker:latest',
      system: 'sys',
      messages: [{ role: 'user', content: '2+2?' }],
      onToken: t => tokens.push(t),
      onProgress: e => events.push(e),
    })

    assert.match(stub.calls[0].url, /\/api\/chat$/)
    assert.equal(stub.calls[0].body.think, true, 'modelo com capability thinking pede o raciocínio nativo')
    assert.equal(res.choices[0].message.content, 'quatro')
    assert.equal(res.choices[0].message.reasoning_content, 'vou somar')
    assert.equal(res.choices[0].finish_reason, 'stop')
    assert.deepEqual(res.usage, { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 })
    assert.deepEqual(tokens, ['quatro'], 'resposta streama ao vivo')
    assert.deepEqual(events, [{ type: 'reasoning', text: 'vou somar' }])
  } finally {
    stub.restore()
    __setOllamaSnapshot(BASE, null)
  }
})

test('runOllamaTurn converte tool_calls nativas pro formato OpenAI-like', async () => {
  __setOllamaSnapshot(BASE, { models: [toCatalogModel(TAGS.models[0])] })
  const stub = stubFetch(() => ndjsonResponse([
    { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'get_time', arguments: { city: 'Tokyo' } } }] } },
    { done: true, done_reason: 'stop', prompt_eval_count: 20, eval_count: 5 },
  ]))
  try {
    const res = await runOllamaTurn(slotFor('qwen2.5:3b'), {
      chainModel: 'qwen2.5:3b',
      messages: [{ role: 'user', content: 'hora em Tokyo?' }],
      tools: [{ name: 'get_time', description: 'hora', input_schema: { type: 'object', properties: {} } }],
    })
    const call = res.choices[0].message.tool_calls[0]
    assert.equal(stub.calls[0].body.think, undefined, 'tools preservam o orçamento de saída, sem thinking nativo')
    assert.equal(res.choices[0].finish_reason, 'tool_calls')
    assert.equal(call.type, 'function')
    assert.equal(call.function.name, 'get_time')
    assert.equal(call.function.arguments, '{"city":"Tokyo"}')
    assert.ok(call.id)
  } finally {
    stub.restore()
    __setOllamaSnapshot(BASE, null)
  }
})

test('modelo sem tools nativas não recebe contrato de ferramentas não verificado', async () => {
  __setOllamaSnapshot(BASE, { models: [toCatalogModel(TAGS.models[1])] })
  const stub = stubFetch(() => ndjsonResponse([
    { message: { role: 'assistant', content: 'não tenho ferramentas neste modelo' } },
    { done: true, done_reason: 'stop', prompt_eval_count: 30, eval_count: 12 },
  ]))
  try {
    const tokens = []
    const res = await runOllamaTurn(slotFor('phi3:latest'), {
      chainModel: 'phi3:latest',
      messages: [{ role: 'user', content: 'hora em Tokyo?' }],
      tools: [{ name: 'get_time', description: 'hora', input_schema: { type: 'object', properties: {} } }],
      onToken: t => tokens.push(t),
    })

    assert.equal(stub.calls[0].body.tools, undefined)
    assert.doesNotMatch(stub.calls[0].body.messages[0].content, /```tool_call/)
    assert.equal(res.choices[0].message.content, 'não tenho ferramentas neste modelo')
    assert.deepEqual(tokens, ['não tenho ferramentas neste modelo'])
  } finally {
    stub.restore()
    __setOllamaSnapshot(BASE, null)
  }
})

test('texto normal de modelo sem tools nativas é emitido sem sumir', async () => {
  __setOllamaSnapshot(BASE, { models: [toCatalogModel(TAGS.models[1])] })
  const stub = stubFetch(() => ndjsonResponse([
    { message: { role: 'assistant', content: 'são 9h' } },
    { done: true, done_reason: 'stop' },
  ]))
  try {
    const tokens = []
    const res = await runOllamaTurn(slotFor('phi3:latest'), {
      chainModel: 'phi3:latest',
      messages: [{ role: 'user', content: 'oi' }],
      tools: [{ name: 'get_time', description: 'hora', input_schema: { type: 'object', properties: {} } }],
      onToken: t => tokens.push(t),
    })
    assert.equal(res.choices[0].message.content, 'são 9h')
    assert.deepEqual(tokens, ['são 9h'])
  } finally {
    stub.restore()
    __setOllamaSnapshot(BASE, null)
  }
})

test('daemon recusando tools refaz o turno pelo protocolo de texto', async () => {
  
  
  __setOllamaSnapshot(BASE, { models: [toCatalogModel({ ...TAGS.models[1], capabilities: ['completion', 'tools'] })] })
  const stub = stubFetch((url, body, n) => {
    if (url.endsWith('/api/tags')) return jsonResponse(TAGS)
    if (n === 1) return jsonResponse({ error: 'registry.ollama.ai/library/phi3:latest does not support tools' }, 400)
    return ndjsonResponse([{ message: { content: 'pronto' } }, { done: true }])
  })
  try {
    const res = await runOllamaTurn(slotFor('phi3:latest'), {
      chainModel: 'phi3:latest',
      messages: [{ role: 'user', content: 'oi' }],
      tools: [{ name: 'get_time', description: 'hora', input_schema: { type: 'object', properties: {} } }],
    })
    assert.equal(res.choices[0].message.content, 'pronto')
    const chatCalls = stub.calls.filter(c => c.url.endsWith('/api/chat'))
    assert.equal(chatCalls.length, 2)
    assert.ok(chatCalls[0].body.tools, 'primeira tentativa é nativa')
    assert.equal(chatCalls[1].body.tools, undefined, 'segunda vai por texto')
    assert.match(chatCalls[1].body.messages[0].content, /```tool_call/)
  } finally {
    stub.restore()
    __setOllamaSnapshot(BASE, null)
  }
})

test('OOM do llama-server refaz o turno com a janela padrão do daemon', async () => {
  __setOllamaSnapshot(BASE, { models: [toCatalogModel(TAGS.models[0])] })
  const stub = stubFetch((url, body, n) => n === 1
    ? jsonResponse({ error: 'llama-server process has terminated: signal: killed' }, 500)
    : ndjsonResponse([{ message: { content: 'ok' } }, { done: true }]))
  try {
    const res = await runOllamaTurn(slotFor('qwen2.5:3b'), {
      chainModel: 'qwen2.5:3b',
      
      messages: [{ role: 'user', content: 'x'.repeat(30_000) }],
    })
    assert.equal(res.choices[0].message.content, 'ok')
    assert.ok(stub.calls[0].body.options.num_ctx > 4096)
    assert.equal(stub.calls[1].body.options?.num_ctx, undefined)
  } finally {
    stub.restore()
    __setOllamaSnapshot(BASE, null)
  }
})

test('subestimação do tokenizer refaz uma vez com o contexto exato do daemon', async () => {
  __setOllamaSnapshot(BASE, { models: [toCatalogModel(TAGS.models[0])] })
  const stub = stubFetch((url, body, n) => n === 1
    ? jsonResponse({ error: { message: 'request (23657 tokens) exceeds the available context size (6144 tokens), try increasing it' } }, 400)
    : ndjsonResponse([{ message: { content: 'ok' } }, { done: true }]))
  try {
    const res = await runOllamaTurn(slotFor('qwen2.5:3b'), {
      chainModel: 'qwen2.5:3b', messages: [{ role: 'user', content: 'oi' }],
    })
    assert.equal(res.choices[0].message.content, 'ok')
    assert.equal(stub.calls[1].body.options.num_ctx, 26_624)
  } finally {
    stub.restore()
    __setOllamaSnapshot(BASE, null)
  }
})

test('erro do daemon vira Error com a mensagem do ollama (sem retry infinito)', async () => {
  __setOllamaSnapshot(BASE, { models: [toCatalogModel(TAGS.models[0])] })
  const stub = stubFetch(() => jsonResponse({ error: 'model requires more system memory' }, 500))
  try {
    await assert.rejects(
      runOllamaTurn(slotFor('qwen2.5:3b'), { chainModel: 'qwen2.5:3b', messages: [{ role: 'user', content: 'oi' }] }),
      /more system memory/,
    )
    assert.equal(stub.calls.length, 1, 'sem num_ctx pedido, não há o que refazer')
  } finally {
    stub.restore()
    __setOllamaSnapshot(BASE, null)
  }
})

test('timeout do turno interrompe o stream local e explica a falha', async () => {
  __setOllamaSnapshot(BASE, { models: [toCatalogModel(TAGS.models[0])] })
  const stub = stubFetch((url, body, n) => new Promise((resolve, reject) => {
    
    
    setTimeout(() => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), 30)
  }))
  try {
    await assert.rejects(
      runOllamaTurn(slotFor('qwen2.5:3b'), {
        chainModel: 'qwen2.5:3b', messages: [{ role: 'user', content: 'oi' }], timeoutMs: 5,
      }),
      /excedeu o limite de 5 ms/,
    )
    assert.equal(stub.calls.length, 1)
  } finally {
    stub.restore()
    __setOllamaSnapshot(BASE, null)
  }
})

test('getOllamaSnapshot é síncrono e dispara o refresh em background', async () => {
  const stub = stubFetch(() => jsonResponse(TAGS))
  try {
    const cold = getOllamaSnapshot(BASE)
    assert.deepEqual(cold.models, [], 'cache frio não bloqueia quem chama')
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(getOllamaSnapshot(BASE).models.length, TAGS.models.length, 'refresh em background aqueceu o cache')
  } finally {
    stub.restore()
    __setOllamaSnapshot(BASE, null)
  }
})
