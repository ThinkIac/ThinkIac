import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { __privilegedTest } from './privileged.js'

function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'agent-privileged-'))
  const root = join(base, 'project')
  const sibling = join(base, 'project-secret')
  mkdirSync(root)
  mkdirSync(sibling)
  writeFileSync(join(root, 'inside.txt'), 'inside')
  writeFileSync(join(sibling, 'outside.txt'), 'outside')
  t.after(() => rmSync(base, { recursive: true, force: true }))
  return { root, sibling }
}

test('containment rejects sibling roots and parent traversal', (t) => {
  const { root, sibling } = fixture(t)
  assert.throws(() => __privilegedTest.assertContained(root, sibling), /fora do projeto/)
  assert.throws(() => __privilegedTest.assertContained(root, '../project-secret/outside.txt'), /fora do projeto/)
})

test('containment rejects external symlinks, including creation below them', (t) => {
  const { root, sibling } = fixture(t)
  symlinkSync(sibling, join(root, 'external'))
  symlinkSync(join(sibling, 'missing.txt'), join(root, 'dangling'))
  assert.throws(() => __privilegedTest.assertContained(root, 'external/outside.txt'), /fora do projeto/)
  assert.throws(() => __privilegedTest.assertContained(root, 'external/new/deep.txt'), /fora do projeto/)
  assert.throws(() => __privilegedTest.assertContained(root, 'dangling'), /fora do projeto/)
})

test('containment permits legitimate paths and internal symlinks', (t) => {
  const { root } = fixture(t)
  mkdirSync(join(root, 'real'))
  writeFileSync(join(root, 'real', 'linked.txt'), 'linked')
  symlinkSync(join(root, 'real'), join(root, 'internal'))
  assert.equal(__privilegedTest.assertContained(root, 'inside.txt'), join(root, 'inside.txt'))
  assert.equal(__privilegedTest.assertContained(root, 'new/deep.txt'), join(root, 'new/deep.txt'))
  assert.equal(__privilegedTest.assertContained(root, 'internal/new.txt'), join(root, 'internal/new.txt'))
  assert.ok(__privilegedTest.walk(join(root, 'internal'), 0, 1, root).some(entry => entry.name === 'linked.txt'))
})

test('containment permits a project root reached through a symlink', (t) => {
  const { root } = fixture(t)
  const linkedRoot = join(dirname(root), 'linked-project')
  symlinkSync(root, linkedRoot)
  assert.equal(__privilegedTest.assertContained(linkedRoot, 'inside.txt'), join(linkedRoot, 'inside.txt'))
  assert.equal(__privilegedTest.assertContained(linkedRoot, 'new.txt'), join(linkedRoot, 'new.txt'))
})

test('directory walk does not follow a symlink outside the root', (t) => {
  const { root, sibling } = fixture(t)
  symlinkSync(sibling, join(root, 'external'))
  assert.throws(() => __privilegedTest.walk(root, 0, 3, root), /fora do projeto/)
})
