import { getMetacore } from './metacore.js'
import { getMicroManager, microExecuteAll } from './micro.js'
import { existsSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = __filename.substring(0, __filename.lastIndexOf('/'))
const BAG_PATH = __dirname + '/../data/metacore-bag.json'

let pass = 0
let fail = 0
function assert(condition, label) {
  if (condition) { pass++; console.log('  ✅ ' + label) }
  else { fail++; console.log('  ❌ ' + label) }
}

console.log('\n=== 6a: Teste de integração dos 3 níveis ===\n')

// ─── 1. MICROMANAGER ───
console.log('── N1 — MicroManager ──')
const mm = getMicroManager()

const results = await mm.executeAll([
  { toolName: 'echo', args: { text: 'a' }, options: { sessionId: 'test-rec' } },
  { toolName: 'echo', args: { text: 'b' }, options: { sessionId: 'test-rec' } },
])
assert(results.length === 2, 'executeAll retorna 2 resultados')
assert(results[0].success !== undefined, 'cada resultado tem .success')
assert(typeof results[0].duration === 'number', 'cada resultado tem .duration')

const fastResults = await microExecuteAll([
  { toolName: 'echo', args: { text: 'c' }, options: { sessionId: 'test-rec' } },
])
assert(fastResults.length === 1, 'microExecuteAll funciona')

// ─── 2. METACORE ───
console.log('\n── N3 — Metacore ──')
const mc = getMetacore()
assert(typeof mc.observe === 'function', 'metacore.observe é função')
assert(typeof mc.checkPatterns === 'function', 'metacore.checkPatterns é função')
assert(typeof mc.getCommand === 'function', 'metacore.getCommand é função')
assert(typeof mc.getHints === 'function', 'metacore.getHints é função')
assert(typeof mc.learnTemplate === 'function', 'metacore.learnTemplate é função')

await mc.observe({
  sessionId: 'test-rec', iteration: 1,
  toolCalls: [{ name: 'echo', input: { text: 'test' } }],
  errors: [], duration: 10, madeProgress: true, approximationLevel: 'default',
})
assert(true, 'observe executou sem erro')

mc.checkPatterns('test-rec')
const cmd = mc.getCommand('test-rec')
assert(cmd === null, 'checkPatterns com 1 observe não retorna comando')

await mc.learnTemplate({
  sessionId: 'test-rec', objective: 'Teste de integração',
  toolsUsed: ['echo'], template: 'echo é uma tool simples',
})
assert(true, 'learnTemplate executou sem erro')

const hints = await mc.getHints('test-rec', 'teste', [])
assert(hints === null || typeof hints === 'string', 'getHints retorna null ou string')

// ─── 3. N2 (agent.js) ───
console.log('\n── N2 — Executor (agent.js) ──')
let agentExports
try {
  agentExports = await import('./agent.js')
  assert(typeof agentExports.runAgent === 'function', 'agent.js exporta runAgent')
  assert(typeof agentExports.boot === 'function', 'agent.js exporta boot')
} catch (e) {
  assert(false, 'agent.js carregou sem erro: ' + e.message)
}

// ─── 4a. LOOP: mesma tool + mesmo input 3x ───
console.log('\n── 4a. Padrão LOOP (mesma tool + mesmo input 3x) ──')
const loopSid = 'test-rec-loop'
for (let i = 0; i < 3; i++) {
  await mc.observe({
    sessionId: loopSid, iteration: i + 1,
    toolCalls: [{ name: 'fetchTool', input: { url: 'http://ex.com' } }],
    errors: [], duration: 5000, madeProgress: false, approximationLevel: 'default',
  })
}
mc.checkPatterns(loopSid)
const loopCmd = mc.getCommand(loopSid)
assert(loopCmd !== null, 'loop detectado com 3x mesma tool+input')
if (loopCmd) {
  assert(loopCmd.action === 'reorient', 'ação é reorient')
  console.log('     action: ' + loopCmd.action + ' | reason: ' + loopCmd.reason)
}

// ─── 4b. FALHAS CONSECUTIVAS: 3 erros seguidos ───
console.log('\n── 4b. Padrão FALHAS (3 erros consecutivos) ──')
const failSid = 'test-rec-fails'
for (let i = 0; i < 3; i++) {
  await mc.observe({
    sessionId: failSid, iteration: i + 1,
    toolCalls: [{ name: 'list_dir', input: { path: '/nonexistent' } }],
    errors: [{ name: 'list_dir', error: 'ENOENT' }],
    duration: 100, madeProgress: false, approximationLevel: 'default',
  })
}
mc.checkPatterns(failSid)
const failCmd = mc.getCommand(failSid)
assert(failCmd !== null, 'falhas consecutivas detectadas')
if (failCmd) {
  assert(failCmd.action === 'reorient', 'ação é reorient (não pause)')
  console.log('     action: ' + failCmd.action + ' | reason: ' + failCmd.reason)
}

// ─── 4c. ESTAGNAÇÃO: 5 iterações sem progresso ───
console.log('\n── 4c. Padrão ESTAGNAÇÃO (5 sem progresso) ──')
const stgSid = 'test-rec-stag'
for (let i = 0; i < 5; i++) {
  await mc.observe({
    sessionId: stgSid, iteration: i + 1,
    toolCalls: [{ name: 'read_file', input: { path: '/tmp/x.txt' } }],
    errors: [], duration: 10, madeProgress: false, approximationLevel: 'default',
  })
}
mc.checkPatterns(stgSid)
const stgCmd = mc.getCommand(stgSid)
assert(stgCmd !== null, 'estagnação detectada (5 iterações sem progresso)')
if (stgCmd) {
  assert(stgCmd.action === 'pause', 'ação é pause (não reorient)')
  console.log('     action: ' + stgCmd.action + ' | reason: ' + stgCmd.reason)
}

// ─── 5. BAG global intacta ───
console.log('\n── Integridade ──')
if (existsSync(BAG_PATH)) {
  try {
    JSON.parse(readFileSync(BAG_PATH, 'utf-8'))
    assert(true, 'metacore-bag.json continua JSON válido')
  } catch(e) {
    assert(false, 'metacore-bag.json corrompido: ' + e.message)
  }
}

console.log('\n━━━ Resultado: ' + pass + ' passaram, ' + fail + ' falharam ━━━\n')
process.exit(fail > 0 ? 1 : 0)
