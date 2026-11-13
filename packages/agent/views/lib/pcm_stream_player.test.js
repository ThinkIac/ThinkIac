import test from 'node:test'
import assert from 'node:assert/strict'

import { Pcm16WavDecoder, StreamingPcmPlayer } from './pcm_stream_player.js'

function wavHeader({ sampleRate = 24_000, channels = 1 } = {}) {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(0xffffffff, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * channels * 2, 28)
  header.writeUInt16LE(channels * 2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(0xffffffff, 40)
  return header
}

test('decoder aceita header e amostras PCM quebrados entre chunks', () => {
  const decoder = new Pcm16WavDecoder()
  const bytes = Buffer.concat([wavHeader(), Buffer.from([0x00, 0x80, 0xff, 0x7f])])
  const samples = [
    ...decoder.push(bytes.subarray(0, 43)),
    ...decoder.push(bytes.subarray(43, 45)),
    ...decoder.push(bytes.subarray(45)),
  ]
  assert.equal(decoder.sampleRate, 24_000)
  assert.equal(samples.length, 2)
  assert.equal(samples[0], -1)
  assert.ok(samples[1] > 0.999)
})

test('player agenda o primeiro áudio antes do stream terminar e cancela sources', async () => {
  let releaseSecond
  let reads = 0
  const first = Buffer.concat([wavHeader(), Buffer.from([0, 0, 1, 0])])
  const second = Buffer.from([2, 0, 3, 0])
  const reader = {
    async read() {
      reads += 1
      if (reads === 1) return { done: false, value: first }
      if (reads === 2) return new Promise(resolve => { releaseSecond = () => resolve({ done: false, value: second }) })
      return { done: true }
    },
    async cancel() {},
  }
  const sources = []
  const context = {
    currentTime: 0,
    state: 'running',
    destination: {},
    createBuffer: (_channels, length, sampleRate) => ({ length, sampleRate, copyToChannel() {} }),
    createBufferSource: () => {
      const source = { connect() {}, start(at) { source.started = true; source.startAt = at }, stop() { source.stopped = true; source.onended?.() } }
      sources.push(source)
      return source
    },
    suspend: async () => { context.state = 'suspended' },
    resume: async () => { context.state = 'running' },
    close: async () => {},
  }
  const player = new StreamingPcmPlayer({ createAudioContext: () => context })
  const playing = player.playResponse({ body: { getReader: () => reader } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(sources.length, 1)
  assert.equal(sources[0].started, true)
  assert.equal(sources[0].startAt, 1.5)
  player.cancel()
  assert.equal(sources[0].stopped, true)
  releaseSecond()
  await playing
})

test('player aceita buffer inicial customizado', async () => {
  const response = {
    body: {
      getReader: () => ({
        calls: 0,
        async read() {
          this.calls += 1
          return this.calls === 1
            ? { done: false, value: Buffer.concat([wavHeader(), Buffer.from([0, 0])]) }
            : { done: true }
        },
      }),
    },
  }
  let startAt
  const context = {
    currentTime: 4,
    state: 'running',
    destination: {},
    createBuffer: (_channels, length) => ({ length, copyToChannel() {} }),
    createBufferSource: () => ({
      connect() {},
      start(at) { startAt = at; queueMicrotask(() => this.onended?.()) },
    }),
    close: async () => {},
  }
  const player = new StreamingPcmPlayer({ createAudioContext: () => context, initialBufferSeconds: 0.75 })
  await player.playResponse(response)
  assert.equal(startAt, 4.75)
})
