import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../views/Index.public.svelte', import.meta.url), 'utf8')

test('contas Codex mostram créditos e confirmam antes de consumir um reset', () => {
  assert.match(source, /function resetCredits\(usage\)/)
  assert.match(source, /RESET CREDITS/)
  assert.match(source, /Use 1 reset credit/)
  assert.match(source, /codex-usage\/\$\{encodeURIComponent\(profileName\(account\.name\)\)\}\/reset/)
  assert.match(source, /Reset usage/)
})

test('Codex oferece o modo avançado nativo sem mudar o padrão governado pelo Runtime', () => {
  assert.match(source, /Runtime controlled/)
  assert.match(source, /Codex native/)
  assert.match(source, /execution-mode/)
})
