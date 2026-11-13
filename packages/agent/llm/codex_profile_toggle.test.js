import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSlots } from './llm_keys.js'

test('perfil Codex pausado não vira slot de inferência', () => {
  const slots = buildSlots({
    llm: {
      pools: [{
        name: 'codex-toggle-test',
        provider: 'codex-cli',
        enabled: true,
        cli: {
          accounts: [
            { name: 'active-test-profile', config_dir: '/tmp/codex-active-test' },
            { name: 'paused-test-profile', config_dir: '/tmp/codex-paused-test' },
          ],
          disabled_accounts: ['paused-test-profile'],
        },
      }],
    },
  })

  assert.ok(slots.some(slot => slot.cli.account === 'active-test-profile'))
  assert.ok(!slots.some(slot => slot.cli.account === 'paused-test-profile'))
})
