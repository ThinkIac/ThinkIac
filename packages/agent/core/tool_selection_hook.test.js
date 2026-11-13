import test from 'node:test'
import assert from 'node:assert/strict'
import { applyToolSelectionHook } from './tool_selection_hook.js'

const tools = [{ name: 'required' }, { name: 'alpha' }, { name: 'beta' }]

test('seleção vazia não reabre todo o catálogo', async () => {
  const selected = await applyToolSelectionHook(async () => ({ selectedToolNames: [] }), {
    tools, availableTools: tools, requiredTools: ['required'],
  })
  assert.deepEqual(selected.map(tool => tool.name), ['required'])
})

test('falha do hook preserva seleção anterior', async () => {
  const selected = await applyToolSelectionHook(async () => { throw new Error('offline') }, {
    tools: tools.slice(0, 2), availableTools: tools,
  })
  assert.deepEqual(selected.map(tool => tool.name), ['required', 'alpha'])
})

test('hook de capability pode retirar schema indisponível antes do modelo', async () => {
  const selected = await applyToolSelectionHook(async () => ({
    selectedToolNames: ['required', 'alpha', 'beta'], eligibleToolNames: ['required', 'alpha'],
  }), { tools, availableTools: tools, requiredTools: ['required'] })
  assert.deepEqual(selected.map(tool => tool.name), ['required', 'alpha'])
})

test('hook reativo pode recuperar tool permitida, mas ausente da classificação inicial', async () => {
  const selected = await applyToolSelectionHook(async () => ({ selectedToolNames: ['beta'] }), {
    tools: tools.slice(0, 2), availableTools: tools, requiredTools: ['required'],
  })
  assert.deepEqual(selected.map(tool => tool.name), ['required', 'beta'])
})
