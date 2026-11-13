import { afterEach, describe, expect, it, vi } from 'vitest'
import { __setThinkIacEdgeSnapshot, applyThinkIacEdgeDiscovery, refreshThinkIacEdgeDiscovery } from './thinkiac_edge.js'

const base = 'http://127.0.0.1:5040'
const config = { llm: { pools: [{ id: 'edge', provider: 'thinkiac-edge', base_url: base, model: 'local', enabled: true, models: [] }] } }

afterEach(() => {
  vi.unstubAllGlobals()
  __setThinkIacEdgeSnapshot(base, null)
})

describe('ThinkIac Edge discovery', () => {
  it('keeps an offline app unavailable and out of the model list', () => {
    const result = applyThinkIacEdgeDiscovery(config)
    expect(result.llm.pools[0]).toMatchObject({ available: false, models: [] })
  })

  it('maps only models exposed by the installed-resource bridge', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ id: 'local:qwen', name: 'Qwen', recommended: true, capabilities: { text: true, tools: true, streaming: true } }] }),
    })))
    const result = await refreshThinkIacEdgeDiscovery(config)
    expect(result.llm.pools[0].available).toBe(true)
    expect(result.llm.pools[0].model).toBe('local:qwen')
    expect(result.llm.pools[0].models[0].capabilities.tools).toMatchObject({ supported: true, native: true })
  })

  it('mantém o modelo sem tools nativas compatível via emulação local', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ id: 'local:qwen', name: 'Qwen 2.5 0.5B', capabilities: { text: true, tools: true, nativeTools: false, streaming: true } }] }),
    })))
    const result = await refreshThinkIacEdgeDiscovery(config)
    expect(result.llm.pools[0].models[0]).toMatchObject({
      purpose: { name: 'Android Local' },
      capabilities: { tools: { supported: true, native: false, emulated: true } },
    })
  })
})
