import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const logosRoot = path.dirname(require.resolve('logos/package.json'))
const engineUrl = pathToFileURL(path.join(logosRoot, '../modules/svelte/index.cjs')).href
const auroraRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const packagesRoot = path.dirname(auroraRoot)
const workspaceRoot = path.dirname(packagesRoot)

test('ações de mensagem compilam e renderizam sem globais do navegador', async () => {
  const cacheDir = mkdtempSync(path.join(tmpdir(), 'message-actions-ssr-'))
  const originalCwd = process.cwd()
  try {
    process.chdir(workspaceRoot)
    const engineModule = await import(engineUrl)
    const { SvelteEngine } = engineModule.default ?? engineModule
    const engine = new SvelteEngine(cacheDir)
    const html = await engine.render(
      path.join(auroraRoot, 'views/components/MessageActions.svelte'),
      'aurora__MessageActions_ssr_test',
      { message: { role: 'assistant', content: 'Resposta' }, index: 0, assistantOrdinal: 0 },
      packagesRoot,
    )
    assert.match(html, /aria-label="Copy response"/)
  } finally {
    process.chdir(originalCwd)
    rmSync(cacheDir, { recursive: true, force: true })
  }
})
