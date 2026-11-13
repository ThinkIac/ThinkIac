import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createWorkspaceResolver, findGitRoot, resolveWorkspaceSelection, workspaceRootsFromEnv, workspaceRootsFromModule } from './workspace.js'

let root
let outside

test.before(async () => {
  root = await mkdtemp(join(tmpdir(), 'agent-workspace-root-'))
  outside = await mkdtemp(join(tmpdir(), 'agent-workspace-outside-'))
  await mkdir(join(root, 'apps', 'thinkiac'), { recursive: true })
  await symlink(outside, join(root, 'outside-link'))
})

test.after(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

test('lista apenas raízes permitidas e resolve diretórios descendentes', async () => {
  const resolver = createWorkspaceResolver([root])
  const catalog = await resolver.listRoots()
  assert.deepEqual(catalog, [{ path: root, label: root.split('/').pop() }])

  const selected = await resolver.resolve(join(root, 'apps', 'thinkiac'))
  assert.equal(selected.path, join(root, 'apps', 'thinkiac'))
  assert.equal(selected.root, root)
  assert.equal(selected.label, 'thinkiac')
})

test('rejeita caminho fora da raiz e symlink que escapa dela', async () => {
  const resolver = createWorkspaceResolver([root])
  await assert.rejects(() => resolver.resolve(outside), /not allowed/)
  await assert.rejects(() => resolver.resolve(join(root, 'outside-link')), /not allowed/)
})

test('detecta a raiz Git e mantém raízes configuradas como adicionais', async () => {
  await mkdir(join(root, '.git'))
  await writeFile(join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n')
  const nested = join(root, 'apps', 'thinkiac')

  assert.equal(findGitRoot(nested), root)
  assert.deepEqual(workspaceRootsFromEnv(nested, outside), [root, outside])
})

test('deriva a mesma raiz do Runtime a partir de módulos em diretórios diferentes', async () => {
  const packageDir = join(root, 'packages')
  await mkdir(join(packageDir, 'agent', 'routes'), { recursive: true })
  const entry = pathToFileURL(join(root, 'packages', 'agent', 'index.js')).href
  const route = pathToFileURL(join(root, 'packages', 'agent', 'routes', 'chat.js')).href

  assert.deepEqual(workspaceRootsFromModule(entry, outside), [root, outside])
  assert.deepEqual(workspaceRootsFromModule(route, outside), [root, outside])
  await rm(packageDir, { recursive: true, force: true })
})

test('usa a raiz automática sem seleção e preserva uma seleção explícita', async () => {
  const resolver = createWorkspaceResolver([root])
  assert.equal((await resolveWorkspaceSelection(resolver)).path, root)
  assert.equal(
    (await resolveWorkspaceSelection(resolver, { path: join(root, 'apps', 'thinkiac') })).path,
    join(root, 'apps', 'thinkiac'),
  )
})

test('lista somente diretórios filhos e não segue symlinks externos', async () => {
  const resolver = createWorkspaceResolver([root])
  const result = await resolver.list(root)
  assert.equal(result.path, root)
  assert.equal(result.parent, null)
  assert.deepEqual(result.entries.map((entry) => entry.name), ['apps'])
})
