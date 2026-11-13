import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const inputBar = readFileSync(join(import.meta.dirname, '..', 'views', 'InputBar2.svelte'), 'utf8')
const agentIndex = readFileSync(join(import.meta.dirname, '..', 'index.js'), 'utf8')

test('InputBar carrega estado e catálogo pela rota de sessão já existente', () => {
  assert.match(inputBar, /fetch\(`\/agent\/session\/model\?session_id=/)
  assert.doesNotMatch(inputBar, /fetch\(`\/agent\/models`\)/)
  assert.doesNotMatch(inputBar, /fetch\(`\/classification\/models`\)/)
  
  
  
  assert.match(agentIndex, /sessionModelGet[\s\S]*catalog:\s*await getFreshModelCatalog\(\)/)
  assert.match(inputBar, /function unwrapRouteData\(payload\)/)
  assert.match(inputBar, /unwrapRouteData\(await response\.json\(\)\)/)
})

test('abrir a seção de modelo na InputBar recarrega o catálogo', () => {
  
  
  assert.match(inputBar, /entry\.native === "model" && sessionId\) fetchModel\(sessionId\)/)
})
