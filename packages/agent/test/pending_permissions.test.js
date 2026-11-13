import test from 'node:test'
import assert from 'node:assert/strict'
import {
  registerPendingPermission,
  peekPendingPermission,
  listPendingPermissions,
  resolvePendingPermission,
  resolveSessionPermission,
  cancelSessionPermissions,
} from '../core/pending_permissions.js'




let seq = 0
const nextSession = () => `sess-${process.pid}-${seq++}`

test('resposta HTTP não consome pedido de outra sessão ou pedido expirado', async () => {
  const sessionId = nextSession();
  const { requestId, promise } = registerPendingPermission(req(sessionId));
  assert.equal(resolveSessionPermission(nextSession(), requestId, 'allow'), false);
  assert.ok(peekPendingPermission(requestId));
  assert.equal(resolveSessionPermission(sessionId, requestId, 'deny'), true);
  assert.equal((await promise).decision, 'deny');
  assert.equal(resolveSessionPermission(sessionId, requestId, 'allow'), false);
});

function req(sessionId, over = {}) {
  return {
    sessionId,
    toolName: 'Bash',
    toolInput: { command: 'ls' },
    toolUseId: 'tu_1',
    ...over,
  }
}

test('registro devolve requestId único e uma promise pendente', async () => {
  const sessionId = nextSession()
  const a = registerPendingPermission(req(sessionId))
  const b = registerPendingPermission(req(sessionId))

  assert.notEqual(a.requestId, b.requestId)
  assert.ok(a.promise instanceof Promise)

  cancelSessionPermissions(sessionId)
  await Promise.all([a.promise, b.promise])
})

test('peek expõe os metadados da ferramenta sem vazar resolve nem timer', async () => {
  const sessionId = nextSession()
  const { requestId, promise } = registerPendingPermission(req(sessionId))

  const meta = peekPendingPermission(requestId)
  assert.equal(meta.requestId, requestId)
  assert.equal(meta.sessionId, sessionId)
  assert.equal(meta.toolName, 'Bash')
  assert.deepEqual(meta.toolInput, { command: 'ls' })
  assert.equal(meta.toolUseId, 'tu_1')
  assert.match(meta.createdAt, /^\d{4}-\d{2}-\d{2}T/)
  
  assert.equal(meta.resolve, undefined)
  assert.equal(meta.timeoutHandle, undefined)

  cancelSessionPermissions(sessionId)
  await promise
})

test('peek de requestId inexistente devolve null', () => {
  assert.equal(peekPendingPermission('nao-existe'), null)
})

test('lista traz só os pedidos da sessão pedida', async () => {
  const alvo = nextSession()
  const outra = nextSession()
  const a = registerPendingPermission(req(alvo, { toolName: 'Read' }))
  const b = registerPendingPermission(req(alvo, { toolName: 'Write' }))
  const c = registerPendingPermission(req(outra, { toolName: 'Bash' }))

  const lista = listPendingPermissions(alvo)
  assert.deepEqual(lista.map(p => p.toolName).sort(), ['Read', 'Write'])
  assert.deepEqual(listPendingPermissions(outra).map(p => p.toolName), ['Bash'])
  assert.deepEqual(listPendingPermissions('sessao-vazia'), [])

  cancelSessionPermissions(alvo)
  cancelSessionPermissions(outra)
  await Promise.all([a.promise, b.promise, c.promise])
})

test('allow resolve a promise com a decisão e some do registro', async () => {
  const { requestId, promise } = registerPendingPermission(req(nextSession()))

  assert.equal(resolvePendingPermission(requestId, 'allow'), true)
  assert.deepEqual(await promise, { decision: 'allow', reason: undefined })
  assert.equal(peekPendingPermission(requestId), null)
})

test('deny carrega o motivo informado', async () => {
  const { requestId, promise } = registerPendingPermission(req(nextSession()))

  resolvePendingPermission(requestId, 'deny', 'comando perigoso')
  assert.deepEqual(await promise, { decision: 'deny', reason: 'comando perigoso' })
})

test('qualquer decisão que não seja allow vira deny', async () => {
  const casos = ['deny', 'talvez', '', null, undefined, 'ALLOW']
  for (const decisao of casos) {
    const { requestId, promise } = registerPendingPermission(req(nextSession()))
    resolvePendingPermission(requestId, decisao)
    const { decision } = await promise
    assert.equal(decision, 'deny', `decisão ${JSON.stringify(decisao)} devia virar deny`)
  }
})

test('resolver duas vezes o mesmo pedido devolve false na segunda', async () => {
  const { requestId, promise } = registerPendingPermission(req(nextSession()))

  assert.equal(resolvePendingPermission(requestId, 'allow'), true)
  assert.equal(resolvePendingPermission(requestId, 'deny'), false)
  
  assert.equal((await promise).decision, 'allow')
})

test('resolver requestId inexistente devolve false sem estourar', () => {
  assert.equal(resolvePendingPermission('fantasma', 'allow'), false)
})

test('cancelamento nega todos os pedidos da sessão e conta quantos', async () => {
  const alvo = nextSession()
  const preservada = nextSession()
  const a = registerPendingPermission(req(alvo))
  const b = registerPendingPermission(req(alvo))
  const c = registerPendingPermission(req(preservada))

  assert.equal(cancelSessionPermissions(alvo, 'turno abortado'), 2)

  for (const p of [a, b]) {
    assert.deepEqual(await p.promise, { decision: 'deny', reason: 'turno abortado' })
  }
  
  assert.equal(peekPendingPermission(c.requestId)?.sessionId, preservada)

  cancelSessionPermissions(preservada)
  await c.promise
})

test('cancelamento usa motivo padrão e é idempotente', async () => {
  const sessionId = nextSession()
  const { promise } = registerPendingPermission(req(sessionId))

  assert.equal(cancelSessionPermissions(sessionId), 1)
  assert.equal(cancelSessionPermissions(sessionId), 0, 'nada sobrou para cancelar')
  assert.equal((await promise).reason, 'Turno cancelado.')
})

test('timeout nega o pedido em vez de rejeitar a promise', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })

  const { requestId, promise } = registerPendingPermission(req(nextSession()), {
    timeoutMs: 30 * 60_000,
  })

  t.mock.timers.tick(30 * 60_000)

  
  const decisao = await promise
  assert.equal(decisao.decision, 'deny')
  assert.match(decisao.reason, /Tempo esgotado \(30min sem resposta\)/)
  assert.equal(peekPendingPermission(requestId), null, 'o pedido some do registro')
})

test('decisão antes do prazo cancela o timer e prevalece', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })

  const { requestId, promise } = registerPendingPermission(req(nextSession()), {
    timeoutMs: 60_000,
  })

  resolvePendingPermission(requestId, 'allow')
  t.mock.timers.tick(120_000)

  assert.equal((await promise).decision, 'allow')
})

test('timeoutMs zero, nulo ou infinito desliga o teto', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const sessionId = nextSession()

  for (const timeoutMs of [0, null, Infinity]) {
    const { requestId } = registerPendingPermission(req(sessionId), { timeoutMs })
    t.mock.timers.tick(24 * 60 * 60_000)
    assert.ok(
      peekPendingPermission(requestId),
      `timeoutMs=${timeoutMs} não devia expirar o pedido`,
    )
  }

  cancelSessionPermissions(sessionId)
})
