import test from 'node:test'
import assert from 'node:assert/strict'
import { mobileResponseNotification } from '../hooks/mobile_notifications.js'

test('a resposta do chat atualiza uma única notificação por sessão', async () => {
  const calls = []
  const payload = await mobileResponseNotification(
    { sessionId: 'orbit-123', response: 'Resposta final\ncom detalhes.' },
    (...args) => { calls.push(args); return Promise.resolve() },
  )

  assert.equal(payload.sessionId, 'orbit-123')
  assert.deepEqual(calls, [[
    'device:notify',
    {
      title: 'ThinkIac',
      message: 'Resposta final com detalhes.',
      click: '/view/shell/Index?open=chat&session=orbit-123',
      sessionId: 'orbit-123',
      discreteId: 'chat:orbit-123',
    },
  ]])
})

test('uma resposta sem sessão não publica notificação', async () => {
  let calls = 0
  await mobileResponseNotification({ response: 'sem sessão' }, () => { calls++; return Promise.resolve() })
  assert.equal(calls, 0)
})
