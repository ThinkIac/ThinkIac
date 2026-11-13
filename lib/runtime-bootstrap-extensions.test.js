import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applyRuntimeBootstrapExtensions } from './runtime-bootstrap-extensions.js'

const workspaces = []

function workspaceWithActiveExtension() {
  const workspace = mkdtempSync(join(tmpdir(), 'thinkiac-bootstrap-extension-'))
  workspaces.push(workspace)
  const packageDir = join(workspace, 'optional-package')
  mkdirSync(packageDir)
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify({
    type: 'module',
    logos: { bootstrap: './runtime-bootstrap.js' },
  }))
  writeFileSync(join(packageDir, 'runtime-bootstrap.js'), `
    export function configureRuntime({ environment }) {
      return { storage: { root: environment.STORAGE_ROOT, s3: { bucket: environment.BUCKET } } }
    }
  `)
  return workspace
}

afterEach(() => {
  while (workspaces.length) rmSync(workspaces.pop(), { recursive: true, force: true })
})

describe('runtime bootstrap extensions', () => {
  it('does nothing when an optional package is not active', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'thinkiac-bootstrap-empty-'))
    workspaces.push(workspace)
    await expect(applyRuntimeBootstrapExtensions({ workspace, config: { port: 5040 } }))
      .resolves.toEqual({ port: 5040 })
  })

  it('loads only an active package and merges its configuration', async () => {
    const workspace = workspaceWithActiveExtension()
    await expect(applyRuntimeBootstrapExtensions({
      workspace,
      environment: { STORAGE_ROOT: '/data', BUCKET: 'tenant-a' },
      config: { storage: { dataDir: '/data/storage' } },
    })).resolves.toEqual({
      storage: { root: '/data', dataDir: '/data/storage', s3: { bucket: 'tenant-a' } },
    })
  })

  it('preserves function-valued entrypoint settings while an extension is active', async () => {
    const workspace = workspaceWithActiveExtension()
    const middleware = () => undefined
    const config = await applyRuntimeBootstrapExtensions({
      workspace,
      environment: { STORAGE_ROOT: '/data', BUCKET: 'tenant-a' },
      config: { middleware: [middleware] },
    })
    expect(config.middleware[0]).toBe(middleware)
    expect(config.storage.s3.bucket).toBe('tenant-a')
  })
})
