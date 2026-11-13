import { lstat, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '../../..')
const MAX_PREVIEW_BYTES = 512 * 1024
const BLOCKED = /(^|\/)(?:\.git|node_modules|secrets)(?:\/|$)|(^|\/)\.env(?:\.|$)/i

const LANGUAGE_BY_EXTENSION = {
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript', '.jsx': 'javascript',
  '.svelte': 'svelte', '.json': 'json', '.md': 'markdown',
  '.yaml': 'yaml', '.yml': 'yaml', '.html': 'html', '.css': 'css',
  '.scss': 'scss', '.sh': 'bash', '.py': 'python', '.go': 'go',
  '.rs': 'rust', '.java': 'java', '.c': 'c', '.cpp': 'cpp', '.h': 'c',
  '.xml': 'xml', '.toml': 'toml', '.sql': 'sql', '.txt': 'text',
}

function isInside(root, candidate) {
  return candidate === root || candidate.startsWith(root + path.sep)
}

function languageFor(file) {
  return LANGUAGE_BY_EXTENSION[path.extname(file).toLowerCase()] || 'text'
}

/**
 * Resolve and read a text file without ever returning a host filesystem path
 * to the browser. `realpath` closes symlink escapes before the containment
 * check, and the payload is bounded to keep chat previews inexpensive.
 */
export async function readWorkspaceFile(rawPath, root = PROJECT_ROOT, maxBytes = MAX_PREVIEW_BYTES) {
  if (!rawPath || typeof rawPath !== 'string') {
    throw new Error('Caminho do arquivo é obrigatório')
  }

  const resolvedRoot = await realpath(root)
  const requested = path.isAbsolute(rawPath)
    ? path.resolve(rawPath)
    : path.resolve(resolvedRoot, rawPath)

  let resolved
  try {
    resolved = await realpath(requested)
  } catch {
    throw new Error('Arquivo não encontrado')
  }

  if (!isInside(resolvedRoot, resolved) || BLOCKED.test(path.relative(resolvedRoot, resolved))) {
    throw new Error('Caminho não permitido')
  }

  const info = await lstat(resolved)
  if (!info.isFile()) throw new Error('O caminho não aponta para um arquivo')

  const bytes = await readFile(resolved)
  const truncated = bytes.length > maxBytes
  const content = bytes.subarray(0, maxBytes).toString('utf8')
  const relativePath = path.relative(resolvedRoot, resolved).split(path.sep).join('/')

  return {
    path: relativePath,
    name: path.basename(resolved),
    language: languageFor(resolved),
    content,
    truncated,
  }
}

export async function filePreview(req, res) {
  /**
   * @register_router file-preview
   * @method GET
   */
  try {
    return await readWorkspaceFile(req.query?.path)
  } catch (error) {
    const message = error?.message || 'Não foi possível abrir o arquivo'
    const status = message === 'Arquivo não encontrado' ? 404 :
      message === 'Caminho não permitido' ? 403 : 400
    res.status(status)
    return { error: message }
  }
}
