import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function mergeConfig(base, extension) {
  const output = { ...base }
  for (const [key, value] of Object.entries(extension)) {
    output[key] = isObject(output[key]) && isObject(value)
      ? mergeConfig(output[key], value)
      : value
  }
  return output
}

function packageEntries(workspace) {
  if (!existsSync(workspace)) return []
  return readdirSync(workspace, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => entry.name)
    .sort()
}

function bootstrapEntry(packageDir, entry) {
  if (typeof entry !== 'string' || !entry.startsWith('./')) {
    throw new Error('a extensão de bootstrap precisa declarar um caminho relativo começando com "./"')
  }
  const file = resolve(packageDir, entry)
  const packageRoot = resolve(packageDir)
  if (relative(packageRoot, file).startsWith('..') || !existsSync(file)) {
    throw new Error(`entrada de bootstrap inválida: ${entry}`)
  }
  return file
}

/**
 * Collects configuration from active workspace packages before Lógos starts.
 * A package opts in with `package.json > logos.bootstrap` and exports
 * `configureRuntime(context)`. Disabled packages are outside the workspace,
 * so they cannot contribute configuration or run code.
 */
export async function applyRuntimeBootstrapExtensions({ workspace = './packages', config = {}, environment = process.env } = {}) {
  const activeWorkspace = resolve(workspace)
  let runtimeConfig = { ...config }

  for (const folder of packageEntries(activeWorkspace)) {
    const packageDir = resolve(activeWorkspace, folder)
    const manifestFile = resolve(packageDir, 'package.json')
    if (!existsSync(manifestFile)) continue

    let manifest
    try {
      manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
    } catch (error) {
      throw new Error(`pacote ativo "${folder}" possui package.json inválido: ${error.message}`)
    }

    const declaredEntry = manifest?.logos?.bootstrap
    if (!declaredEntry) continue

    const entry = bootstrapEntry(packageDir, declaredEntry)
    let extension
    try {
      extension = await import(pathToFileURL(entry).href)
    } catch (error) {
      throw new Error(`não foi possível carregar a extensão de bootstrap de "${folder}": ${error.message}`)
    }
    if (typeof extension.configureRuntime !== 'function') {
      throw new Error(`a extensão de bootstrap de "${folder}" não exporta configureRuntime()`)
    }

    const contribution = await extension.configureRuntime({
      environment,
      package: { folder, dir: packageDir, manifest },
    })
    if (contribution === undefined) continue
    if (!isObject(contribution)) {
      throw new Error(`a extensão de bootstrap de "${folder}" deve retornar um objeto de configuração`)
    }
    runtimeConfig = mergeConfig(runtimeConfig, contribution)
  }

  return runtimeConfig
}
