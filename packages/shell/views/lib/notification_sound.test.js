import assert from 'node:assert/strict'
import test from 'node:test'
import { createNotificationSoundPlayer } from './notification_sound.js'

function fakeWindow({ state = 'suspended' } = {}) {
  const calls = { resume: 0, frequency: [], stopped: [] }
  class AudioContext {
    constructor() { this.state = state; this.currentTime = 10; this.destination = {} }
    async resume() { calls.resume += 1; this.state = 'running' }
    createOscillator() { return { frequency: { set value(value) { calls.frequency.push(value) } }, connect() { return { connect() { return this } } }, start() {}, stop(value) { calls.stopped.push(value) } } }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() { return this } } }
    close() {}
  }
  return { AudioContext, calls }
}

test('só toca após desbloquear o contexto em uma interação', async () => {
  const browser = fakeWindow()
  const player = createNotificationSoundPlayer(browser)
  assert.equal(player.play(), false)
  assert.equal(await player.unlock(), true)
  assert.equal(browser.calls.resume, 1)
  assert.equal(player.play(3), true)
  assert.deepEqual(browser.calls.frequency, [620])
  assert.deepEqual(browser.calls.stopped, [10.14])
})

test('usa tom mais alto para prioridade alta', async () => {
  const browser = fakeWindow({ state: 'running' })
  const player = createNotificationSoundPlayer(browser)
  await player.unlock()
  player.play(4)
  assert.deepEqual(browser.calls.frequency, [780])
})
