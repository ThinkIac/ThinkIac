/**
 * Testes unitários para ContextRefiner
 * 
 * Cobre:
 * - scoreRelevance() — embeddings + fallback bag-of-words
 * - pruneStale() — remoção de contextos antigos
 * - buildTailoredContext() — orquestrador principal
 * 
 * Edge cases: facts grandes, tópicos curtos, contextos stale, pinned items
 */

import { ContextRefiner } from './context_refiner.js'




const createRefiner = () => new ContextRefiner({
  embedder: async () => { throw new Error('embedding disabled in unit test') },
})



let passed = 0
let failed = 0

function assert(condition, message) {
  if (condition) {
    passed++
    console.log(`  ✅ ${message}`)
  } else {
    failed++
    console.error(`  ❌ ${message}`)
  }
}

function assertApprox(actual, expected, tolerance, message) {
  const ok = Math.abs(actual - expected) <= tolerance
  if (ok) {
    passed++
    console.log(`  ✅ ${message} (got ${actual.toFixed(4)})`)
  } else {
    failed++
    console.error(`  ❌ ${message} — expected ~${expected}, got ${actual}`)
  }
}



async function testScoreRelevance() {
  console.log('\n📋 testScoreRelevance')
  const refiner = createRefiner()

  
  const score1 = await refiner.scoreRelevance(
    'O sistema Agent usa SQLite para persistência',
    'O sistema Agent usa SQLite para persistência'
  )
  assert(score1 > 0.5, 'Textos idênticos → score > 0.5')

  
  const score2 = await refiner.scoreRelevance(
    'O sistema Agent usa SQLite para persistência',
    'Receita de bolo de chocolate com cobertura'
  )
  assert(score2 < 0.5, 'Textos diferentes → score < 0.5')

  
  const score3 = await refiner.scoreRelevance(
    'O sistema Agent usa SQLite para persistência',
    'Agent banco de dados SQLite'
  )
  assert(score3 > 0.1 && score3 < 0.9, 'Textos parcialmente relacionados → score entre 0.1 e 0.9')

  
  const score4 = await refiner.scoreRelevance('', 'qualquer coisa')
  assert(score4 === 0, 'Texto vazio → score = 0')

  const score5 = await refiner.scoreRelevance('algo', '')
  assert(score5 === 0, 'Query vazia → score = 0')

  
  const score6 = await refiner.scoreRelevance(null, 'query')
  assert(score6 === 0, 'Texto null → score = 0')
}



async function testPruneStale() {
  console.log('\n📋 testPruneStale')
  const refiner = createRefiner()
  const now = Date.now()

  const contexts = [
    { name: 'ctx-recent', value: 'recent value', lastAccessed: now - 1000, priority: 1 },
    { name: 'ctx-old', value: 'old value', lastAccessed: now - (200 * 3600 * 1000), priority: 2 }, 
    { name: 'ctx-very-old', value: 'very old', lastAccessed: now - (500 * 3600 * 1000), priority: 3 }, 
    { name: 'ctx-fresh', value: 'fresh value', lastAccessed: now - 100, priority: 1 },
  ]

  const { kept, pruned } = refiner.pruneStale(contexts)

  assert(kept.length === 2, `Mantém 2 contextos recentes (kept=${kept.length})`)
  assert(pruned.length === 2, `Poda 2 contextos stale (pruned=${pruned.length})`)
  assert(kept.some(c => c.name === 'ctx-recent'), 'ctx-recent está em kept')
  assert(kept.some(c => c.name === 'ctx-fresh'), 'ctx-fresh está em kept')
  assert(pruned.some(c => c.name === 'ctx-old'), 'ctx-old está em pruned')
  assert(pruned.some(c => c.name === 'ctx-very-old'), 'ctx-very-old está em pruned')

  
  const empty = refiner.pruneStale([])
  assert(empty.kept.length === 0 && empty.pruned.length === 0, 'Array vazio → kept=[] pruned=[]')

  
  const nullResult = refiner.pruneStale(null)
  assert(nullResult.kept.length === 0 && nullResult.pruned.length === 0, 'Input null → safe fallback')

  
  const customContexts = [
    { name: '30min', value: 'v', lastAccessed: now - (30 * 60 * 1000) },
    { name: '2h', value: 'v', lastAccessed: now - (2 * 3600 * 1000) },
  ]
  const custom = refiner.pruneStale(customContexts, 1)
  assert(custom.kept.length === 1 && custom.kept[0].name === '30min', 'TTL custom 1h → mantém apenas 30min')
}



async function testBuildTailoredContext() {
  console.log('\n📋 buildTailoredContext')
  const refiner = createRefiner()

  
  const result1 = await refiner.buildTailoredContext(
    { facts: '- [fact1] algo importante', summary: 'resumo anterior', runtimeContexts: [] },
    'ab'
  )
  assert(result1.pruned === 0, 'Tópico curto → pruned = 0 (sem filtragem)')
  assert(result1.facts.includes('[fact1]'), 'Tópico curto → facts preservados')
  assert(result1.summary === 'resumo anterior', 'Tópico curto → summary preservado')

  
  
  const manyFacts = [
    ...Array.from({ length: 3 }, (_, i) => `- [fact${i}] Agent sistema contexto runtime`),
    ...Array.from({ length: 9 }, (_, i) => `- [other${i}] assunto completamente diferente ${i}`),
  ].join('\n')

  const result2 = await refiner.buildTailoredContext(
    { facts: manyFacts, summary: 'resumo', runtimeContexts: [] },
    'Agent contexto runtime'
  )
  assert(result2.pruned > 0, 'Facts > TOP_N → alguns podados (pruned > 0)')
  
  assert(result2.facts.includes('[fact0]') || result2.facts.includes('[fact1]'), 'Facts relevantes ao tópico presentes')

  
  
  const manyContexts = Array.from({ length: 7 }, (_, i) => ({
    name: `ctx-${i}`,
    value: i < 2 ? 'Agent runtime tools' : `outro contexto irrelevante ${i}`,
    lastAccessed: Date.now(),
    priority: i,
  }))

  const result3 = await refiner.buildTailoredContext(
    { facts: '- [f1] Agent test', summary: 'sum', runtimeContexts: manyContexts },
    'Agent runtime tools'
  )
  
  assert(result3.runtimeContexts.includes('[Context: ctx-'), 'Runtime contexts formatados com prefixo [Context:]')

  
  const pinnedFacts = [
    '- [2026-01-01] SCHEDULE | cron: "daily 09:00" | task: "resumir PRs" | channel: "ntfy"',
    '- [2026-01-01] METACOGNITION | {"cycleCount": 50}',
    '- [fact-normal] algo sobre Agent',
  ].join('\n')

  const result4 = await refiner.buildTailoredContext(
    { facts: pinnedFacts, summary: '', runtimeContexts: [] },
    'Agent'
  )
  assert(result4.facts.includes('SCHEDULE'), 'SCHEDULE sempre incluído (pinned)')
  assert(result4.facts.includes('METACOGNITION'), 'METACOGNITION sempre incluído (pinned)')

  
  
  
  const longSummary = 'Receita de bolo de chocolate: misture farinha, ovos, açúcar e chocolate. Asse por 40 minutos em forno a 180 graus. '.repeat(10)
  const result5 = await refiner.buildTailoredContext(
    {
      facts: Array.from({ length: 12 }, (_, i) => `- [f${i}] Agent contexto runtime`).join('\n'),
      summary: longSummary,
      runtimeContexts: [],
    },
    'Agent contexto runtime'
  )
  assert(result5.summary.includes('[...truncado pelo refiner...]') || result5.summary.length <= 350,
    'Summary irrelevante e longo → truncado pelo refiner')

  
  const result6 = await refiner.buildTailoredContext(null, 'Agent')
  assert(result6.facts === '', 'Sources null → facts vazio')
  assert(result6.pruned === 0, 'Sources null → pruned = 0')

  const result7 = await refiner.buildTailoredContext({}, 'Agent')
  assert(result7.pruned === 0, 'Sources vazios → pruned = 0')
}



async function testBuildTailoredContextWithRuntime() {
  console.log('\n📋 buildTailoredContext com runtime contexts reais')
  const refiner = createRefiner()

  const runtimeContexts = [
    { name: 'system-status', value: 'CPU: 45%, RAM: 2.1GB/8GB, Disk: 120GB free', lastAccessed: Date.now(), priority: 5 },
    { name: 'wireless-info', value: 'Connected to MyWiFi, Signal: -42dBm', lastAccessed: Date.now() - 3600000, priority: 3 },
    { name: 'active-apps', value: 'Docker: 3 containers running (agent, postgres, redis)', lastAccessed: Date.now() - 7200000, priority: 4 },
    { name: 'battery', value: 'Battery: 87%, Charging: false', lastAccessed: Date.now() - 1000, priority: 2 },
    { name: 'telegram-chats', value: 'Chats: @dev-team (id: -123), @alerts (id: -456)', lastAccessed: Date.now() - 60000, priority: 1 },
  ]

  
  const result = await refiner.buildTailoredContext(
    {
      facts: '- [f1] Agent monitors system resources\n- [f2] Telegram integration active',
      summary: 'Previous session: discussed system monitoring',
      runtimeContexts,
    },
    'system monitoring CPU memory docker'
  )

  assert(result.runtimeContexts.length > 0, 'Runtime contexts retornados para tópico de sistema')
  assert(typeof result.runtimeContexts === 'string', 'Runtime contexts é string formatada')
}



async function runAll() {
  console.log('🧪 ContextRefiner — Testes Unitários')
  console.log('='.repeat(50))

  await testScoreRelevance()
  await testPruneStale()
  await testBuildTailoredContext()
  await testBuildTailoredContextWithRuntime()

  console.log('\n' + '='.repeat(50))
  console.log(`📊 Resultado: ${passed} passed, ${failed} failed, ${passed + failed} total`)

  if (failed > 0) {
    console.error(`\n❌ ${failed} teste(s) falharam!`)
    process.exit(1)
  } else {
    console.log('\n✅ Todos os testes passaram!')
  }
}

runAll().catch(e => {
  console.error('Erro ao executar testes:', e)
  process.exit(1)
})
