/**
 * Testes unitários para cli_sessions — persistência da sessão Claude Code
 * nativa por sessão de chat. Cobre:
 *  - ensureCliSession cria (isNew) na 1ª vez e retoma (resume) depois
 *  - reset esquece o UUID → próximo ensure recomeça (isNew)
 *  - persistência sobrevive a "restart" (novo import do store do disco)
 *  - cwd determinístico por sessão, criado em disco
 *  - withCliSessionLock serializa operações concorrentes da mesma sessão
 *
 * Isola o store via env (AGENT_CLI_SESSIONS_FILE / AGENT_CLI_WORKSPACE_ROOT)
 * num tmpdir, pra não tocar o store real. Roda com: node llm/cli_sessions.test.js
 */

import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TMP = mkdtempSync(join(tmpdir(), 'cli-sess-'))
process.env.AGENT_CLI_SESSIONS_FILE = join(TMP, 'store.json')
process.env.AGENT_CLI_WORKSPACE_ROOT = join(TMP, 'workspaces')

const {
  ensureCliSession, touchCliSession, resetCliSession, peekCliSession, withCliSessionLock,
} = await import('./cli_sessions.js')

let passed = 0, failed = 0
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`) }
  else { failed++; console.error(`  ❌ ${msg}`) }
}

const P = 'claude-cli'


const a = ensureCliSession(P, 'sess-1')
assert(a.isNew === true, 'ensureCliSession: 1ª vez isNew=true')
assert(typeof a.uuid === 'string' && a.uuid.length >= 32, 'ensureCliSession: gera UUID')
const b = ensureCliSession(P, 'sess-1')
assert(b.isNew === false, 'ensureCliSession: 2ª vez isNew=false (resume)')
assert(b.uuid === a.uuid, 'ensureCliSession: mesmo UUID no resume')


assert(a.cwd === b.cwd, 'cwd estável entre turnos da mesma sessão')
assert(existsSync(a.cwd), 'workspace criado em disco')


const c = ensureCliSession(P, 'sess-2')
assert(c.uuid !== a.uuid, 'sessão diferente → UUID diferente')
assert(c.cwd !== a.cwd, 'sessão diferente → cwd diferente')


touchCliSession(P, 'sess-1')
touchCliSession(P, 'sess-1')
assert(peekCliSession(P, 'sess-1')?.turns === 2, 'touchCliSession conta turnos')
assert(peekCliSession(P, 'sess-1')?.uuid === a.uuid, 'touchCliSession preserva UUID')


assert(resetCliSession(P, 'sess-1') === true, 'reset retorna true quando havia sessão')
assert(peekCliSession(P, 'sess-1') === null, 'reset remove o registro')
const d = ensureCliSession(P, 'sess-1')
assert(d.isNew === true, 'após reset, ensure recomeça (isNew=true)')
assert(d.uuid !== a.uuid, 'após reset, UUID é novo')
assert(resetCliSession(P, 'inexistente') === false, 'reset retorna false quando não havia sessão')


{
  ensureCliSession(P, 'sess-3')
  const rec = peekCliSession(P, 'sess-3')
  const uuidAntigo = rec.uuid
  rec.cwd = '/caminho/antigo/que/nao/existe/mais' 
  const reaberta = ensureCliSession(P, 'sess-3')
  assert(reaberta.isNew === true, 'cwd divergente → recomeça sessão (isNew=true)')
  assert(reaberta.uuid !== uuidAntigo, 'cwd divergente → UUID novo')
  assert(reaberta.cwd.startsWith(process.env.AGENT_CLI_WORKSPACE_ROOT), 'cwd novo sob o WORKSPACE_ROOT atual')
}


const fresh = await import('./cli_sessions.js?fresh=' + Date.now())
const e = fresh.peekCliSession(P, 'sess-2')
assert(e?.uuid === c.uuid, 'store persistido é relido após restart')


let active = 0, maxConcurrent = 0, order = []
function work(tag) {
  return withCliSessionLock(P, 'lock-1', async () => {
    active++; maxConcurrent = Math.max(maxConcurrent, active)
    await new Promise(r => setTimeout(r, 15))
    order.push(tag); active--
    return tag
  })
}
const results = await Promise.all([work('a'), work('b'), work('c')])
assert(maxConcurrent === 1, 'lock serializa: nunca 2 operações simultâneas na mesma sessão')
assert(order.join('') === 'abc', 'lock preserva ordem FIFO')
assert(results.join('') === 'abc', 'lock devolve o valor de cada operação')


let ranAfterError = false
const failing = withCliSessionLock(P, 'lock-2', async () => { throw new Error('boom') })
const afterErr = withCliSessionLock(P, 'lock-2', async () => { ranAfterError = true; return 'ok' })
await failing.catch(() => {})
await afterErr
assert(ranAfterError === true, 'lock não trava a fila após um erro')


try { rmSync(TMP, { recursive: true, force: true }) } catch {}

console.log(`\n${failed === 0 ? '✅' : '❌'} cli_sessions: ${passed} passaram, ${failed} falharam`)
process.exit(failed === 0 ? 0 : 1)
