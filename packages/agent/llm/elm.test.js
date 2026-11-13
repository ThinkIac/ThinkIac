import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getElmMembers,
  resolveElm,
  expandModelChain,
  chainHasElm,
  listElms,
} from './elm.js'

const CFG = {
  llm: {
    elm: {
      'custom-chain': {
        tier: 'custom',
        members: [{ id: 'vendor/first' }, 'vendor/second'],
      },
    },
  },
}

test('ELM normaliza membros sem metadados de seleção', () => {
  assert.deepEqual(getElmMembers('custom-chain', CFG), [
    { id: 'vendor/first' },
    { id: 'vendor/second' },
  ])
  assert.equal(resolveElm('custom-chain', CFG).tier, 'custom')
})

test('ELM expande uma cadeia ordenada de fallback', () => {
  assert.deepEqual(
    expandModelChain(['before', 'custom-chain', 'vendor/second'], CFG),
    ['before', 'vendor/first', 'vendor/second'],
  )
  assert.equal(chainHasElm(['custom-chain'], CFG), true)
  assert.ok(listElms(CFG).some(model => model.id === 'custom-chain'))
})
