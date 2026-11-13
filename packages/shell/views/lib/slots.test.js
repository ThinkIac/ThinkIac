import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSlot } from './slots.js'

test('resolves named slots from apps/list and lets the last slot+id win', () => {
  const apps = [
    { slots: [{ slot: 'email-manager.account-connect', id: 'google', packageName: 'a', order: 20 }] },
    { slots: [{ slot: 'email-manager.account-connect', id: 'google', packageName: 'b', order: 10, url: '/view/b/Connect' }] },
  ]
  assert.deepEqual(resolveSlot(apps, 'email-manager.account-connect'), [{
    slot: 'email-manager.account-connect', id: 'google', packageName: 'b', order: 10,
    url: '/view/b/Connect', overrides: 'a',
  }])
})
