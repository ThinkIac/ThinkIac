import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const source = await readFile(
  new URL('../views/Sessions.svelte', import.meta.url),
  'utf8',
)

test('session header keeps only compact actions, without a Sessions title', () => {
  assert.match(source, /class="sessions-header"/)
  assert.match(source, /class="sessions-actions"/)
  assert.match(source, /class="sessions-new-topic icon-action"/)
  assert.doesNotMatch(source, /class="sessions-heading"/)
  assert.match(source, /\.sessions-widget\s*\{[\s\S]*?font-family:\s*var\(--tk-font\)/)
  assert.match(source, /\.title-settings\s*\{[\s\S]*?background:\s*transparent/)
  const settingsBlock = source.match(/\.title-settings\s*\{([^}]*)\}/)?.[1] ?? ''
  assert.ok(settingsBlock)
  assert.doesNotMatch(settingsBlock, /border:\s*1px/)
})

test('sessions paginate four items at a time with accessible controls and swipe handlers', () => {
  assert.match(source, /const PAGE_SIZE = 4;/)
  assert.match(source, /displayedSessions\.slice\(pageStart, pageStart \+ PAGE_SIZE\)/)
  assert.match(source, /Math\.ceil\(displayedSessions\.length \/ PAGE_SIZE\)/)
  assert.match(source, /function goToPage\(nextPage\)/)
  assert.match(source, /on:touchstart=\{handleTouchStart\}/)
  assert.match(source, /on:touchend=\{handleTouchEnd\}/)
  assert.match(source, /aria-label="Previous sessions page"/)
  assert.match(source, /aria-label="Next sessions page"/)
  assert.match(source, /\{currentPage \+ 1\} \/ \{pageCount\}/)
  assert.doesNotMatch(source, /Show \$\{hiddenCount\} more/)
})

test('session search opens from a magnifier and uses the full-history search route', () => {
  assert.match(source, /aria-label="Search conversations"/)
  assert.match(source, /class="session-search"/)
  assert.match(source, /placeholder="search conversations"/)
  assert.match(source, /\/sessions\/search\?q=\$\{encodeURIComponent\(query\)\}/)
  assert.match(source, /searchResults/)
  assert.match(source, /class="search-match"/)
})

test('date group labels use a subdued dedicated treatment', () => {
  assert.match(source, /class="session-group-label"/)
  assert.match(source, /\.session-group-label\s*\{[\s\S]*?opacity:\s*\.58/)
})

test('automatic-title settings and date groups are presented in English', () => {
  for (const copy of [
    'Automatic titles',
    'Summary model',
    'Update every N messages',
    'Restore default',
    'Loading settings',
    'Today',
    'Yesterday',
    'Previous 7 days',
    'Earlier',
  ]) {
    assert.match(source, new RegExp(copy))
  }

  assert.doesNotMatch(
    source,
    /Carregando|T[ií]tulo autom[aá]tico|Modelo que resume|mensagens|Padr[aã]o|Definido neste tenant|restaurar padr[aã]o|Hoje|Ontem|Últimos 7 dias|Anteriores/,
  )
})
