import test from 'node:test'
import assert from 'node:assert/strict'
import {
  nativeMessageActions, normalizePackageActions, orderMessageActions,
  listenSessionKey, shouldAutoSpeak,
} from './message_actions.js'

test('copy, like e dislike pertencem ao registry nativo', () => {
  assert.deepEqual(nativeMessageActions.map(action => action.id), [
    'native:copy', 'native:speak', 'native:like', 'native:dislike',
  ])
  assert.equal(nativeMessageActions.find(action => action.id === 'native:speak').native, true)
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

test('preserva streaming e fallback de uma contribuição TTS sintética', () => {
  const [action] = normalizePackageActions({
    packageName: 'tts-example',
    messageActions: [{
      id: 'listen', kind: 'audio', endpoint: 'speak', streaming: true,
      fallbackEndpoint: 'generate',
    }],
  })
  assert.equal(action.streaming, true)
  assert.equal(action.endpoint, '/tts-example/speak')
  assert.equal(action.fallbackEndpoint, '/tts-example/generate')
})

test('ordena ações estavelmente pelo campo order', () => {
  const input = [{ id: 'b', order: 20 }, { id: 'a', order: 10 }, { id: 'c', order: 20 }]
  assert.deepEqual(orderMessageActions(input).map(item => item.id), ['a', 'b', 'c'])
})
