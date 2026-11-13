import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const logosRoot = path.dirname(require.resolve('logos/package.json'))
const engineUrl = pathToFileURL(path.join(logosRoot, 'dist/src/modules/views/engine.js')).href

test('MCP view renders in SSR without browser globals', async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'agent-mcp-view-'))
  try {
    const engineModule = await import(engineUrl)
    const { SvelteEngine } = engineModule.default ?? engineModule
    const html = await new SvelteEngine(cacheDir).render(
      path.resolve('packages/agent/views/Mcp.svelte'), 'agent__Mcp_ssr', {}, path.resolve('packages'),
    )
    assert.match(html, /Providers MCP/)
    assert.match(html, /Salvar provider/)
  } finally {
    await rm(cacheDir, { recursive: true, force: true })
  }
})
