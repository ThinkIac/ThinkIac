#!/usr/bin/env node
// permission_hook.mjs — Hook PreToolUse do binário `claude` para o provider
// "claude-cli" em modo interativo (pool.cli.permissions === 'interactive').
//
// O `claude` chama este script ANTES de cada ferramenta, passando o payload
// (tool_name, tool_input, tool_use_id…) via stdin. Aqui decidimos, conforme a
// POLÍTICA de permissão, se a ferramenta:
//   - roda direto (auto-aprovada), ou
//   - pausa e vira um card de aprovação no Chat (ponte pro processo principal
//     do Agent — routes/permission.js — que espera o usuário decidir).
// A decisão volta como o formato de saída que o Claude Code entende:
//   { "hookSpecificOutput": { "hookEventName":"PreToolUse",
//                             "permissionDecision":"allow"|"deny",
//                             "permissionDecisionReason":"..." } }
//
// ── Política (AGENT_PERMISSION_MODE) ────────────────────────────────────────
//   'auto'        (default) — AUTO-APROVA tudo, EXCETO comandos de risco, que
//                             vão ao Chat pedir aprovação estruturada. É o
//                             "auto-mode com structured só no risco".
//   'interactive' — pergunta no Chat para TODA ferramenta (menos a allowlist).
//                   Comportamento legado (matcher '*' pausando tudo).
//   'allow'/'off' — libera tudo sem perguntar nada (sem gate).
//
// Env injetadas pelo provider (ver llm/llm_keys.js buildArgs / llm.js runCliSlot):
//   AGENT_BASE_URL              base HTTP do Agent (default http://localhost:5040)
//   AGENT_SESSION_ID            sessão de Chat que originou o turno (correlação)
//   AGENT_PERMISSION_MODE       'auto'|'interactive'|'allow' (default 'auto')
//   AGENT_PERMISSION_AUTO_ALLOW lista de tools SEMPRE auto-aprovadas (CSV, por nome)
//   AGENT_PERMISSION_RISKY_PATTERNS  regex/substrings extras de risco (CSV) —
//                                somam-se aos padrões default (não substituem)
//   AGENT_PERMISSION_FALLBACK   'allow'|'deny' se a ponte falhar (default 'allow')
//   AGENT_PERMISSION_TIMEOUT_MS teto de espera pela decisão (repassado ao /ask)

import { readFileSync } from 'node:fs'

function decide(permissionDecision, reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision,
      permissionDecisionReason: reason,
    },
  }))
  process.exit(0)
}

// ── Classificação de risco ───────────────────────────────────────────────────
// Padrões default de COMANDO de risco (aplicados ao texto do comando de tools
// de shell — Bash/Shell/Execute). Conservador: cobre destruição de arquivos,
// escalação de privilégio, pipe rede→shell, controle de sistema e operações
// destrutivas de VCS/containers. Ajuste via AGENT_PERMISSION_RISKY_PATTERNS.
const DEFAULT_RISKY_CMD = [
  // destruição de arquivos / disco — QUALQUER rm com argumento (apagar/deletar),
  // não só rm -rf; find -delete / find -exec rm; rmdir/shred/unlink; formatação.
  /\brm\s+\S/i, /\bfind\b[^\n]*\s-delete\b/i, /\bfind\b[^\n]*-exec\s+rm\b/i,
  /\brmdir\b/i, /\bshred\b/i, /\bunlink\b/i,
  /\bmkfs\b/i, /\bdd\s+if=/i, /\btruncate\s+-s\s*0/i, />\s*\/dev\/[sh]d/i,
  // escalação de privilégio / permissões amplas
  /\bsudo\b/i, /\bdoas\b/i, /\bchmod\s+(-R|.*777)/i, /\bchown\s+-R/i,
  // rede → shell (curl|sh, wget|bash)
  /\b(curl|wget|fetch)\b[^\n|]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/i,
  // controle de sistema
  /\b(shutdown|reboot|halt|poweroff|init\s+0|init\s+6)\b/i,
  /\bsystemctl\s+(stop|disable|mask)\b/i, /\bkill(all)?\b/i, /\bpkill\b/i,
  // VCS destrutivo
  /\bgit\s+push\b[^\n]*\s(--force|-f)\b/i, /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[a-z]*f/i,
  // containers / pacotes destrutivos ou publicação
  /\bdocker\s+(rm|rmi|kill|system\s+prune|volume\s+rm)\b/i,
  /\bnpm\s+(un)?publish\b/i,
  // fork bomb clássico
  /:\(\)\s*\{\s*:\|:&\s*\}\s*;/,
]

// Escritas em caminhos sensíveis também pedem aprovação, mesmo com auto-mode.
const DEFAULT_SENSITIVE_PATH =
  /(^|\/)(\.env(\.|$)|\.ssh\/|id_[rd]sa|\.pem$|credentials|\.credentials|secrets?\.|agent\.config\.json|\/etc\/)/i

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'FileWrite'])
const SHELL_TOOLS = new Set(['Bash', 'Shell', 'Execute', 'Terminal', 'run_command'])

function compileExtra(csv) {
  return (csv || '').split(',').map(s => s.trim()).filter(Boolean).map(s => {
    // Trata cada item como regex se começar/terminar com '/', senão substring literal.
    try {
      if (s.length > 2 && s.startsWith('/') && s.endsWith('/')) return new RegExp(s.slice(1, -1), 'i')
      return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    } catch { return null }
  }).filter(Boolean)
}

/** Devolve um motivo (string) se a ferramenta for de risco, ou null se segura. */
function assessRisk(toolName, toolInput, extraPatterns) {
  const riskyCmd = [...DEFAULT_RISKY_CMD, ...extraPatterns]

  // Ferramentas de shell: inspeciona o comando.
  if (SHELL_TOOLS.has(toolName)) {
    const cmd = String(toolInput?.command ?? toolInput?.cmd ?? toolInput?.script ?? '')
    const hit = riskyCmd.find(re => re.test(cmd))
    if (hit) return `Comando de risco (${hit.source ?? hit}).`
    return null
  }

  // Escritas/edições em caminhos sensíveis.
  if (WRITE_TOOLS.has(toolName)) {
    const path = String(toolInput?.file_path ?? toolInput?.path ?? toolInput?.notebook_path ?? '')
    if (path && DEFAULT_SENSITIVE_PATH.test(path)) return `Escrita em caminho sensível (${path}).`
    return null
  }

  // Qualquer padrão extra pode também bater no JSON serializado do input
  // (ex.: usuário quer marcar por conteúdo). Só checa os EXTRAS, não os default,
  // pra não gerar falso-positivo em tools de leitura.
  if (extraPatterns.length) {
    let blob = ''
    try { blob = JSON.stringify(toolInput ?? {}) } catch {}
    const hit = extraPatterns.find(re => re.test(blob))
    if (hit) return `Padrão de risco configurado (${hit.source}).`
  }

  return null
}

async function askUser({ baseUrl, sessionId, toolName, toolInput, toolUseId, timeoutMs, fallback, reasonHint }) {
  try {
    const res = await fetch(`${baseUrl}/agent/permission/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        tool_name: toolName,
        tool_input: toolInput,
        tool_use_id: toolUseId,
        timeout_ms: timeoutMs,
        risk_reason: reasonHint ?? null,
      }),
    })
    if (!res.ok) {
      decide(fallback, `Ponte de permissão respondeu HTTP ${res.status}; fallback "${fallback}".`)
    }
    const body = await res.json()
    const decision = body.decision === 'deny' ? 'deny' : (body.decision === 'allow' ? 'allow' : fallback)
    const reason = body.reason || (decision === 'allow' ? 'Aprovado pelo usuário.' : 'Negado pelo usuário.')
    decide(decision, reason)
  } catch (e) {
    process.stderr.write(`[permission_hook] falha na ponte: ${e.message}\n`)
    decide(fallback, `Ponte de permissão inacessível; fallback "${fallback}".`)
  }
}

async function main() {
  let payload = {}
  try {
    const raw = readFileSync(0, 'utf8')
    payload = raw ? JSON.parse(raw) : {}
  } catch {
    // Sem payload legível — não dá pra decidir com contexto; segue o fallback.
  }

  const toolName = payload.tool_name || payload.toolName || 'unknown'
  const toolInput = payload.tool_input || payload.toolInput || {}
  const toolUseId = payload.tool_use_id || payload.toolUseId || null

  const baseUrl   = process.env.AGENT_BASE_URL || 'http://localhost:5040'
  const sessionId = process.env.AGENT_SESSION_ID || null
  const fallback  = (process.env.AGENT_PERMISSION_FALLBACK || 'allow').toLowerCase() === 'deny' ? 'deny' : 'allow'
  const mode      = (process.env.AGENT_PERMISSION_MODE || 'auto').toLowerCase()

  // Allowlist por nome: ferramentas sempre seguras, nunca vão ao Chat.
  const autoAllow = (process.env.AGENT_PERMISSION_AUTO_ALLOW || '')
    .split(',').map(s => s.trim()).filter(Boolean)
  if (autoAllow.includes(toolName)) {
    decide('allow', `Auto-aprovado (allowlist: ${toolName}).`)
  }

  // Modo "libera tudo" — sem gate nenhum.
  if (mode === 'allow' || mode === 'off') {
    decide('allow', 'Auto-mode: liberado sem gate (AGENT_PERMISSION_MODE=allow).')
  }

  const timeoutMs = process.env.AGENT_PERMISSION_TIMEOUT_MS
    ? Number(process.env.AGENT_PERMISSION_TIMEOUT_MS) : undefined

  // Modo 'auto' (default): só escala pro Chat quando é comando de risco.
  if (mode === 'auto') {
    const extra = compileExtra(process.env.AGENT_PERMISSION_RISKY_PATTERNS)
    const riskReason = assessRisk(toolName, toolInput, extra)
    if (!riskReason) {
      decide('allow', `Auto-aprovado (não é comando de risco: ${toolName}).`)
    }
    // É de risco: falha FECHADO (deny) quando não dá pra pedir aprovação humana
    // — sem sessão ou com a ponte fora do ar. "Structured para risco" só faz
    // sentido se o risco não roda sozinho às cegas. Override: AGENT_PERMISSION_RISK_FALLBACK.
    const riskFallback = (process.env.AGENT_PERMISSION_RISK_FALLBACK || 'deny').toLowerCase() === 'allow' ? 'allow' : 'deny'
    if (!sessionId) {
      decide(riskFallback, `Risco detectado mas sem AGENT_SESSION_ID; fallback "${riskFallback}". (${riskReason})`)
    }
    await askUser({ baseUrl, sessionId, toolName, toolInput, toolUseId, timeoutMs, fallback: riskFallback, reasonHint: riskReason })
    return
  }

  // Modo 'interactive' (legado): pergunta pra tudo.
  if (!sessionId) {
    decide(fallback, `Sem AGENT_SESSION_ID; aplicando fallback "${fallback}".`)
  }
  await askUser({ baseUrl, sessionId, toolName, toolInput, toolUseId, timeoutMs, fallback, reasonHint: null })
}

main()
