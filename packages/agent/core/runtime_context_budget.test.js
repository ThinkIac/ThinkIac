import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { buildRuntimeCatalogGuide } from './runtime_bridge.js'
import {
  DEFAULT_TOOL_RESULT_MAX_CHARS,
  serializeToolResult,
} from '../llm/tool_results.js'

const projectRoot = resolve(import.meta.dirname, '../../..')

test('runtime prompt uses a compact discovery guide without enumerating routes or packages', () => {
  const guide = buildRuntimeCatalogGuide()

  assert.match(guide, /list_runtime_tools/)
  assert.match(guide, /run_runtime_tool/)
  assert.match(guide, /list_runtime_routes/)
  assert.doesNotMatch(guide, /### package:/)
  assert.doesNotMatch(guide, /\broute:\s*\[/)
  assert.ok(guide.length <= 700, `guide too large: ${guide.length} chars`)
})

test('tool results under the limit preserve their exact serialized content', () => {
  const value = { ok: true, rows: [1, 2, 3] }
  assert.equal(serializeToolResult(value), JSON.stringify(value, null, 2))
  assert.equal(serializeToolResult('plain text'), 'plain text')
})

test('large tool results are bounded and retain truncation metadata', () => {
  const original = 'x'.repeat(DEFAULT_TOOL_RESULT_MAX_CHARS * 3)
  const serialized = serializeToolResult(original)

  assert.ok(serialized.length <= DEFAULT_TOOL_RESULT_MAX_CHARS + 300)
  assert.match(serialized, /\[tool result truncated\]/)
  assert.match(serialized, new RegExp(`original_chars=${original.length}`))
  assert.match(serialized, new RegExp(`kept_chars=${DEFAULT_TOOL_RESULT_MAX_CHARS}`))
})

test('non-serializable tool results fail safely without breaking message construction', () => {
  const circular = {}
  circular.self = circular

  assert.match(serializeToolResult(circular), /resultado não serializável/)
})

test('persisted approximation defaults to compact and never persists full session overrides', () => {
  const config = JSON.parse(readFileSync(
    resolve(projectRoot, 'packages/classification/approximation-config.json'),
    'utf8',
  ))

  assert.equal(config.global, 'compact')
  assert.ok(config.sessions && typeof config.sessions === 'object')
  assert.equal(Object.values(config.sessions).includes('full'), false)
  assert.deepEqual(config.oneShotFull ?? {}, {})
})
