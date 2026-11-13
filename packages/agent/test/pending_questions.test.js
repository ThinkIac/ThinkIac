import test from 'node:test'
import assert from 'node:assert/strict'
import {
  hasPendingQuestion,
  peekPendingQuestion,
  registerPendingQuestion,
  resolvePendingQuestion,
  cancelPendingQuestion,
} from '../core/pending_questions.js'



let seq = 0
const nextSession = () => `q-${process.pid}-${seq++}`

test('sessão sem pergunta não tem pendência', () => {
  const sessionId = nextSession()

  assert.equal(hasPendingQuestion(sessionId), false)
  assert.equal(peekPendingQuestion(sessionId), null)
})

test('registro marca pendência e expõe pergunta e horário', async () => {
  const sessionId = nextSession()
  const promise = registerPendingQuestion(sessionId, 'qual o ambiente?')

  assert.equal(hasPendingQuestion(sessionId), true)
  const espiada = peekPendingQuestion(sessionId)
  assert.equal(espiada.question, 'qual o ambiente?')
  assert.match(espiada.createdAt, /^\d{4}-\d{2}-\d{2}T/)
  
  assert.equal(espiada.resolve, undefined)
  assert.equal(espiada.reject, undefined)

  resolvePendingQuestion(sessionId, 'produção')
  await promise
})

test('resposta resolve a promise com o texto e limpa a pendência', async () => {
  const sessionId = nextSession()
  const promise = registerPendingQuestion(sessionId, 'ok?')

  assert.equal(resolvePendingQuestion(sessionId, 'sim'), true)
  assert.equal(await promise, 'sim')
  assert.equal(hasPendingQuestion(sessionId), false)
})

test('resposta vazia continua sendo uma resposta', async () => {
  const sessionId = nextSession()
  const promise = registerPendingQuestion(sessionId, 'comentário?')

  resolvePendingQuestion(sessionId, '')
  assert.equal(await promise, '')
})

test('duas perguntas na mesma sessão são recusadas', async () => {
  const sessionId = nextSession()
  const promise = registerPendingQuestion(sessionId, 'primeira')

  assert.throws(
    () => registerPendingQuestion(sessionId, 'segunda'),
    /Já existe uma pergunta pendente/,
  )
  
  assert.equal(peekPendingQuestion(sessionId).question, 'primeira')

  resolvePendingQuestion(sessionId, 'r')
  await promise
})

test('sessões diferentes não interferem entre si', async () => {
  const a = nextSession()
  const b = nextSession()
  const pa = registerPendingQuestion(a, 'pergunta A')
  const pb = registerPendingQuestion(b, 'pergunta B')

  resolvePendingQuestion(a, 'resposta A')
  assert.equal(await pa, 'resposta A')
  assert.equal(hasPendingQuestion(b), true, 'B não pode ser afetada por A')

  resolvePendingQuestion(b, 'resposta B')
  assert.equal(await pb, 'resposta B')
})

test('a mesma sessão pode perguntar de novo depois de respondida', async () => {
  const sessionId = nextSession()

  const primeira = registerPendingQuestion(sessionId, 'p1')
  resolvePendingQuestion(sessionId, 'r1')
  assert.equal(await primeira, 'r1')

  const segunda = registerPendingQuestion(sessionId, 'p2')
  assert.equal(peekPendingQuestion(sessionId).question, 'p2')
  resolvePendingQuestion(sessionId, 'r2')
  assert.equal(await segunda, 'r2')
})

test('responder sessão sem pendência devolve false', () => {
  assert.equal(resolvePendingQuestion(nextSession(), 'oi'), false)
})

test('cancelar rejeita a promise com o motivo dado', async () => {
  const sessionId = nextSession()
  const promise = registerPendingQuestion(sessionId, 'p')

  assert.equal(cancelPendingQuestion(sessionId, 'turno abortado'), true)
  await assert.rejects(promise, /turno abortado/)
  assert.equal(hasPendingQuestion(sessionId), false)
})

test('cancelar usa motivo padrão e não repete', async () => {
  const sessionId = nextSession()
  const promise = registerPendingQuestion(sessionId, 'p')

  assert.equal(cancelPendingQuestion(sessionId), true)
  assert.equal(cancelPendingQuestion(sessionId), false)
  await assert.rejects(promise, /cancelado/)
})

test('resolver depois de cancelar não ressuscita a pergunta', async () => {
  const sessionId = nextSession()
  const promise = registerPendingQuestion(sessionId, 'p')

  cancelPendingQuestion(sessionId, 'abortado')
  assert.equal(resolvePendingQuestion(sessionId, 'tarde demais'), false)
  await assert.rejects(promise, /abortado/)
})

test('timeout rejeita com a duração em minutos', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const sessionId = nextSession()

  const promise = registerPendingQuestion(sessionId, 'p', { timeoutMs: 30 * 60_000 })
  t.mock.timers.tick(30 * 60_000)

  await assert.rejects(promise, /Usuário não respondeu em 30min/)
  assert.equal(hasPendingQuestion(sessionId), false)
})

test('resposta antes do prazo cancela o timer', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const sessionId = nextSession()

  const promise = registerPendingQuestion(sessionId, 'p', { timeoutMs: 60_000 })
  resolvePendingQuestion(sessionId, 'no prazo')
  t.mock.timers.tick(300_000)

  assert.equal(await promise, 'no prazo')
})

test('timeoutMs zero, nulo ou infinito desliga o teto', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })

  for (const timeoutMs of [0, null, Infinity]) {
    const sessionId = nextSession()
    const promise = registerPendingQuestion(sessionId, 'p', { timeoutMs })

    t.mock.timers.tick(24 * 60 * 60_000)
    assert.equal(
      hasPendingQuestion(sessionId),
      true,
      `timeoutMs=${timeoutMs} não devia expirar a pergunta`,
    )

    resolvePendingQuestion(sessionId, 'r')
    await promise
  }
})
