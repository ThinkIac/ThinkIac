const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeIntent, classificationCacheKey } = require('./cache-key')

test('normaliza diferenças cosméticas da intenção', () => {
  assert.equal(normalizeIntent('  Liste AS\n tarefas abertas  '), 'liste as tarefas abertas')
})

test('cache muda quando a intenção muda na mesma sessão e catálogo', () => {
  const a = classificationCacheKey({ sessionId: 's1', message: 'liste tarefas', toolsHash: 'tools-v1' })
  const b = classificationCacheKey({ sessionId: 's1', message: 'envie um e-mail', toolsHash: 'tools-v1' })
  assert.notEqual(a, b)
})

test('cache é estável para a mesma intenção normalizada', () => {
  const a = classificationCacheKey({ sessionId: 's1', message: ' Liste tarefas ', toolsHash: 'tools-v1' })
  const b = classificationCacheKey({ sessionId: 's1', message: 'liste TAREFAS', toolsHash: 'tools-v1' })
  assert.equal(a, b)
})
