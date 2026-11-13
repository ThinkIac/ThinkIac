import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

test('MCP contributes a native System schema tab, never a standalone view', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const source = await readFile(new URL('../index.js', import.meta.url), 'utf8')

  assert.deepEqual(manifest.manifest.systemTab, {
    id: 'mcp', label: 'MCP', view: 'Index', renderer: 'schema', surface: 'providers', order: 75,
  })
  assert.equal(manifest.manifest.page, undefined)
  assert.equal(manifest.manifest.menu, undefined)
  assert.match(source, /kind: 'mcp-providers'/)
  assert.doesNotMatch(source, /exportMcp|mcp:export|keys\//)
})

test('the MCP system surface retains only native provider management actions', async () => {
  const source = await readFile(new URL('../index.js', import.meta.url), 'utf8')
  assert.match(source, /'mcp\.save-provider'/)
  assert.match(source, /'mcp\.refresh-provider'/)
  assert.match(source, /'mcp\.remove-provider'/)
  assert.doesNotMatch(source, /issueMcpKey|revokeMcpKey/)
})
