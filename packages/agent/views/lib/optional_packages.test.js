import assert from 'node:assert/strict'
import test from 'node:test'

import { availablePackageNames, hasPackage } from './optional_packages.js'

test('identifica pacotes disponíveis pelas contribuições do catálogo', () => {
  const apps = [
    { packageName: 'ntfy', name: 'Ntfy - Widget' },
    { packageName: 'terminal', name: 'Terminal' },
    { packageName: 'ntfy', name: 'Ntfy' },
  ]
  assert.deepEqual([...availablePackageNames(apps)], ['ntfy', 'terminal'])
  assert.equal(hasPackage(apps, 'ntfy'), true)
  assert.equal(hasPackage(apps, 'missing'), false)
})

test('catálogo ausente ou inválido não anuncia pacote opcional', () => {
  assert.deepEqual([...availablePackageNames(null)], [])
  assert.deepEqual([...availablePackageNames({ packageName: 'ntfy' })], [])
  assert.equal(hasPackage(undefined, 'ntfy'), false)
})
