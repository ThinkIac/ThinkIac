import assert from 'node:assert/strict'
import test from 'node:test'

import { mobileResponseNotification, onDeviceResponse } from './mobile_notifications.js'

test('resposta final publica deep-link absoluto e campo de resposta', async () => {
  const calls = []
  await mobileResponseNotification(
    { sessionId: 'sessão 1', response: 'Resposta pronta', epoch: 3, seq: 9 },
    async (event, payload) => calls.push({ event, payload }),
  )
  assert.equal(calls.length, 1)
  assert.equal(calls[0].event, 'device:notify')
  assert.equal(calls[0].payload.interaction, 'prompt')
  assert.equal(calls[0].payload.id, 'chat:sessão 1:3:9')
  assert.equal(new URL(calls[0].payload.click).searchParams.get('session'), 'sessão 1')
})

test('resposta da notificação entra uma vez na sessão vinculada', async () => {
  const notifications = []
  const submitted = []
  await mobileResponseNotification(
    { sessionId: 's-mobile', response: 'Primeira', epoch: 1, seq: 2 },
    async (event, payload) => notifications.push({ event, payload }),
  )
  const id = notifications[0].payload.id
  const response = { appId: 'phone', id, action: 'submit', value: 'continue daqui' }
  const emit = async (event, payload) => notifications.push({ event, payload })
  const submit = async payload => submitted.push(payload)
  await onDeviceResponse(response, emit, submit)
  await onDeviceResponse(response, emit, submit)
  assert.equal(submitted.length, 1)
  assert.deepEqual(submitted[0], {
    message: 'continue daqui',
    session_id: 's-mobile',
    metadata: { source: 'android-notification', appId: 'phone' },
  })
  assert.equal(notifications.at(-1).payload.message, 'Respondendo…')
})

test('ids desconhecidos e ações sem texto são ignorados', async () => {
  let submitted = 0
  await onDeviceResponse(
    { id: 'qualquer', action: 'submit', value: 'texto' },
    async () => {},
    async () => { submitted++ },
  )
  await onDeviceResponse(
    { id: 'qualquer', action: 'cancel', value: 'texto' },
    async () => {},
    async () => { submitted++ },
  )
  assert.equal(submitted, 0)
})
