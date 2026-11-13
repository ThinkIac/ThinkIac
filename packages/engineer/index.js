// engineer/index.js — Ferramentas de engenharia de código e filesystem
// @package engineer
// Se este package for removido, Aurora perde: read_file, write_file, patch_file,
// patch_file_multi, diff_preview, list_dir, run_shell, search_code,
// restore_backup, create_runtime_package.

import { createHash } from 'node:crypto'
import { captureWorkspaceBaseline, inspectWorktree, prepareWorktree, resolveValidationCommands } from './lib/swe-workflow.js'

function fileEvidence(path, content) {
  return { changedState: true, sourceEvidence: { path, hash: createHash('sha256').update(content).digest('hex'), checks: /\.(js|mjs|cjs|ts)$/.test(path) ? [{ name: 'syntax', ok: true }] : [] } }
}

function digest(content) {
  return createHash('sha256').update(content ?? '').digest('hex')
}

function mutationEvidence(abs, before, after, checkpointId) {
  return {
    operationId: `op_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    beforeDigest: before == null ? null : `sha256:${digest(before)}`,
    afterDigest: after == null ? null : `sha256:${digest(after)}`,
    checkpointRef: checkpointId ? `checkpoint:${checkpointId}` : null,
    validationHint: resolveValidationCommands(PROJECT_ROOT, abs),
  }
}

function page(items, offset = 0, limit = null) {
  const start = Math.max(0, Number.parseInt(offset, 10) || 0)
  const size = limit == null ? items.length : Math.max(1, Number.parseInt(limit, 10) || 1)
  const selected = items.slice(start, start + size)
  const next = start + selected.length < items.length ? start + selected.length : null
  return {
    items: selected,
    coverage: { complete: next === null, returned: selected.length, totalKnown: items.length, nextCursor: next },
    truncated: next !== null,
  }
}

import {
    readFileSync, writeFileSync, existsSync,
    readdirSync, statSync, mkdirSync, realpathSync,
  } from 'fs'
  import { join, resolve, relative, dirname, basename } from 'path'
  import { fileURLToPath } from 'url'
  import { execFile } from 'child_process'
  import { promisify } from 'util'
  
  const execAsync = promisify(execFile)
  const PKG_DIR   = dirname(fileURLToPath(import.meta.url))
  
  // ── Detecção dinâmica da raiz do projeto (thinkiac/) ─────────────────────────
  //
  // Sobe a partir de packages/engineer até encontrar o diretório que contém
  // um marcador inequívoco do projeto (package.json com "name": "thinkiac", ou
  // um arquivo .thinkiac-root, ou node_modules + packages/ juntos).
  // Fallback: três níveis acima de PKG_DIR (packages/engineer → packages → raiz).
  
  function findProjectRoot(startDir) {
    let dir = resolve(startDir)
    const root = resolve('/')
  
    while (dir !== root) {
      // Marcador explícito tem prioridade
      if (existsSync(join(dir, '.thinkiac-root'))) return dir
  
      // package.json com name "thinkiac"
      const pkgJson = join(dir, 'package.json')
      if (existsSync(pkgJson)) {
        try {
          const pkg = JSON.parse(readFileSync(pkgJson, 'utf8'))
          if (pkg.name === 'thinkiac') return dir
        } catch {}
      }
  
      // Heurística: tem tanto packages/ quanto node_modules/ no mesmo nível
      if (
        existsSync(join(dir, 'packages')) &&
        existsSync(join(dir, 'node_modules'))
      ) return dir
  
      dir = dirname(dir)
    }
  
    // Fallback: packages/engineer → packages → raiz do projeto
    return resolve(PKG_DIR, '..', '..')
  }
  
  const PROJECT_ROOT  = findProjectRoot(PKG_DIR)   // ex: /srv/thinkiac
  const PACKAGES_DIR  = join(PROJECT_ROOT, 'packages')
  const WRITE_ROOTS = [
    PROJECT_ROOT,
    // Bootstrap controlado: permite ao Engineer manter o núcleo Logos que
    // hospeda o próprio gateway MCP, sem liberar escrita fora desta instalação.
    join(PROJECT_ROOT, 'vendor', 'packages', 'logos'),
  ].map(root => resolve(root))
  const SHELL_TIMEOUT     = 15_000
  const MAX_SHELL_TIMEOUT = 120_000
  const SHELL_MAX_BUFFER  = 10 * 1024 * 1024   // 10 MB
  const BACKUP_DIR    = join(PKG_DIR, 'backups')
  const MAX_BACKUPS_PER_FILE = 20
  const MAX_QUERY_LENGTH     = 500

// ── Checkpoint automático (data/checkpoints) ────────────────────────────────
// Mantém backup/metadata antes de qualquer mutação de arquivo.
//
// Formato:
//   data/checkpoints/<rel-path-safe>/<checkpointId>.json
//   data/checkpoints/<rel-path-safe>/<checkpointId>.bak
//
// O .bak contém o conteúdo anterior; o .json contém o estado esperado para restore.

const CHECKPOINT_DIR = join(PROJECT_ROOT, 'data', 'checkpoints')
const CHECKPOINT_VERSION = '1.0.0'

function safeRelativePath(abs) {
  try {
    return relative(PROJECT_ROOT, abs)
  } catch {
    return abs
  }
}

function checkpointDirFor(abs) {
  const rel = safeRelativePath(abs).replace(/\\/g, '_').replace(/[^a-zA-Z0-9_.-]/g, '_')
  return join(CHECKPOINT_DIR, rel)
}

function checkpointMetaPath(abs, checkpointId) {
  return join(checkpointDirFor(abs), checkpointId + '.json')
}

function checkpointBackupPath(abs, checkpointId) {
  return join(checkpointDirFor(abs), checkpointId + '.bak')
}

function createCheckpointForFile(abs, { reason, sessionId, action, existed } = {}) {
  const checkpointId = Date.now() + '-' + Math.random().toString(16).slice(2)
  const dir = checkpointDirFor(abs)
  mkdirSync(dir, { recursive: true })

  const existedNow = existed !== undefined ? existed : existsSync(abs)
  const content = existedNow ? readFileSync(abs, 'utf8') : null

  const backupPath = checkpointBackupPath(abs, checkpointId)
  if (existedNow) writeFileSync(backupPath, content, 'utf8')

  const meta = {
    checkpointId,
    path: safeRelativePath(abs),
    absolutePath: abs,
    reason: reason || 'engineer mutation',
    action: action || 'unknown',
    sessionId: sessionId || null,
    createdAt: new Date().toISOString(),
    existed,
    existedNow,
    version: CHECKPOINT_VERSION,
    backupPath,
    backupBytes: existedNow ? Buffer.byteLength(content, 'utf8') : 0,
  }

  writeFileSync(checkpointMetaPath(abs, checkpointId), JSON.stringify(meta, null, 2), 'utf8')
  return { success: true, ...meta }
}

function restoreCheckpointForFile(abs, checkpointId) {
  const metaPath = checkpointMetaPath(abs, checkpointId)
  if (!existsSync(metaPath)) {
    return { success: false, error: 'Checkpoint ' + checkpointId + ' não encontrado para ' + safeRelativePath(abs) }
  }

  const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
  const backupPath = meta.backupPath || checkpointBackupPath(abs, checkpointId)
  const target = abs

  if (!meta.existedNow) {
    if (existsSync(target)) {
      try { writeFileSync(target, '', 'utf8') } catch {}
    }
    return {
      success: true,
      restored: checkpointId,
      path: safeRelativePath(abs),
      note: 'Arquivo não existia no checkpoint; estado restaurado para ausência do arquivo.',
    }
  }

  if (!existsSync(backupPath)) {
    return { success: false, error: 'Backup não encontrado: ' + backupPath }
  }

  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, readFileSync(backupPath, 'utf8'), 'utf8')

  return {
    success: true,
    restored: checkpointId,
    path: safeRelativePath(abs),
    restoredFrom: backupPath,
  }
}

function listCheckpoints({ sessionId, limit = 50 } = {}) {
  if (!existsSync(CHECKPOINT_DIR)) return { success: true, checkpoints: [], total: 0 }

  const checkpoints = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const entryPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(entryPath)
        continue
      }
      if (!entry.name.endsWith('.json')) continue
      try {
        const meta = JSON.parse(readFileSync(entryPath, 'utf8'))
        if (sessionId && meta.sessionId !== sessionId) continue
        checkpoints.push(meta)
      } catch {}
    }
  }
  walk(CHECKPOINT_DIR)
  checkpoints.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return { success: true, checkpoints: checkpoints.slice(0, limit), total: checkpoints.length }
}

function removeCheckpoint(checkpointId) {
  if (!existsSync(CHECKPOINT_DIR)) return { success: false, error: 'Nenhum checkpoint encontrado' }

  let found = null
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const entryPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(entryPath)
        continue
      }
      if (!entry.name.endsWith('.json')) continue
      try {
        const meta = JSON.parse(readFileSync(entryPath, 'utf8'))
        if (meta.checkpointId === checkpointId) found = { meta, metaPath: entryPath, backupPath: meta.backupPath }
      } catch {}
    }
  }
  walk(CHECKPOINT_DIR)

  if (!found) return { success: false, error: 'Checkpoint ' + checkpointId + ' não encontrado' }

  return { success: true, removed: checkpointId, note: 'Remoção lógica confirmada; arquivo de metadados preservado para auditoria.' }
}

function __checkpointCreateForTest(abs, options = {}) {
  return createCheckpointForFile(abs, options)
}

function __checkpointRestoreForTest(abs, checkpointId, options = {}) {
  return restoreCheckpointForFile(abs, checkpointId, options)
}

function __checkpointListForTest(options = {}) {
  return listCheckpoints(options)
}

function __checkpointRemoveForTest(checkpointId, options = {}) {
  return removeCheckpoint(checkpointId, options)
}
  
  // ── Proteções ─────────────────────────────────────────────────────────────────
  
  // Arquivos que requerem patch cirúrgico (nunca write_file completo)
  const CORE_PROTECTED = new Set([
    'agent.js', 'builtin_tools.js', 'llm.js', 'provider.js',
    'memory.js', 'registry.js', 'sandbox.js', 'privileged.js',
    'channels.js', 'config.js', 'history.js', 'llm_keys.js',
    'metacognition.js', 'runtime_bridge.js', 'timezone.js',
  ])
  
  // ── Classificação de risco do shell (dois níveis) ────────────────────────────
  //
  //   HARD_BLOCK  → catastrófico/irreversível. Nunca executa, mesmo com confirm.
  //   CONFIRM     → perigoso mas às vezes legítimo. Só executa com confirm:true
  //                 (o agente pede confirmação ao usuário via StructuredInput).
  //
  // Blocklist não é barreira de segurança absoluta (o processo roda como root);
  // é uma rede de proteção contra erro acidental + gate de confirmação humana.

  const HARD_BLOCK = [
    { re: /rm\s+-[a-z]*r[a-z]*f|rm\s+-[a-z]*f[a-z]*r/i, test: (n) => /rm\s+-\S*[rf]\S*\s+(\/|~|\/\*|\.\s*$|\.\.\s|\$HOME)/.test(n), reason: 'remoção recursiva de raiz/home' },
    { re: /--no-preserve-root/, reason: 'rm --no-preserve-root' },
    { re: /\bmkfs\b|\bwipefs\b/, reason: 'formatação de filesystem' },
    { re: /\bdd\b[^\n]*\bof=\/dev\//, reason: 'dd sobre device de bloco' },
    { re: />\s*\/dev\/(sd|nvme|vd|hd)/, reason: 'escrita direta em device de disco' },
    { re: /:\s*\(\s*\)\s*\{[^}]*:\s*[|&]/, reason: 'fork bomb' },
    { re: /\bchmod\s+-R\s+0*777\s+\//, reason: 'chmod 777 recursivo na raiz' },
    { re: /\bshred\b[^\n]*\/dev\//, reason: 'shred de device' },
  ]

  const CONFIRM_SHELL = [
    { re: /\bsudo\b/, reason: 'elevação de privilégio (sudo)' },
    { re: /\brm\s+-\S*[rf]/, reason: 'remoção recursiva/forçada de arquivos' },
    { re: /(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba)?sh/, reason: 'download direto para shell (curl|sh)' },
    { re: /\b(shutdown|reboot|halt|poweroff|init\s+0|init\s+6)\b/, reason: 'desligar/reiniciar a máquina' },
    { re: /\b(kill|pkill|killall)\b/, reason: 'encerrar processos' },
    { re: /\bsystemctl\s+(stop|restart|disable|mask)\b/, reason: 'parar/reiniciar serviço systemd' },
    { re: /\b(?:logos\s+supervisor|logos-supervisor|supervisor\/cli\.cjs)\s+(stop|restart|shutdown)\b/, reason: 'interromper serviço supervisionado pelo Lógos' },
    { re: /\bpm2\s+(stop|delete|kill|restart)\b/, reason: 'derrubar processo PM2 (pode matar a própria Aurora)' },
    { re: /\bchmod\s+-R\b|\bchown\s+-R\b/, reason: 'chmod/chown recursivo' },
    { re: /\bgit\s+push\b[^\n]*(--force|-f)\b|\bgit\s+reset\s+--hard\b|\bgit\s+clean\s+-\S*f/, reason: 'operação git destrutiva' },
    { re: /\b(apt|apt-get|dpkg|yum|dnf)\s+(install|remove|purge|upgrade)\b/, reason: 'alteração de pacotes do sistema' },
    { re: /\bnpm\s+(publish|unpublish)\b/, reason: 'publicação em registro npm' },
    { re: /\bmv\b[^\n]*\s\/(etc|usr|bin|boot|lib|var|root)\b/, reason: 'mover para diretório de sistema' },
    { re: /\btruncate\b|\bfallocate\b/, reason: 'truncar/alocar arquivo' },
  ]
  
  const IGNORE_DIRS = ['node_modules', '.git', '.turbo', 'dist', '.cache', 'embeddings.json']
  
  // ── Helpers internos ──────────────────────────────────────────────────────────
  
  /**
   * Resolve um path para absoluto seguindo as regras do engineer:
   *
   *   • Relativo  → resolve a partir de PROJECT_ROOT (thinkiac/)
   *                 ex: "packages/aurora/test.js" → "<root>/packages/aurora/test.js"
   *
   *   • Absoluto  → usa direto, sem restrição de leitura
   *                 ex: "/etc/hosts" → "/etc/hosts"
   *
   * A restrição de ESCRITA é aplicada separadamente em assertWritePath.
   */
  const resolvePath = (p) => {
    if (!p) throw new Error('Path não pode ser vazio')
    // Path absoluto: usa como está
    if (p.startsWith('/')) return resolve(p)
    // Relativo: ancora em PROJECT_ROOT
    return resolve(PROJECT_ROOT, p)
  }
  
  /**
   * Garante que o path está dentro do PROJECT_ROOT antes de qualquer escrita.
   * Leitura é liberada em qualquer caminho absoluto válido via resolvePath.
   */
  const isWithinRoot = (abs, root) => abs === root || abs.startsWith(root + '/')

  const assertWritePath = (abs) => {
    let existing = abs
    const missing = []
    while (!existsSync(existing)) {
      const parent = dirname(existing)
      if (parent === existing) break
      missing.unshift(basename(existing))
      existing = parent
    }
    const canonicalBase = existsSync(existing) ? realpathSync(existing) : existing
    const canonical = resolve(canonicalBase, ...missing)
    const allowedRoot = WRITE_ROOTS.find(root => isWithinRoot(canonical, root))
    if (!allowedRoot) {
      throw new Error(
        `Escrita bloqueada fora do projeto: "${canonical}"\n` +
        `  Permitido: ${WRITE_ROOTS.map(root => root + '/**').join(', ')}\n` +
        `  Para leitura use read_file com path absoluto.`
      )
    }
    return canonical
  }
  
  /** Atalho: resolve + valida escrita (uso em write_file, patch_file etc.) */
  const assertPath = (p) => assertWritePath(resolvePath(p))
  
  // Normaliza unicode e espaços; separa em comandos individuais para checar cada
  // segmento (evita esconder um comando perigoso depois de ; && || | &).
  const normalizeShell = (cmd) => cmd.normalize('NFC').replace(/\s+/g, ' ').trim()

  const matchRule = (rule, normalized) =>
    rule.test ? rule.test(normalized) : rule.re.test(normalized)

  /**
   * Classifica um comando shell em: 'block' | 'confirm' | 'ok'.
   * Retorna { level, reason }.
   */
  const classifyShell = (cmd) => {
    const normalized = normalizeShell(cmd)
    for (const rule of HARD_BLOCK) {
      if (matchRule(rule, normalized)) return { level: 'block', reason: rule.reason }
    }
    for (const rule of CONFIRM_SHELL) {
      if (matchRule(rule, normalized)) return { level: 'confirm', reason: rule.reason }
    }
    return { level: 'ok', reason: null }
  }
  
  const isCoreFile = (absPath) => CORE_PROTECTED.has(basename(absPath))
  
  const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  
  async function checkJsSyntax(absPath) {
    if (!/\.(js|mjs|cjs|ts)$/.test(absPath)) return null
    try {
      await execAsync('node', ['--check', absPath], { timeout: 5000, maxBuffer: 64 * 1024 })
      return null
    } catch (e) {
      return e.stderr?.trim() || e.message
    }
  }
  
  // ── Backup local ──────────────────────────────────────────────────────────────
  
  /**
   * Salva um backup local do arquivo antes de qualquer mutação.
   * Recebe o conteúdo já lido para evitar double-read.
   * Limita automaticamente a MAX_BACKUPS_PER_FILE entradas por arquivo.
   */
  function saveLocalBackup(abs, content) {
    const ts   = Date.now()
    const name = basename(abs).replace(/[^a-zA-Z0-9_.-]/g, '_')
    const bakDir = join(BACKUP_DIR, name)
    mkdirSync(bakDir, { recursive: true })
  
    const bakPath = join(bakDir, `${ts}.bak`)
    writeFileSync(bakPath, content, 'utf8')
  
    // Limpeza: mantém apenas os N mais recentes
    try {
      const entries = readdirSync(bakDir)
        .filter(f => f.endsWith('.bak'))
        .sort()                              // lexicográfico = cronológico (timestamp)
      if (entries.length > MAX_BACKUPS_PER_FILE) {
        for (const old of entries.slice(0, entries.length - MAX_BACKUPS_PER_FILE)) {
          try { import('fs').then(({ unlinkSync }) => unlinkSync(join(bakDir, old))) } catch {}
        }
      }
    } catch {}
  
    return { backupId: String(ts), path: bakPath, name }
  }
  
  function restoreLocalBackup(backupId, abs) {
    const name    = basename(abs).replace(/[^a-zA-Z0-9_.-]/g, '_')
    const bakPath = join(BACKUP_DIR, name, `${backupId}.bak`)
    if (!existsSync(bakPath)) return false
    writeFileSync(abs, readFileSync(bakPath, 'utf8'), 'utf8')
    return true
  }
  
  // ── Valida exports essenciais em core files ───────────────────────────────────
  
  const CORE_EXPORTS = {
    'agent.js':         /\bexport\s+(async\s+)?function\s+(createAgent|buildSystem|getSession)\b/,
    'builtin_tools.js': /\bexport\s+(async\s+)?function\s+(call_llm|tool_chat|list_runtime_tools|run_runtime_tool)\b/,
    'llm.js':           /\bexport\s+(async\s+)?function\s+(callLlm|streamLlm)\b/,
    'provider.js':      /\bexport\s+(async\s+)?function\s+(callProvider|getProvider|setProvider)\b/,
    'registry.js':      /\bexport\s+(async\s+)?function\s+(registerTool|getTool|listTools)\b/,
  }
  
  function checkCoreExports(absPath) {
    const name   = basename(absPath)
    const checks = CORE_EXPORTS[name]
    if (!checks) return { passed: true }
    const content = readFileSync(absPath, 'utf8')
    if (!checks.test(content)) {
      return { passed: false, error: `Export essencial ausente em ${name} — regex: ${checks}` }
    }
    return { passed: true }
  }
  
  
  // ── Snapshot via memory-tools (opcional) ──────────────────────────────────────
  
  async function saveSnapshot(abs, ctx) {
    try {
      const { invokeRuntimeTool } = await import('logos')
      return await invokeRuntimeTool('memory-tools', 'snapshot_save', { path: abs, ...ctx })
    } catch {
      return null
    }
  }
  
  // ── Diff unificado minimalista (sem dependência externa) ──────────────────────
  
  /**
   * Gera um unified diff legível entre dois textos em memória.
   * Implementação própria para não depender de binários externos.
   */
  function unifiedDiff(oldText, newText, label = 'arquivo') {
    const oldLines = oldText.split('\n')
    const newLines = newText.split('\n')
  
    // LCS simplificado linha a linha — eficiente para diffs cirúrgicos pequenos
    const hunks = []
    let i = 0, j = 0
  
    while (i < oldLines.length || j < newLines.length) {
      if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
        i++; j++
        continue
      }
  
      const hunkStart = { old: i, new: j }
      const removed = []
      const added   = []
  
      // Avança até próxima linha igual ou fim
      while (
        (i < oldLines.length || j < newLines.length) &&
        !(oldLines[i] === newLines[j] && i < oldLines.length && j < newLines.length)
      ) {
        if (i < oldLines.length) removed.push(oldLines[i++])
        if (j < newLines.length) added.push(newLines[j++])
      }
  
      if (removed.length || added.length) {
        hunks.push({
          oldStart: hunkStart.old + 1,
          newStart: hunkStart.new + 1,
          removed,
          added,
        })
      }
    }
  
    if (!hunks.length) return null  // sem diferença
  
    const lines = [`--- a/${label}`, `+++ b/${label}`]
    for (const h of hunks) {
      lines.push(`@@ -${h.oldStart},${h.removed.length} +${h.newStart},${h.added.length} @@`)
      for (const l of h.removed) lines.push(`-${l}`)
      for (const l of h.added)   lines.push(`+${l}`)
    }
  
    return {
      hunks: hunks.length,
      additions: hunks.reduce((n, h) => n + h.added.length, 0),
      deletions: hunks.reduce((n, h) => n + h.removed.length, 0),
      diff: lines.join('\n'),
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // TOOLS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  export async function readFile(input) {
    /**
     * @register_tool read_file
     * @description Lê qualquer arquivo. Aceita path relativo (âncora: PROJECT_ROOT)
     * ou path absoluto (leitura livre — escrita fora do projeto é bloqueada).
     * SEMPRE ler antes de editar.
     * @param {string} path - Caminho relativo ao PROJECT_ROOT ou absoluto
     * @param {number?} start_line - Primeira linha, base 1 (padrão: 1)
     * @param {number?} max_lines - Máximo de linhas; omitido preserva leitura completa
     * @param {number?} max_bytes - Máximo de bytes UTF-8 retornados
     */
    const { path: p, start_line = 1, max_lines = null, max_bytes = null } = input
    const abs = resolvePath(p)   // leitura: sem restrição de localização
    if (!existsSync(abs)) return { success: false, error: `Não encontrado: ${abs}` }
    try {
      const fullContent = readFileSync(abs, 'utf8')
      const allLines = fullContent.split('\n')
      const start = Math.max(0, Number.parseInt(start_line, 10) - 1 || 0)
      const requestedEnd = max_lines == null ? allLines.length : start + Math.max(1, Number.parseInt(max_lines, 10) || 1)
      let selected = allLines.slice(start, requestedEnd)
      let content = selected.join('\n')
      let byteTruncated = false
      if (max_bytes != null && Buffer.byteLength(content, 'utf8') > max_bytes) {
        content = Buffer.from(content).subarray(0, Math.max(1, Number(max_bytes))).toString('utf8')
        byteTruncated = true
      }
      const end = start + selected.length
      const truncated = byteTruncated || end < allLines.length
      const isInternal = abs.startsWith(PROJECT_ROOT)
      return {
        success: true,
        path: isInternal ? relative(PROJECT_ROOT, abs) : abs,
        absolute: abs,
        lines: allLines.length,
        content,
        coverage: {
          complete: !truncated,
          returned: selected.length,
          totalKnown: allLines.length,
          nextCursor: end < allLines.length ? end + 1 : null,
        },
        source: { path: isInternal ? relative(PROJECT_ROOT, abs) : abs, revision: `sha256:${digest(fullContent)}`, range: { start: start + 1, end } },
        truncated,
      }
    } catch (e) {
      return { success: false, error: e.message }
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  
  export async function writeFile(input) {
    /**
     * @register_tool write_file
     * @description Cria ou sobrescreve um arquivo. Bloqueado em core files (use patch_file).
     * Escrita sempre restrita ao PROJECT_ROOT — use path relativo ou absoluto interno.
     * @param {string} path - Caminho relativo ao PROJECT_ROOT ou absoluto (dentro do projeto)
     * @param {string} content - Conteúdo do arquivo
     * @param {boolean?} append - Anexar ao final em vez de sobrescrever (padrão: false)
     */
    const { path: p, content, append = false } = input
    const abs = assertPath(p)
  
    if (isCoreFile(abs)) {
      return {
        success: false,
        error: `"${basename(abs)}" é um arquivo core protegido. Use patch_file para edições cirúrgicas.`,
        core_protected: true,
      }
    }
  
    try {
      const existed  = existsSync(abs)
      const previous = existed ? readFileSync(abs, 'utf8') : null
      const checkpoint = createCheckpointForFile(abs, {
        reason: append ? 'write_file (append)' : 'write_file',
        sessionId: input?.sessionId || null,
        action: append ? 'append' : 'overwrite_or_create',
        existed,
      })
      const snap = await saveSnapshot(abs, { reason: append ? 'write_file (append)' : 'write_file' })
  
      mkdirSync(dirname(abs), { recursive: true })
      const final = append && previous != null ? previous + content : content
      writeFileSync(abs, final, 'utf8')
  
      const syntaxErr = await checkJsSyntax(abs)
      if (syntaxErr) {
        const restored = restoreCheckpointForFile(abs, checkpoint.checkpointId)
        return {
          success: false,
          path: relative(PROJECT_ROOT, abs),
          error: 'Sintaxe inválida — rollback automático',
          syntax_error: syntaxErr,
          rolled_back: restored.success,
          checkpoint_id: checkpoint.checkpointId,
          restore_error: restored.success ? null : restored.error,
        }
      }
  
      return {
        success: true,
        path: relative(PROJECT_ROOT, abs),
        ...fileEvidence(abs, final),
        bytes: Buffer.byteLength(final, 'utf8'),
        checkpoint_id: checkpoint.checkpointId,
        snapshot_at: snap?.timestamp ?? null,
        ...mutationEvidence(abs, previous, final, checkpoint.checkpointId),
      }
    } catch (e) {
      return { success: false, error: e.message }
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  
  export async function patchFile(input) {
    /**
     * @register_tool patch_file
     * @description Substituição cirúrgica em qualquer arquivo. old_str deve ser único no arquivo.
     * @param {string} path - Caminho relativo ao workspace
     * @param {string} old_str - Trecho único a substituir
     * @param {string} new_str - Novo conteúdo
     * @param {boolean?} skip_validation - Pular validações extras (padrão: false)
     */
    const { path: p, old_str, new_str, skip_validation = false } = input
    const abs = assertPath(p)
    if (!existsSync(abs)) return { success: false, error: `Não encontrado: ${p}` }
  
    try {
      const original = readFileSync(abs, 'utf8')
      const core     = isCoreFile(abs)
  
      // Checkpoint automático antes da escrita — estado anterior restaurável
      const checkpoint = createCheckpointForFile(abs, {
        reason: core ? 'patch_file (CORE)' : 'patch_file',
        sessionId: input?.sessionId || null,
        action: 'patch',
        existed: true,
      })
      // Backup local sempre, com conteúdo já lido — sem double-read
      const localBackup = saveLocalBackup(abs, original)
      const snap        = await saveSnapshot(abs, {
        reason: core ? 'patch_file (CORE)' : 'patch_file',
      })
  
      // Valida unicidade do old_str
      const count = (original.match(new RegExp(escapeRegex(old_str), 'g')) ?? []).length
      if (count === 0) return { success: false, error: 'old_str não encontrado no arquivo' }
      if (count > 1)   return { success: false, error: `old_str aparece ${count}x — precisa ser único` }
  
      const patched = original.replace(old_str, new_str)
      writeFileSync(abs, patched, 'utf8')
  
      const syntaxErr = await checkJsSyntax(abs)
      if (syntaxErr) {
        writeFileSync(abs, original, 'utf8')
        return {
          success: false,
          path: relative(PROJECT_ROOT, abs),
          error: 'Sintaxe inválida após patch — rollback automático',
          syntax_error: syntaxErr,
          rolled_back: true,
          backup_id: localBackup.backupId,
          checkpoint_id: checkpoint.checkpointId,
        }
      }
  
      if (core && !skip_validation) {
        const exportCheck = checkCoreExports(abs)
        if (!exportCheck.passed) {
          writeFileSync(abs, original, 'utf8')
          return {
            success: false,
            path: relative(PROJECT_ROOT, abs),
            error: 'Export essencial removido — rollback automático',
            export_error: exportCheck.error,
            rolled_back: true,
            backup_id: localBackup.backupId,
            checkpoint_id: checkpoint.checkpointId,
            checkpoint_id: checkpoint.checkpointId,
          }
        }
      }

  
      return {
        success: true,
        path: relative(PROJECT_ROOT, abs),
        ...fileEvidence(abs, patched),
        core_file: core,
        backup_id: localBackup.backupId,
        checkpoint_id: checkpoint.checkpointId,
        snapshot_at: snap?.timestamp ?? null,
        ...mutationEvidence(abs, original, patched, checkpoint.checkpointId),
      }
    } catch (e) {
      return { success: false, error: e.message }
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  
  export async function patchFileMulti(input) {
    /**
     * @register_tool patch_file_multi
     * @description Aplica múltiplas substituições cirúrgicas em um único arquivo de forma atômica.
     * Todos os patches são validados e aplicados em memória antes de qualquer escrita.
     * Se qualquer patch falhar (old_str não único, sintaxe inválida, export removido),
     * nenhuma alteração é persistida — o arquivo permanece intacto.
     * @param {string} path - Caminho relativo ao workspace
     * @param {object[]} patches - Lista de patches: [{ old_str, new_str }, ...]
     * @param {boolean?} skip_validation - Pular validações extras de core file (padrão: false)
     */
    const { path: p, patches, skip_validation = false } = input
    const abs = assertPath(p)
    if (!existsSync(abs)) return { success: false, error: `Não encontrado: ${p}` }
    if (!Array.isArray(patches) || patches.length === 0) {
      return { success: false, error: 'patches deve ser um array não-vazio' }
    }
  
    try {
      const original = readFileSync(abs, 'utf8')
      const core     = isCoreFile(abs)
  
      // ── Fase 1: validação completa em memória (zero I/O até aqui) ────────────
      let working = original
      for (let idx = 0; idx < patches.length; idx++) {
        const { old_str, new_str } = patches[idx]
        if (typeof old_str !== 'string' || typeof new_str !== 'string') {
          return { success: false, error: `Patch #${idx}: old_str e new_str devem ser strings` }
        }
        const count = (working.match(new RegExp(escapeRegex(old_str), 'g')) ?? []).length
        if (count === 0) {
          return {
            success: false,
            error: `Patch #${idx}: old_str não encontrado (após aplicar patches anteriores)`,
            patch_index: idx,
            old_str_preview: old_str.slice(0, 120),
          }
        }
        if (count > 1) {
          return {
            success: false,
            error: `Patch #${idx}: old_str aparece ${count}x — precisa ser único`,
            patch_index: idx,
          }
        }
        working = working.replace(old_str, new_str)
      }
  
      // ── Fase 2: checkpoint + backup + escrita única ────────────────────────
      const checkpoint = createCheckpointForFile(abs, {
        reason: core ? `patch_file_multi x${patches.length} (CORE)` : `patch_file_multi x${patches.length}`,
        sessionId: input?.sessionId || null,
        action: 'patch_multi',
        existed: true,
      })
      const localBackup = saveLocalBackup(abs, original)
      const snap        = await saveSnapshot(abs, {
        reason: core ? `patch_file_multi x${patches.length} (CORE)` : `patch_file_multi x${patches.length}`,
      })
  
      writeFileSync(abs, working, 'utf8')
  
      // ── Fase 3: validações pós-escrita ───────────────────────────────────────
      const syntaxErr = await checkJsSyntax(abs)
      if (syntaxErr) {
        writeFileSync(abs, original, 'utf8')
        return {
          success: false,
          path: relative(PROJECT_ROOT, abs),
          error: 'Sintaxe inválida após patches — rollback automático',
          syntax_error: syntaxErr,
          rolled_back: true,
          backup_id: localBackup.backupId,
          checkpoint_id: checkpoint.checkpointId,
        }
      }
  
      if (core && !skip_validation) {
        const exportCheck = checkCoreExports(abs)
        if (!exportCheck.passed) {
          writeFileSync(abs, original, 'utf8')
          return {
            success: false,
            path: relative(PROJECT_ROOT, abs),
            error: 'Export essencial removido — rollback automático',
            export_error: exportCheck.error,
            rolled_back: true,
            backup_id: localBackup.backupId,
            checkpoint_id: checkpoint.checkpointId,
            checkpoint_id: checkpoint.checkpointId,
          }
        }
      }
  
      return {
        success: true,
        path: relative(PROJECT_ROOT, abs),
        patches_applied: patches.length,
        ...fileEvidence(abs, working),
        core_file: core,
        backup_id: localBackup.backupId,
        checkpoint_id: checkpoint.checkpointId,
        snapshot_at: snap?.timestamp ?? null,
        ...mutationEvidence(abs, original, working, checkpoint.checkpointId),
      }
    } catch (e) {
      return { success: false, error: e.message }
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  
  export async function diffPreview(input) {
    /**
     * @register_tool diff_preview
     * @description Mostra o diff unificado de um patch (ou lista de patches) sem aplicar nada.
     * Ideal para confirmar mudanças antes de editar arquivos core.
     * Retorna hunks, contagem de adições/remoções e o diff completo em formato unified.
     * @param {string} path - Caminho relativo ao workspace
     * @param {string?} old_str - Trecho a substituir (para preview de patch único)
     * @param {string?} new_str - Novo conteúdo (para preview de patch único)
     * @param {object[]?} patches - Lista de patches [{ old_str, new_str }] (para preview multi)
     */
    const { path: p, old_str, new_str, patches } = input
    const abs = assertPath(p)
    if (!existsSync(abs)) return { success: false, error: `Não encontrado: ${p}` }
  
    // Normaliza entrada: aceita patch único ou lista
    let patchList
    if (Array.isArray(patches) && patches.length > 0) {
      patchList = patches
    } else if (typeof old_str === 'string' && typeof new_str === 'string') {
      patchList = [{ old_str, new_str }]
    } else {
      return { success: false, error: 'Forneça old_str+new_str ou patches[]' }
    }
  
    try {
      const original = readFileSync(abs, 'utf8')
      const label    = relative(PROJECT_ROOT, abs)
  
      // Simula todos os patches em memória
      let working = original
      for (let idx = 0; idx < patchList.length; idx++) {
        const { old_str: os, new_str: ns } = patchList[idx]
        const count = (working.match(new RegExp(escapeRegex(os), 'g')) ?? []).length
        if (count === 0) {
          return {
            success: false,
            error: `Patch #${idx}: old_str não encontrado`,
            patch_index: idx,
          }
        }
        if (count > 1) {
          return {
            success: false,
            error: `Patch #${idx}: old_str aparece ${count}x — precisa ser único`,
            patch_index: idx,
          }
        }
        working = working.replace(os, ns)
      }
  
      const result = unifiedDiff(original, working, label)
  
      if (!result) {
        return {
          success: true,
          path: label,
          changed: false,
          message: 'Nenhuma diferença — old_str e new_str resultam no mesmo conteúdo',
        }
      }
  
      return {
        success: true,
        path: label,
        changed: true,
        patches_previewed: patchList.length,
        hunks: result.hunks,
        additions: result.additions,
        deletions: result.deletions,
        diff: result.diff,
      }
    } catch (e) {
      return { success: false, error: e.message }
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  
  export async function restoreBackup(input) {
    /**
     * @register_tool restore_backup
     * @description Restaura um backup local criado automaticamente por patch_file ou patch_file_multi.
     * @param {string} path - Caminho relativo do arquivo a restaurar
     * @param {string} backupId - ID do backup retornado pelo patch (timestamp numérico)
     */
    const { path: p, backupId } = input
    const abs = assertPath(p)
    try {
      const ok = restoreLocalBackup(backupId, abs)
      if (!ok) {
        return { success: false, error: `Backup ${backupId} não encontrado para ${basename(abs)}` }
      }
      return {
        success: true,
        path: relative(PROJECT_ROOT, abs),
        restored_backup: backupId,
      }
    } catch (e) {
      return { success: false, error: e.message }
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  
  export async function listDir(input) {
    /**
     * @register_tool list_dir
     * @description Lista a árvore de diretórios do workspace com metadados.
     * Usa Dirent para evitar dupla syscall por entrada (mais rápido que statSync em loop).
     * @param {string?} path - Caminho relativo ao workspace (padrão: raiz)
     * @param {number?} depth - Profundidade máxima (padrão: 3)
     * @param {string?} filter - Glob simples para filtrar arquivos, ex: "*.test.js" (padrão: todos)
     * @param {boolean?} sizes - Incluir tamanho em bytes dos arquivos (padrão: true)
     * @param {number?} offset - Offset da paginação (padrão: 0)
     * @param {number?} limit - Máximo de entradas; omitido preserva a listagem completa
     */
    const { path: p = '.', depth = 3, filter = null, sizes = true, offset = 0, limit = null } = input
  
    // Converte glob simples (*.ext ou prefixo*) para RegExp
    const filterRe = filter
      ? new RegExp('^' + filter.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$')
      : null
  
    function walk(dir, d, max) {
      if (d > max) return []
      const out = []
      try {
        // withFileTypes evita statSync por entrada — 1 syscall em vez de 2
        for (const dirent of readdirSync(dir, { withFileTypes: true })) {
          if (IGNORE_DIRS.includes(dirent.name)) continue
  
          const abs = join(dir, dirent.name)
          const rel = relative(PROJECT_ROOT, abs)
  
          if (dirent.isDirectory()) {
            out.push({ type: 'dir', path: rel, name: dirent.name })
            out.push(...walk(abs, d + 1, max))
          } else {
            if (filterRe && !filterRe.test(dirent.name)) continue
            const entry = { type: 'file', path: rel, name: dirent.name }
            if (sizes) {
              try { entry.bytes = statSync(abs).size } catch {}
            }
            out.push(entry)
          }
        }
      } catch {}
      return out
    }
  
    try {
      // listDir: leitura — pode receber path absoluto fora do projeto
      const abs     = p === '.' ? PROJECT_ROOT : resolvePath(p)
      const allEntries = walk(abs, 0, depth)
      const resultPage = page(allEntries, offset, limit)
      const isInternal = abs.startsWith(PROJECT_ROOT)
      return {
        success: true,
        root: isInternal ? (relative(PROJECT_ROOT, abs) || '.') : abs,
        absolute: abs,
        total: allEntries.length,
        entries: resultPage.items,
        coverage: resultPage.coverage,
        truncated: resultPage.truncated,
      }
    } catch (e) {
      return { success: false, error: e.message }
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  
  export async function runShell(input) {
    /**
     * @register_tool run_shell
     * @description Executa comando bash no workspace (shell = bash). Comandos
     * catastróficos são bloqueados; comandos perigosos exigem confirmação do
     * usuário — nesse caso retorna requiresConfirmation + structuredInput e você
     * deve pedir confirmação; ao confirmar, chame novamente com confirm:true.
     * @param {string} command - Comando bash a executar
     * @param {string?} cwd - Diretório de trabalho relativo ao workspace (padrão: raiz)
     * @param {number?} timeout - Timeout em ms (padrão 15000, máx 120000)
     * @param {boolean?} confirm - Confirma execução de comando classificado como perigoso
     */
    const { command, cwd = '.', timeout, confirm = false } = input
    if (!command || typeof command !== 'string') {
      return { success: false, error: '`command` é obrigatório' }
    }

    const { level, reason } = classifyShell(command)

    if (level === 'block') {
      return {
        success: false,
        blocked: true,
        command,
        error: `Comando bloqueado (${reason}). Esta ação é catastrófica/irreversível e não pode ser executada.`,
      }
    }

    if (level === 'confirm' && !confirm) {
      return {
        success: false,
        requiresConfirmation: true,
        command,
        reason,
        // Payload para o agente renderizar StructuredInput ao usuário.
        structuredInput: {
          type: 'confirm',
          destructive: true,
          question: `Comando potencialmente perigoso (${reason}):\n\n\`${command}\`\n\nExecutar mesmo assim?`,
          confirmLabel: 'Executar',
          cancelLabel: 'Cancelar',
        },
        hint: 'Peça confirmação ao usuário via StructuredInput. Se confirmado, chame run_shell de novo com o mesmo command e confirm:true.',
      }
    }

    const timeoutMs = Math.min(Math.max(parseInt(timeout, 10) || SHELL_TIMEOUT, 1000), MAX_SHELL_TIMEOUT)
    // cwd pode ser absoluto (ex: /tmp) ou relativo ao PROJECT_ROOT
    const safeCwd = cwd === '.' ? PROJECT_ROOT : resolvePath(cwd)
    const startedAt = Date.now()
    try {
      const { stdout, stderr } = await execAsync('bash', ['-c', command], {
        cwd: safeCwd,
        timeout: timeoutMs,
        maxBuffer: SHELL_MAX_BUFFER,
      })
      return {
        success: true,
        command,
        confirmed: level === 'confirm' ? true : undefined,
        stdout: stdout.trim(),
        stderr: stderr.trim() || null,
        status: 'passed',
        exitCode: 0,
        durationMs: Date.now() - startedAt,
        timedOut: false,
        truncated: false,
      }
    } catch (e) {
      const truncated = /maxBuffer/.test(e.message || '')
      const timedOut = e.killed === true || e.code === 'ETIMEDOUT' || /timed out/i.test(e.message || '')
      return {
        success: false,
        command,
        error: truncated
          ? `Saída excedeu o limite de ${SHELL_MAX_BUFFER} bytes. Refine o comando (ex: head/tail/grep).`
          : e.message,
        stdout: e.stdout?.trim() ?? null,
        stderr: e.stderr?.trim() ?? null,
        status: timedOut ? 'timed_out' : 'failed',
        exitCode: Number.isInteger(e.code) ? e.code : null,
        durationMs: Date.now() - startedAt,
        timedOut,
        truncated,
      }
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  
  export async function searchCode(input) {
    /**
     * @register_tool search_code
     * @description Grep recursivo no workspace. Sem shell intermediário — args passados direto ao grep.
     * @param {string} query - Texto a buscar (máx. 500 chars)
     * @param {string?} path - Diretório a buscar (padrão: workspace inteiro)
     * @param {string?} file_pattern - Padrão de arquivos separado por vírgula (padrão: *.js,*.ts,*.md,*.json)
     * @param {number?} offset - Offset da paginação (padrão: 0)
     * @param {number?} max_results - Máximo de resultados; omitido preserva todos
     */
    const { query, path: p = '.', file_pattern = '*.js,*.ts,*.md,*.json', offset = 0, max_results = null } = input
  
    if (!query || query.length > MAX_QUERY_LENGTH) {
      return {
        success: false,
        error: `query deve ter entre 1 e ${MAX_QUERY_LENGTH} caracteres`,
      }
    }
  
    // searchCode: leitura — pode receber path absoluto fora do projeto
    const abs = p === '.' ? PROJECT_ROOT : resolvePath(p)
    const includes = file_pattern
      .split(',')
      .map(x => ['--include', x.trim()])
      .flat()
  
    try {
      // Sem shell intermediário: query vai como arg, sem risco de injeção
      const { stdout } = await execAsync(
        'grep',
        ['-rn', '--color=never', '-i', query, '.', ...includes],
        { cwd: abs, timeout: 8000, maxBuffer: 1024 * 256 },
      )
  
      const matches = stdout.trim().split('\n').filter(Boolean).map(line => {
        const c1 = line.indexOf(':')
        const c2 = line.indexOf(':', c1 + 1)
        return {
          file:  relative(PROJECT_ROOT, resolve(abs, line.slice(0, c1))),
          line:  parseInt(line.slice(c1 + 1, c2), 10),
          match: line.slice(c2 + 1).trim(),
        }
      })
  
      const resultPage = page(matches, offset, max_results)
      return { success: true, query, count: matches.length, matches: resultPage.items, coverage: resultPage.coverage, truncated: resultPage.truncated }
    } catch (e) {
      // grep exit code 1 = zero matches, não é erro
      if (e.code === 1) return { success: true, query, count: 0, matches: [] }
      return { success: false, error: e.message }
    }
  }

  export async function workspaceBaseline(input = {}) {
    /**
     * @register_tool workspace_baseline
     * @description Captura estado Git e mudanças preexistentes sem modificar o workspace.
     * @param {string?} path - Workspace relativo ou absoluto (padrão: raiz do projeto)
     */
    const root = input.path ? resolvePath(input.path) : PROJECT_ROOT
    return { success: true, ...(await captureWorkspaceBaseline(root)) }
  }

  export async function resolveValidation(input = {}) {
    /**
     * @register_tool resolve_validation
     * @description Resolve comandos de validação declarados para o pacote afetado, sem executá-los.
     * @param {string?} path - Arquivo ou diretório afetado (padrão: raiz do projeto)
     */
    const target = input.path ? resolvePath(input.path) : PROJECT_ROOT
    return { success: true, ...resolveValidationCommands(PROJECT_ROOT, target) }
  }

  export async function isolateWorkspace(input = {}) {
    /**
     * @register_tool isolate_workspace
     * @description Cria worktree Git opt-in e retido para uma tarefa. Nunca remove ou reconcilia automaticamente.
     * @param {string?} path - Raiz Git de origem (padrão: projeto)
     * @param {string?} task_id - Identificador da tarefa
     * @param {string?} revision - Revisão base (padrão: HEAD)
     * @param {string?} destination - Destino fora do repositório; omitido usa diretório temporário
     */
    const root = input.path ? resolvePath(input.path) : PROJECT_ROOT
    return prepareWorktree(root, { taskId: input.task_id, revision: input.revision, destination: input.destination })
  }

  export async function inspectIsolatedWorkspace(input = {}) {
    /**
     * @register_tool inspect_isolated_workspace
     * @description Inspeciona mudanças e gera diff de um worktree isolado sem aplicar nem limpar nada.
     * @param {string} path - Raiz do worktree criado por isolate_workspace
     * @param {string} source_path - Raiz Git de origem
     */
    return { success: true, ...(await inspectWorktree({ strategy: 'worktree', root: input.path, sourceRoot: input.source_path })) }
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  
  function toCamel(s) {
    return s.replace(/[-_]([a-z])/g, (_, c) => c.toUpperCase())
  }

  // O watcher do Lógos é o caminho normal. Esta chamada é a garantia contra
  // eventos de filesystem perdidos: é idempotente quando o pacote já entrou
  // em serviço e não reinicia o runtime.
  async function activateCreatedPackage(name) {
    try {
      const { getDefaultContainer } = await import('logos')
      const activate = getDefaultContainer().state('runtime').get('activatePackage')
      if (typeof activate !== 'function') return { attempted: false, reason: 'activation_unavailable' }
      const result = await activate(name, 'creator')
      return { attempted: true, ...result }
    } catch (error) {
      // A criação continua válida fora de um runtime Lógos, por exemplo nos
      // testes e em operações offline. O watcher recuperará no próximo boot.
      return { attempted: false, reason: error.message }
    }
  }
  
  export async function createRuntimePackage(input) {
    /**
     * @register_tool create_runtime_package
     * @description Cria um novo package em packages/<name>/ com estrutura padrão.
     * @param {string} name - Nome do package (lowercase, sem espaços)
     * @param {string?} description - Descrição do package
     * @param {object[]?} tools - Ferramentas a gerar
     * @param {object[]?} routes - Rotas HTTP a gerar
     * @param {object[]?} hooks - Hooks de evento a gerar
     */
    const { name, description = '', tools = [], routes = [], hooks = [] } = input
    if (!name) return { success: false, error: 'name é obrigatório' }
    if (!/^[a-z0-9-_]+$/.test(name)) {
      return { success: false, error: 'name deve ser lowercase sem espaços' }
    }
  
    const pkgDir = join(PACKAGES_DIR, name)
    if (existsSync(pkgDir)) {
      return { success: false, error: `Package já existe: packages/${name}/` }
    }
  
    mkdirSync(pkgDir, { recursive: true })

    const lines = [
      `// ${name} — johankit runtime package`,
      `// Gerado por Aurora — ${new Date().toISOString()}`,
      '',
      `export function onBoot(payload) {`,
      `  /**`,
      `   * @register_hook boot`,
      `   */`,
      `  console.log('[${name}] Package carregado.')`,
      `}`,
      '',
    ]
  
    for (const tool of tools) {
      const params = (tool.params ?? [])
        .map(rp => `   * @param {${rp.type}${rp.optional ? '?' : ''}} ${rp.name} - ${rp.description ?? rp.name}`)
        .join('\n')
      lines.push(
        `export async function ${toCamel(tool.name)}(input, context) {`,
        `  /**`,
        `   * @register_tool ${tool.name}`,
        `   * @description ${tool.description}`,
        ...(params ? [params] : []),
        `   */`,
        `  ${(tool.code ?? `throw new Error('Not implemented: ${tool.name}')`).replace(/\n/g, '\n  ')}`,
        `}`,
        '',
      )
    }
  
    for (const route of routes) {
      const fn = toCamel(`${route.method.toLowerCase()}_${route.path.replace(/[^a-zA-Z0-9]/g, '_')}`)
      lines.push(
        `export async function ${fn}(req, res, next, context) {`,
        `  /**`,
        `   * @register_router ${route.path}`,
        `   * @method ${route.method}`,
        ...(route.description ? [`   * @description ${route.description}`] : []),
        `   */`,
        `  ${(route.code ?? `return { status: 200, data: { ok: true } }`).replace(/\n/g, '\n  ')}`,
        `}`,
        '',
      )
    }
  
    for (const hook of hooks) {
      const fn = toCamel(`on_${hook.event.replace(/[^a-zA-Z0-9]/g, '_')}`)
      lines.push(
        `export function ${fn}(payload, context) {`,
        `  /**`,
        `   * @register_hook ${hook.event}`,
        `   */`,
        `  ${(hook.code ?? `// handle ${hook.event}`).replace(/\n/g, '\n  ')}`,
        `}`,
        '',
      )
    }
  
    writeFileSync(join(pkgDir, 'index.js'), lines.join('\n'), 'utf8')

    // O package.json é escrito POR ÚLTIMO de propósito: é ele que o stabilizer
    // usa como sinal de "isto é um pacote, pode ligar". Escrevendo o manifesto
    // primeiro, o runtime podia entrar no ar com a pasta ainda pela metade e
    // servir um pacote sem rotas até a próxima edição.
    writeFileSync(
      join(pkgDir, 'package.json'),
      JSON.stringify({ name, version: '1.0.0', description, type: 'module' }, null, 2),
      'utf8',
    )

    const activation = await activateCreatedPackage(name)

    return {
      success: true,
      package: name,
      path: `packages/${name}/`,
      files: ['index.js', 'package.json'],
      // O stabilizer detecta a pasta nova, instala dependências se houver e faz
      // a wiring sozinho — sem restart. Leva ~1s.
      wiring: 'automatic',
      activation,
      tools: tools.map(t => t.name),
      routes: routes.map(r => `[${r.method}] ${r.path}`),
    }
  }
