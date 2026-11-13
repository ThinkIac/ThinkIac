import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readWorkspaceFile } from './file_preview.js'

let root

test.before(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'agent-file-preview-'))
  await mkdir(path.join(root, 'packages', 'demo'), { recursive: true })
  await writeFile(path.join(root, 'packages', 'demo', 'hello.js'), 'export const hello = true\n')
  await writeFile(path.join(root, '.env'), 'SECRET=value\n')
})

test.after(async () => rm(root, { recursive: true, force: true }))

test('lê um arquivo do workspace por caminho relativo ou absoluto', async () => {
  const relative = await readWorkspaceFile('packages/demo/hello.js', root)
  const absolute = await readWorkspaceFile(path.join(root, 'packages/demo/hello.js'), root)

  assert.equal(relative.content, 'export const hello = true\n')
  assert.equal(absolute.path, 'packages/demo/hello.js')
  assert.equal(relative.language, 'javascript')
})

test('rejeita caminhos fora do workspace e symlinks que escapam dele', async () => {
  await assert.rejects(() => readWorkspaceFile('/etc/hosts', root), /não permitido/)
  await symlink('/etc/hosts', path.join(root, 'packages', 'demo', 'hosts-link'))
  await assert.rejects(
    () => readWorkspaceFile('packages/demo/hosts-link', root),
    /não permitido/,
  )
})

test('bloqueia arquivos sensíveis mesmo dentro do workspace', async () => {
  await assert.rejects(() => readWorkspaceFile('.env', root), /não permitido/)
})

test('limita previews muito grandes sem expor o arquivo inteiro', async () => {
  const source = 'a'.repeat(100)
  await writeFile(path.join(root, 'packages', 'demo', 'large.txt'), source)
  const result = await readWorkspaceFile('packages/demo/large.txt', root, 20)

  assert.equal(result.content, source.slice(0, 20))
  assert.equal(result.truncated, true)
})
