import { describe, expect, test } from 'vitest'
import {
  DEFAULT_AGENT_ID,
  getAgentCatalog,
  readSessionAgent,
  writeSessionAgent,
} from '../views/agents/catalog.js'
import * as runtime from '../views/agents/runtime.js'

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
}

describe('catálogo neutro de agentes', () => {
  test('Agent é o agente padrão para sessões novas', () => {
    expect(DEFAULT_AGENT_ID).toBe('agent')
    expect(readSessionAgent(null, 'new-session')).toBe('agent')
  })

  test('Agent e Scriba possuem adapters funcionais; Codex é provider do Agent', () => {
    const agents = getAgentCatalog()
    expect(agents.find((agent) => agent.id === 'agent')).toMatchObject({ available: true })
    expect(agents.find((agent) => agent.id === 'scriba')).toMatchObject({ available: true })
    expect(agents.find((agent) => agent.id === 'codex')).toBeUndefined()
  })

  test('o chat ignora seleção legada e handoff de outro agente', () => {
    const storage = memoryStorage()
    expect(readSessionAgent(storage, 'orbit-1')).toBe(DEFAULT_AGENT_ID)
    storage.setItem('thinkiac:shell:agent:orbit-1', 'scriba')
    expect(readSessionAgent(storage, 'orbit-1')).toBe('agent')
    expect(writeSessionAgent(storage, 'orbit-1', 'scriba')).toBe('agent')
    expect(readSessionAgent(storage, 'orbit-1')).toBe('agent')
    expect(writeSessionAgent(storage, 'orbit-1', 'aurora')).toBe('agent')
    expect(readSessionAgent(storage, 'orbit-1')).toBe('agent')
    expect(writeSessionAgent(storage, 'orbit-1', 'codex')).toBe(DEFAULT_AGENT_ID)
  })

  test('o runtime expõe todas as operações do agente sem vazar rotas na UI', () => {
    expect(runtime.currentAgentId()).toBe(DEFAULT_AGENT_ID)
    expect(runtime.capabilities()).toContain('sessions')
    expect(typeof runtime.request).toBe('function')
    expect(typeof runtime.requestForAgent).toBe('function')
    expect(typeof runtime.connectAll).toBe('function')
    expect(typeof runtime.subscribeAll).toBe('function')
    expect(typeof runtime.resourceUrl).toBe('function')
  })
})
