import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('entrada legada de Agent redireciona ao Shell preservando query', () => {
  const source = readFileSync(new URL('../views/Index.svelte', import.meta.url), 'utf8')
  assert.match(source, /window\.location\.search/)
  assert.match(source, /window\.location\.replace\(`\$\{destination\}\$\{query\}`\)/)
  assert.match(source, /\/view\/shell\/Index/)
})
