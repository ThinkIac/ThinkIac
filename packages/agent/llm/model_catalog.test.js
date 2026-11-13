import test from 'node:test'
import assert from 'node:assert/strict'
import { attachEvidence, buildModelCatalog, resolveModel } from './model_catalog.js'
import { buildSlots } from './llm_keys.js'

const config = {
  llm: {
    pools: [
      {
        name: 'fast-api',
        provider: 'openrouter',
        model: 'vendor/fast',
        enabled: true,
        capabilities: {
          tools: { supported: true, parallel: true },
          structuredOutput: true,
          contextWindow: 128000,
        },
        economics: { costScore: 0.9 },
        operational: { latencyMs: 300 },
      },
      {
        name: 'vision-cli',
        provider: 'codex-cli',
        model: 'vendor/vision',
        enabled: true,
        authenticated: true,
        capabilities: {
          modalities: { vision: { input: true } },
          tools: { supported: true },
          reasoning: { supported: true, levels: ['high'] },
          contextWindow: 200000,
        },
        economics: { costScore: 0.5 },
        operational: { latencyMs: 1500 },
      },
    ],
  },
}

test('catálogo identifica modelo + acesso e normaliza capacidades conservadoramente', () => {
  const catalog = buildModelCatalog(config)
  assert.deepEqual(catalog.accesses.map(item => item.id), ['vendor/fast@fast-api', 'vendor/vision@vision-cli'])
  assert.equal(catalog.accesses[0].capabilities.modalities.vision.input, false)
  assert.equal(catalog.accesses[1].mode, 'cli')
})

test('requisitos eliminam candidatos incompatíveis e explicam a rejeição', () => {
  const result = resolveModel(buildModelCatalog(config), {
    requires: { modalities: ['vision:input'], tools: true, minContextWindow: 100000 },
  })
  assert.equal(result.ok, true)
  assert.equal(result.selected.id, 'vendor/vision@vision-cli')
  assert.deepEqual(result.rejected[0].reasons, ['missing:modalities.vision.input'])
})

test('override incompatível falha em vez de degradar silenciosamente', () => {
  const result = resolveModel(buildModelCatalog(config), {
    requires: { modalities: ['vision:input'] },
    override: 'vendor/fast@fast-api',
  })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'override_incompatible')
})

test('evidência benchmarkada ranqueia qualidade sem conceder capacidade', () => {
  const catalog = attachEvidence(buildModelCatalog(config), [
    { target: 'vendor/fast@fast-api', capability: 'tools.supported', score: 0.98, confidence: 0.9, source: 'benchmarked' },
    { target: 'vendor/vision@vision-cli', capability: 'tools.supported', score: 0.6, confidence: 0.9, source: 'benchmarked' },
  ])
  const tools = resolveModel(catalog, { requires: { tools: true }, policy: { quality: 1, cost: 0, latency: 0 } })
  assert.equal(tools.selected.id, 'vendor/fast@fast-api')
  const vision = resolveModel(catalog, { requires: { modalities: ['vision:input'] }, override: 'vendor/fast@fast-api' })
  assert.equal(vision.code, 'override_incompatible')
})

test('slot preserva pool.id e herda as capacidades do pool identificado por id', () => {
  const configWithId = {
    llm: { pools: [{
      id: 'openrouter-primary',
      name: 'OpenRouter principal',
      provider: 'openrouter',
      model: 'vendor/tool-model',
      enabled: true,
      api_keys: ['secret'],
      capabilities: { tools: { supported: true } },
    }] },
  }
  const slots = buildSlots(configWithId)
  assert.equal(slots[0].poolName, 'openrouter-primary')
  assert.equal(slots[0].id, 'openrouter-primary[0]')

  const result = resolveModel(buildModelCatalog(configWithId, { slots }), { requires: { tools: true } })
  assert.equal(result.ok, true)
  assert.equal(result.selected.accessId, 'openrouter-primary')
})

test('catálogo preserva limites operacionais por acesso para o roteador', () => {
  const limited = {
    llm: { pools: [{
      name: 'free-groq', provider: 'groq', model: 'llama-fast', enabled: true, api_keys: ['secret'],
      models: [{ id: 'llama-fast', limits: { rpm: 30, tpm: 6000 } }],
    }] },
  }
  const catalog = buildModelCatalog(limited, { slots: buildSlots(limited) })
  assert.deepEqual(catalog.accesses[0].metadata.limits, { rpm: 30, tpm: 6000 })
})

test('modelo OpenRouter sem declaração de tools continua incompatível', () => {
  const withoutTools = {
    llm: { pools: [{ id: 'openrouter-primary', provider: 'openrouter', model: 'vendor/plain', enabled: true }] },
  }
  const result = resolveModel(buildModelCatalog(withoutTools), { requires: { tools: true } })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'no_compatible_model')
  assert.deepEqual(result.rejected[0].reasons, ['missing:tools.supported'])
})

test('tools emuladas do runtime local satisfazem o contrato do Agent sem fingir suporte nativo', () => {
  const catalog = buildModelCatalog({ llm: { pools: [{
    id: 'thinkiac-edge-local', provider: 'thinkiac-edge', model: 'local:qwen', enabled: true,
    models: [{ id: 'local:qwen', name: 'Qwen Local', capabilities: {
      tools: { supported: true, native: false, emulated: true },
    } }],
  }] } })
  const access = catalog.accesses[0]
  assert.equal(access.capabilities.tools.supported, true)
  assert.equal(access.capabilities.tools.native, false)
  assert.equal(access.capabilities.tools.emulated, true)
  const result = resolveModel(catalog, { requires: { tools: true }, override: access.id })
  assert.equal(result.ok, true)
})

test('um provider pode expor vários modelos, cada um com propósito e capacidades próprias', () => {
  const multiModel = {
    llm: { pools: [{
      id: 'shared-access', provider: 'openrouter', model: 'vendor/legacy', enabled: true,
      api_keys: ['secret'],
      capabilities: { tools: { supported: true } },
      models: [
        { id: 'vendor/fast', name: 'Fast', purpose: { name: 'general', description: 'Respostas rápidas.' } },
        { id: 'vendor/engineer', name: 'Engineer', purpose: { name: 'engineering', description: 'Código e análise técnica.' }, capabilities: { reasoning: { supported: true } } },
      ],
    }] },
  }
  const catalog = buildModelCatalog(multiModel, { slots: buildSlots(multiModel) })
  assert.deepEqual(catalog.accesses.map(item => item.id), [
    'vendor/fast@shared-access', 'vendor/engineer@shared-access',
  ])
  assert.equal(catalog.accesses[1].name, 'Engineer')
  assert.equal(catalog.accesses[1].purpose.name, 'engineering')
  assert.equal(catalog.accesses[1].capabilities.tools.supported, false)
  assert.equal(catalog.accesses[1].capabilities.reasoning.supported, true)
})

test('capacidades do pool não vazam para outro modelo do mesmo acesso', () => {
  const multiModel = {
    llm: { pools: [{
      id: 'openrouter', provider: 'openrouter', model: 'vendor/deepseek', enabled: true,
      capabilities_model: 'vendor/deepseek',
      capabilities: { tools: { supported: true } },
      models: [
        { id: 'vendor/dolphin', purpose: { name: 'general', description: 'Sem suporte a tools.' } },
        { id: 'vendor/deepseek', purpose: { name: 'engineering', description: 'Agente com tools.' } },
      ],
    }] },
  }
  const result = resolveModel(buildModelCatalog(multiModel), { requires: { tools: true } })
  assert.equal(result.selected.id, 'vendor/deepseek@openrouter')
  assert.deepEqual(result.rejected[0].reasons, ['missing:tools.supported'])
})

test('num pool cli as capacidades são do harness e valem para todos os modelos', () => {
  
  
  
  
  const cliPool = {
    llm: { pools: [{
      name: 'claude-engineer', provider: 'claude-cli', model: 'opus', enabled: true,
      capabilities: { tools: { supported: true } },
      models: [{ id: 'opus' }, { id: 'sonnet' }],
    }] },
  }
  const catalog = buildModelCatalog(cliPool)
  assert.equal(catalog.accesses[1].id, 'sonnet@claude-engineer')
  assert.equal(catalog.accesses[1].capabilities.tools.supported, true)

  const result = resolveModel(catalog, { requires: { tools: true }, override: 'sonnet@claude-engineer' })
  assert.equal(result.ok, true)
  assert.equal(result.selected.id, 'sonnet@claude-engineer')
})

test('empate no Auto favorece o modelo padrão do pool antes da ordem alfabética', () => {
  const catalog = buildModelCatalog({ llm: { pools: [{
    id: 'openrouter', provider: 'openrouter', model: 'vendor/deepseek', enabled: true,
    models: ['vendor/dolphin', 'vendor/deepseek'],
  }] } })
  const result = resolveModel(catalog)
  assert.equal(result.selected.id, 'vendor/deepseek@openrouter')
})

test('preferência de propósito prioriza o modelo correspondente sem ignorar requisitos', () => {
  const catalog = buildModelCatalog({ llm: { pools: [{
    id: 'shared-access', provider: 'openrouter', enabled: true,
    models: [
      { id: 'vendor/general', purpose: { name: 'general', description: 'Conversas gerais.' } },
      { id: 'vendor/code', purpose: { name: 'engineering', description: 'Código.' } },
    ],
  }] } })
  const result = resolveModel(catalog, { prefers: { purpose: 'engineering' } })
  assert.equal(result.selected.id, 'vendor/code@shared-access')
})

test('descrição do propósito serve como sinal para o Auto quando recebe a intenção do turno', () => {
  const catalog = buildModelCatalog({ llm: { pools: [{
    id: 'shared-access', provider: 'openrouter', enabled: true,
    models: [
      { id: 'vendor/chat', purpose: { name: 'general', description: 'Conversas rápidas e textos cotidianos.' } },
      { id: 'vendor/code', purpose: { name: 'engineering', description: 'Implementação, revisão e testes de código.' } },
    ],
  }] } })
  const result = resolveModel(catalog, { prefers: { intent: 'Faça uma revisão de código e escreva testes.' } })
  assert.equal(result.selected.id, 'vendor/code@shared-access')
})
