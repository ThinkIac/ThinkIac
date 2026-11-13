import test from 'node:test'
import assert from 'node:assert/strict'
import {
  nativeMessageActions, normalizePackageActions, orderMessageActions,
  listenSessionKey, shouldAutoSpeak,
} from './message_actions.js'

test('copy, like e dislike pertencem ao registry nativo', () => {
  assert.deepEqual(nativeMessageActions.map(action => action.id), [
    'native:copy', 'native:like', 'native:dislike',
  ])
})

test('modo ouvir é isolado por sessão e auto áudio respeita a origem da entrada', () => {
  assert.equal(listenSessionKey('orbit-123'), 'agent:message-actions:listen:orbit-123')
  assert.equal(shouldAutoSpeak({ listenEnabled: true, isLatest: true }), true)
  assert.equal(shouldAutoSpeak({ listenEnabled: true, isLatest: false }), false)
  assert.equal(shouldAutoSpeak({ respondAudioWithAudio: true, previousInputWasAudio: true, isLatest: true }), true)
  assert.equal(shouldAutoSpeak({ respondAudioWithAudio: true, previousInputWasAudio: false, isLatest: true }), false)
})

test('normaliza ações contribuídas por pacote sem aceitar handlers nativos', () => {
  const actions = normalizePackageActions({
    packageName: 'openrouter-tts',
    url: '/openrouter-tts',
    messageActions: [{ id: 'listen', label: 'Ouvir', kind: 'audio', endpoint: 'speak', order: 20 }],
  })
  assert.deepEqual(actions, [{
    id: 'pkg:openrouter-tts:listen', packageName: 'openrouter-tts', label: 'Ouvir',
    kind: 'audio', endpoint: '/openrouter-tts/speak', order: 20, roles: ['assistant'],
  }])
})

test('alternância da sessão não pertence ao slot de ações da mensagem', () => {
  const actions = normalizePackageActions({
    packageName: 'openrouter-tts',
    messageActions: [{ id: 'listen-session', kind: 'audio-session', endpoint: 'speak' }],
  })
  assert.deepEqual(actions, [])
})

test('o pacote TTS declara o modo da sessão na InputBar', async () => {
  const manifest = JSON.parse(await import('node:fs/promises').then(fs =>
    fs.readFile(new URL('../../../pocket-tts/package.json', import.meta.url), 'utf8')
  )).manifest
  assert.equal(manifest.inputbar.command, 'toggle-listen-session')
  assert.equal(manifest.inputbar.view, false)
  assert.deepEqual(manifest.messageActions.map(action => action.kind), ['audio'])
  assert.equal(manifest.messageActions[0].streaming, true)
  assert.equal(manifest.messageActions[0].fallbackEndpoint, 'generate')
})

test('ordena ações estavelmente pelo campo order', () => {
  const input = [{ id: 'b', order: 20 }, { id: 'a', order: 10 }, { id: 'c', order: 20 }]
  assert.deepEqual(orderMessageActions(input).map(item => item.id), ['a', 'b', 'c'])
})
