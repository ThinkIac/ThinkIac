import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'

const require = createRequire(import.meta.url)
const logosRoot = path.dirname(require.resolve('logos/package.json'))
const engineUrl = pathToFileURL(path.join(logosRoot, 'dist/src/modules/views/engine.js')).href
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packagesRoot = path.dirname(packageRoot)

test('DesktopChat reuses the current Shell InputBar and renders without browser globals', async () => {
  const source = await readFile(path.join(packageRoot, '../shell/views/widgets/DesktopChat.svelte'), 'utf8')
  assert.doesNotMatch(source, /<Home/)
  assert.match(source, /thinkiac:desktop-chat:send/)
  assert.match(source, /thinkiac:desktop-chat:stop/)
  assert.match(source, /import InputBar from '\.\.\/InputBar\.svelte'/)
  assert.doesNotMatch(source, /agent\/views/)
  assert.match(source, /DEFAULT_AGENT_ID/)
  assert.match(source, /activeAgentId/)
  assert.doesNotMatch(source, /selectAgent/)
  assert.match(source, /requestForAgent/)
  assert.match(source, /sessions\/list/)
  assert.match(source, /desktop-chat:open-session/)
  assert.match(source, /on:stop=\{stop\}/)
  
  
  assert.match(source, /session-card/)
  assert.match(source, /session-group-label/)
  assert.match(source, /max-width:768px/)

  const cacheDir = await mkdtemp(path.join(tmpdir(), 'agent-desktop-chat-'))
  try {
    const engineModule = await import(engineUrl)
    const { SvelteEngine } = engineModule.default ?? engineModule
    const engine = new SvelteEngine(cacheDir)
    engine.buildWidgetRegistry(packagesRoot)
    await assert.doesNotReject(() => engine.render(
      path.join(packageRoot, '../shell/views/widgets/DesktopChat.svelte'),
      'shell__DesktopChat_ssr',
      { desktop: { theme: 'dark', mode: 'desktop', active: true } },
      packagesRoot,
    ))
  } finally {
    await rm(cacheDir, { recursive: true, force: true })
  }
})
