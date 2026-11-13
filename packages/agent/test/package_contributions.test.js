import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8')
const json = (path) => JSON.parse(read(path))
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url))
const AGENT_DIR = path.resolve(TEST_DIR, '..')
const PACKAGES_DIR = path.resolve(AGENT_DIR, '..')

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (['data', 'sessions', 'snapshots', 'uploads', 'test'].includes(entry.name)) return []
      return sourceFiles(absolute)
    }
    return /\.(?:js|svelte)$/.test(entry.name) && !entry.name.endsWith('.test.js') ? [absolute] : []
  })
}

test('active packages declare their Agent contributions', () => {
  assert.equal(json('../../artifacts/package.json').manifest.widget.lang, 'artifact')
  assert.equal(json('../../terminal/package.json').manifest.widget.lang, 'bash')
  const usageManifest = path.resolve(PACKAGES_DIR, 'usage/package.json')
  if (fs.existsSync(usageManifest)) {
    assert.equal(JSON.parse(fs.readFileSync(usageManifest, 'utf8')).manifest.background.view, 'Tracker')
  }
})

test('Agent não hospeda mais o widget do Desktop', () => {
  assert.equal(json('../package.json').manifest.desktopWidget, undefined)
  assert.equal(fs.existsSync(path.join(AGENT_DIR, 'views/widgets/DesktopChat.svelte')), false)
})

test('Agent shell contains no package-specific execution or tracking routes', () => {
  const home = read('../views/Home.svelte')
  const messages = read('../views/MessageList.svelte')
  const input = read('../views/InputBar2.svelte')
  const renderers = read('../views/lib/renderers.js')
  assert.doesNotMatch(home, /startUsageTracker|\/usage\/|packageByType|\/artifacts\/artifacts/)
  assert.doesNotMatch(messages, /\/terminal\/inline-exec|bashNeedsConfirmation|artifactDirective/)
  assert.doesNotMatch(input, /\/artifacts\/artifacts/)
  assert.doesNotMatch(renderers, /widgets\/ArtifactWidget|ARTIFACT_BLOCK_REGEX/)
})

test('Agent shell does not compile optional package views into its core bundle', () => {
  const home = read('../views/Home.svelte')
  const input = read('../views/InputBar2.svelte')
  assert.doesNotMatch(home, /\.\.\/\.\.\/(?:global-search|ntfy)\/views\//)
  assert.doesNotMatch(input, /\.\.\/\.\.\/file-manager\/views\//)
})

test('integração nativa de ntfy é opcional e condicionada ao catálogo', () => {
  const boundary = json('../core-boundary.json')
  const home = read('../views/Home.svelte')
  const dependency = boundary.optionalPackages.find(item => item.name === 'ntfy')

  assert.ok(dependency)
  assert.match(dependency.integration, /apps\/list/)
  assert.match(home, /<NotifyOptIn \{appId\} \/>/)
  assert.doesNotMatch(home, /\{#if ntfyAvailable\}[\s\S]*<NotifyOptIn/)
})

test('Agent core does not call routes from absent optional packages', () => {
  const input = read('../views/InputBar2.svelte')
  assert.doesNotMatch(input, /\/cognites\//)
})

test('menu defaults contain no concrete package ids', () => {
  const menu = read('../views/lib/menu_bootstrap.js')
  assert.doesNotMatch(menu, /pkg:(?:usage|system-monitor|reboot)/)
  assert.match(menu, /\border\b/)
})

test('versioned core boundary accounts for every static cross-package import', () => {
  const boundary = json('../core-boundary.json')
  assert.equal(boundary.schemaVersion, 1)
  assert.deepEqual(boundary.requiredPackages.map(item => item.name).sort(), [
    'aura-system',
    'auth',
    'classification',
    'file-manager',
    'governance',
    'hermes',
    'mcp',
    'memory',
    'specialists',
    'ui-schema',
  ])

  const imported = new Set()
  const pattern = /(?:from\s+|import\s*\(|require\s*\()\s*['"`]([^'"`]+)['"`]/g
  for (const file of sourceFiles(AGENT_DIR)) {
    const source = fs.readFileSync(file, 'utf8')
    for (const match of source.matchAll(pattern)) {
      if (!match[1].startsWith('.')) continue
      const target = path.resolve(path.dirname(file), match[1])
      const relative = path.relative(PACKAGES_DIR, target)
      if (relative.startsWith('..')) continue
      const packageName = relative.split(path.sep)[0]
      if (packageName !== 'agent') imported.add(packageName)
    }
  }

  const requiredImports = boundary.requiredPackages
    .map(item => item.name)
    .filter(name => name !== 'aura-system')
  const optionalImports = new Set(boundary.optionalPackages.map(item => item.name))
  for (const name of optionalImports) imported.delete(name)
  assert.deepEqual([...imported].sort(), requiredImports.sort())
})

test('optional packages have an explicit degradation contract', () => {
  const boundary = json('../core-boundary.json')
  for (const dependency of boundary.optionalPackages) {
    assert.ok(dependency.capability)
    assert.ok(dependency.whenAbsent)
    assert.notEqual(dependency.whenAbsent, 'fail')
  }
})
