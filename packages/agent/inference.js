import { realpath, stat } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { callSTT, callTTS } from './llm/llm2.js'

const KINDS = new Set(['decision', 'chat', 'embedding', 'vision', 'stt', 'tts'])

function failure(kind, code, message) {
  return { ok: false, kind, error: { code, message } }
}

function metrics(startedAt) {
  return { runMs: Date.now() - startedAt }
}

async function managedAudioPath(value) {
  const uploads = await realpath(resolve(process.cwd(), 'uploads'))
  const audioPath = await realpath(String(value))
  const pathRelative = relative(uploads, audioPath)
  if (pathRelative === '' || pathRelative === '..' || pathRelative.startsWith(`..${sep}`)) {
    throw new Error('STT aceita somente arquivos já recebidos em uploads/.')
  }
  if (!(await stat(audioPath)).isFile()) throw new Error('Áudio para STT inválido.')
  return audioPath
}

/**
 * Stable, provider-neutral inference envelope.  Tools are only forwarded as a
 * proposal to llm:call: this adapter never executes them.
 */
export async function runInference(payload = {}, dispatch) {
  const kind = String(payload.kind ?? '')
  if (!KINDS.has(kind)) return failure(kind || null, 'invalid_kind', 'Tipo de inferência inválido.')
  if (typeof dispatch !== 'function') return failure(kind, 'unavailable', 'Barramento de eventos indisponível.')
  const startedAt = Date.now()
  const input = payload.input && typeof payload.input === 'object' ? payload.input : {}

  try {
    if (kind === 'embedding') {
      if (typeof input.text !== 'string' || !input.text.trim()) {
        return failure(kind, 'invalid_input', 'Embedding exige input.text não vazio.')
      }
      const vector = await dispatch('llm:embed', { text: input.text, model: payload.model ?? null })
      if (!Array.isArray(vector) || !vector.every(Number.isFinite)) {
        return failure(kind, 'invalid_output', 'O executor de embedding não retornou um vetor numérico.')
      }
      return { ok: true, kind, model: payload.model ?? null, output: { vector, dimensions: vector.length }, metrics: metrics(startedAt) }
    }

    if (kind === 'chat' || kind === 'vision') {
      const text = typeof input.text === 'string' ? input.text : ''
      const images = Array.isArray(input.images) ? input.images : []
      if (!text && !(kind === 'vision' && images.length)) {
        return failure(kind, 'invalid_input', `${kind === 'vision' ? 'Visão' : 'Chat'} exige texto ou imagem.`)
      }
      if (kind === 'chat' && images.length) {
        return failure(kind, 'invalid_input', 'Imagens exigem kind "vision".')
      }
      const content = kind === 'vision'
        ? [{ type: 'text', text }, ...images.map(image => ({ type: 'image_url', image_url: image }))]
        : text
      const result = await dispatch('llm:call', {
        model: payload.model ?? null,
        system: payload.system ?? undefined,
        messages: [{ role: 'user', content }],
        tools: Array.isArray(payload.tools) ? payload.tools : [],
        requirements: kind === 'vision' ? { requires: { capabilities: ['vision'] } } : undefined,
      })
      if (!result?.success) return failure(kind, 'execution_failed', result?.error ?? 'Falha no executor de linguagem.')
      return {
        ok: true, kind, model: result.model ?? payload.model ?? null,
        output: { text: result.text ?? '', toolCalls: result.tool_calls ?? [] },
        metrics: metrics(startedAt),
      }
    }

    if (kind === 'tts') {
      if (typeof input.text !== 'string' || !input.text.trim()) {
        return failure(kind, 'invalid_input', 'TTS exige input.text não vazio.')
      }
      const result = await callTTS({
        input: input.text,
        model: payload.model ?? process.env.AGENT_TTS_MODEL ?? 'openai/gpt-4o-mini-tts',
        voice: input.voice ?? 'alloy',
        responseFormat: input.responseFormat ?? 'mp3', speed: input.speed,
      })
      return { ok: true, kind, model: result.model ?? payload.model ?? null, output: { audioPath: result.filePath, format: result.format }, metrics: metrics(startedAt) }
    }

    if (kind === 'stt') {
      if (typeof input.audioPath !== 'string' || !input.audioPath.trim()) {
        return failure(kind, 'invalid_input', 'STT exige input.audioPath de um áudio já autorizado pelo Runtime.')
      }
      const result = await callSTT({
        model: payload.model ?? process.env.AGENT_STT_MODEL ?? 'openai/whisper-large-v3-turbo',
        audioPath: await managedAudioPath(input.audioPath), language: input.language ?? 'pt', temperature: input.temperature,
      })
      return { ok: true, kind, model: payload.model ?? null, output: { text: String(result?.text ?? '').trim() }, metrics: metrics(startedAt) }
    }

    return failure(kind, 'executor_unavailable', `Nenhum executor ${kind} está instalado neste Runtime.`)
  } catch (error) {
    return failure(kind, 'execution_failed', error instanceof Error ? error.message : String(error))
  }
}

export function describeInferenceCapabilities(modelCatalog = null) {
  const accesses = Array.isArray(modelCatalog?.accesses) ? modelCatalog.accesses : []
  const supportsVision = accesses.some(access => access?.capabilities?.vision?.supported === true || access?.capabilities?.image?.supported === true)
  return {
    protocol: 'thinkiac.inference/v1',
    kinds: [
      { kind: 'decision', available: false, executor: null },
      { kind: 'chat', available: accesses.length > 0, executor: 'llm:call', tools: 'proposed-only' },
      { kind: 'embedding', available: true, executor: 'llm:embed' },
      { kind: 'vision', available: supportsVision, executor: supportsVision ? 'llm:call' : null, tools: 'proposed-only' },
      { kind: 'stt', available: true, executor: 'provider:audio/transcriptions' },
      { kind: 'tts', available: true, executor: 'provider:audio/speech' },
    ],
  }
}
