function concatBytes(left, right) {
  if (!left.length) return new Uint8Array(right)
  const joined = new Uint8Array(left.length + right.length)
  joined.set(left)
  joined.set(right, left.length)
  return joined
}

function ascii(bytes, offset, length) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

export class Pcm16WavDecoder {
  constructor() {
    this.pending = new Uint8Array(0)
    this.headerParsed = false
    this.sampleRate = 0
    this.channels = 0
  }

  push(chunk) {
    this.pending = concatBytes(this.pending, chunk)
    if (!this.headerParsed) {
      if (this.pending.length < 44) return new Float32Array(0)
      if (ascii(this.pending, 0, 4) !== 'RIFF' || ascii(this.pending, 8, 4) !== 'WAVE') {
        throw new Error('Stream TTS não contém WAV válido')
      }
      const view = new DataView(this.pending.buffer, this.pending.byteOffset, this.pending.byteLength)
      const format = view.getUint16(20, true)
      this.channels = view.getUint16(22, true)
      this.sampleRate = view.getUint32(24, true)
      const bits = view.getUint16(34, true)
      if (format !== 1 || this.channels !== 1 || bits !== 16 || !this.sampleRate) {
        throw new Error('Stream TTS exige WAV PCM16 mono')
      }
      if (ascii(this.pending, 36, 4) !== 'data') throw new Error('Stream WAV sem bloco de áudio')
      this.pending = this.pending.subarray(44)
      this.headerParsed = true
    }

    const byteLength = this.pending.length - (this.pending.length % 2)
    if (!byteLength) return new Float32Array(0)
    const view = new DataView(this.pending.buffer, this.pending.byteOffset, byteLength)
    const samples = new Float32Array(byteLength / 2)
    for (let index = 0; index < samples.length; index += 1) {
      const value = view.getInt16(index * 2, true)
      samples[index] = value < 0 ? value / 32768 : value / 32767
    }
    this.pending = this.pending.subarray(byteLength)
    return samples
  }
}

export class StreamingPcmPlayer {
  constructor({ createAudioContext, initialBufferSeconds = 1.5 } = {}) {
    this.createAudioContext = createAudioContext || (() => {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext
      if (!AudioContextClass) throw new Error('Streaming de áudio não é suportado neste navegador')
      return new AudioContextClass()
    })
    this.context = null
    this.reader = null
    this.sources = new Set()
    this.endPromises = []
    this.nextStart = 0
    this.cancelled = false
    this.started = false
    this.handlers = {}
    this.initialBufferSeconds = initialBufferSeconds
  }

  get isPaused() { return this.context?.state === 'suspended' }

  async playResponse(response, handlers = {}) {
    if (!response?.body?.getReader) throw new Error('Resposta não oferece streaming incremental')
    this.cancelled = false
    this.handlers = handlers
    this.context = this.createAudioContext()
    if (this.context.state === 'suspended') await this.context.resume().catch(() => {})
    this.nextStart = this.context.currentTime + this.initialBufferSeconds
    this.reader = response.body.getReader()
    const decoder = new Pcm16WavDecoder()

    try {
      while (!this.cancelled) {
        const { done, value } = await this.reader.read()
        if (done || this.cancelled) break
        const samples = decoder.push(value)
        if (samples.length) this.schedule(samples, decoder.sampleRate)
      }
      if (!this.cancelled && !decoder.headerParsed) throw new Error('Stream TTS terminou sem áudio')
      if (!this.cancelled) await Promise.all(this.endPromises)
    } finally {
      if (!this.cancelled) {
        await this.context?.close?.().catch(() => {})
        this.handlers.onEnd?.()
      }
      this.reader = null
    }
  }

  schedule(samples, sampleRate) {
    const buffer = this.context.createBuffer(1, samples.length, sampleRate)
    buffer.copyToChannel(samples, 0)
    const source = this.context.createBufferSource()
    source.buffer = buffer
    source.connect(this.context.destination)
    const startAt = Math.max(this.context.currentTime, this.nextStart)
    this.nextStart = startAt + buffer.length / sampleRate
    this.sources.add(source)
    this.endPromises.push(new Promise(resolve => {
      source.onended = () => { this.sources.delete(source); resolve() }
    }))
    source.start(startAt)
    if (!this.started) {
      this.started = true
      if (this.context.state === 'running') this.handlers.onStart?.()
      else this.handlers.onBlocked?.()
    }
  }

  async pause() {
    await this.context?.suspend?.()
  }

  async resume() {
    await this.context?.resume?.()
    if (this.started && this.context?.state === 'running') this.handlers.onStart?.()
  }

  cancel() {
    this.cancelled = true
    this.reader?.cancel?.().catch?.(() => {})
    for (const source of this.sources) {
      try { source.stop() } catch {}
    }
    this.sources.clear()
    this.context?.close?.().catch?.(() => {})
    this.context = null
  }
}
