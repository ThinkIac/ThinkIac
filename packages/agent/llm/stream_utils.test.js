/**
 * Testes unitários para stream_utils — o helper universal de liveness dos
 * providers. Cobre o contrato "nunca bloqueia para sempre":
 *  - leitura normal resolve com { done, value }
 *  - upstream estagnado → rejeita com StreamIdleTimeoutError dentro da janela
 *  - abort do turno → rejeita com AbortError imediatamente
 *  - signal já abortado antes da leitura → rejeita na hora
 */

import { readWithIdleTimeout, isStreamIdleTimeout, createThinkTagFilter } from './stream_utils.js'

let passed = 0
let failed = 0

function assert(condition, message) {
  if (condition) { passed++; console.log(`  ✅ ${message}`) }
  else { failed++; console.error(`  ❌ ${message}`) }
}



function fakeReader(chunks, { delayMs = 0, stallForever = false } = {}) {
  let i = 0
  return {
    cancelled: false,
    async read() {
      if (stallForever) return new Promise(() => {}) 
      await new Promise(r => setTimeout(r, delayMs))
      if (i >= chunks.length) return { done: true, value: undefined }
      return { done: false, value: chunks[i++] }
    },
    async cancel() { this.cancelled = true },
  }
}

async function testNormalRead() {
  console.log('\n▶ leitura normal')
  const reader = fakeReader(['a', 'b'], { delayMs: 5 })
  const r1 = await readWithIdleTimeout(reader, 1000)
  assert(r1.done === false && r1.value === 'a', 'primeiro chunk retornado')
  const r2 = await readWithIdleTimeout(reader, 1000)
  assert(r2.value === 'b', 'segundo chunk retornado')
  const r3 = await readWithIdleTimeout(reader, 1000)
  assert(r3.done === true, 'done ao esgotar')
}

async function testIdleTimeout() {
  console.log('\n▶ upstream estagnado → idle timeout')
  const reader = fakeReader([], { stallForever: true })
  const t0 = Date.now()
  let err = null
  try { await readWithIdleTimeout(reader, 60) } catch (e) { err = e }
  const dt = Date.now() - t0
  assert(err != null, 'rejeitou em vez de pendurar para sempre')
  assert(isStreamIdleTimeout(err), 'erro é StreamIdleTimeoutError')
  assert(dt >= 50 && dt < 500, `rejeitou perto da janela (${dt}ms)`)
}

async function testAbortDuringRead() {
  console.log('\n▶ abort do turno durante leitura')
  const reader = fakeReader([], { stallForever: true })
  const ac = new AbortController()
  setTimeout(() => ac.abort(), 30)
  let err = null
  try { await readWithIdleTimeout(reader, 5000, ac.signal) } catch (e) { err = e }
  assert(err != null && err.name === 'AbortError', 'rejeitou com AbortError ao abortar')
  assert(!isStreamIdleTimeout(err), 'abort não é confundido com idle timeout')
}

async function testAlreadyAborted() {
  console.log('\n▶ signal já abortado antes da leitura')
  const reader = fakeReader(['x'], { delayMs: 5 })
  const ac = new AbortController()
  ac.abort()
  let err = null
  try { await readWithIdleTimeout(reader, 5000, ac.signal) } catch (e) { err = e }
  assert(err != null && err.name === 'AbortError', 'rejeita na hora se já abortado')
}

async function testThoughtTagsAreHidden() {
  console.log('\n▶ tags de raciocínio alternativas')
  let text = ''
  let reasoning = ''
  const filter = createThinkTagFilter((value) => { text += value }, (value) => { reasoning += value })
  filter.push('<tho')
  filter.push('ught>plano</thought>Olá')
  filter.end()
  assert(text === 'Olá', 'conteúdo <thought> não aparece na resposta')
  assert(reasoning === 'plano', 'conteúdo <thought> vai para raciocínio')
}

async function runAll() {
  console.log('🧪 stream_utils — Testes Unitários')
  console.log('='.repeat(50))
  await testNormalRead()
  await testIdleTimeout()
  await testAbortDuringRead()
  await testAlreadyAborted()
  await testThoughtTagsAreHidden()
  console.log('\n' + '='.repeat(50))
  console.log(`📊 Resultado: ${passed} passed, ${failed} failed, ${passed + failed} total`)
  if (failed > 0) { console.error(`\n❌ ${failed} teste(s) falharam!`); process.exit(1) }
  else { console.log('\n✅ Todos os testes passaram!') }
}

runAll().catch(e => { console.error('Erro ao executar testes:', e); process.exit(1) })
