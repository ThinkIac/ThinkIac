import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const source = new URL('./composer_slot_bootstrap.js', import.meta.url)

test('composer slot discovery uses the same app manifest endpoint as other harness slots', async () => {
  const text = await readFile(source, 'utf8')
  assert.match(text, /api\('\/apps\/list', 'GET', null, 'aura-system'\)/)
  assert.match(text, /app\?\.composerSlot/)
})
