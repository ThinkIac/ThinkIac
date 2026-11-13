import test from 'node:test'
import assert from 'node:assert/strict'
import { discoverAgentFiles, parseFrontmatter } from '../lib/discovery.js'

test('parseFrontmatter separa meta e corpo', () => {
  const { meta, body } = parseFrontmatter('---\nname: X\ndescription: faz coisas\nalways: true\n---\nCorpo aqui')
  assert.equal(meta.name, 'X')
  assert.equal(meta.description, 'faz coisas')
  assert.equal(meta.always, 'true')
  assert.equal(body, 'Corpo aqui')
})

test('parseFrontmatter sem frontmatter devolve o texto inteiro como corpo', () => {
  const { meta, body } = parseFrontmatter('Só corpo, sem header')
  assert.deepEqual(meta, {})
  assert.equal(body, 'Só corpo, sem header')
})

test('discoverAgentFiles acha pelo menos um AGENT.md de pacote', () => {
  const files = discoverAgentFiles({ includeRoot: false })
  assert.ok(files.length > 0, 'esperava ao menos um AGENT.md de pacote no runtime')
  for (const f of files) {
    assert.equal(typeof f.pkg, 'string')
    assert.equal(typeof f.name, 'string')
    assert.equal(typeof f.body, 'string')
    assert.ok(f.body.length > 0)
    assert.equal(typeof f.path, 'string')
  }
})

test('excludePackages remove o pacote pedido', () => {
  const withIt = discoverAgentFiles({ includeRoot: false })
  const pkgToExclude = withIt[0]?.pkg
  assert.ok(pkgToExclude, 'precisa de ao menos um AGENT.md pra este teste fazer sentido')
  const withoutIt = discoverAgentFiles({ includeRoot: false, excludePackages: [pkgToExclude] })
  assert.ok(!withoutIt.some(f => f.pkg === pkgToExclude))
})

test('cada entrada é independente (não referencia estado global mutável)', () => {
  const a = discoverAgentFiles({ includeRoot: false })
  const b = discoverAgentFiles({ includeRoot: false })
  assert.deepEqual(a.map(f => f.pkg).sort(), b.map(f => f.pkg).sort())
})
