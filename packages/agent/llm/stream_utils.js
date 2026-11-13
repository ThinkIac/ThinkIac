










export const STREAM_IDLE_MS = 90_000

class AbortError extends Error {
  constructor(message = 'Aborted') {
    super(message)
    this.name = 'AbortError'
  }
}

class StreamIdleTimeoutError extends Error {
  constructor(ms) {
    super(`stream idle timeout after ${ms}ms`)
    this.name = 'StreamIdleTimeoutError'
  }
}

/**
 * `reader.read()` com timeout de ociosidade + AbortSignal. Resolve com o
 * resultado normal do read ({ done, value }); rejeita com StreamIdleTimeoutError
 * se nenhum chunk chega dentro de `ms`, ou com AbortError se o signal abortar.
 * Não cancela o reader — cabe ao chamador decidir (geralmente reader.cancel()).
 */
export function readWithIdleTimeout(reader, ms = STREAM_IDLE_MS, signal = null) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn, arg) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
      fn(arg)
    }
    const timer = setTimeout(() => finish(reject, new StreamIdleTimeoutError(ms)), ms)
    const onAbort = () => finish(reject, new AbortError())

    if (signal) {
      if (signal.aborted) return finish(reject, new AbortError())
      signal.addEventListener('abort', onAbort, { once: true })
    }

    reader.read().then(
      (r) => finish(resolve, r),
      (e) => finish(reject, e),
    )
  })
}

export function isStreamIdleTimeout(err) {
  return err instanceof StreamIdleTimeoutError || err?.name === 'StreamIdleTimeoutError'
}




















const THINK_TAGS = ['think', 'thinking', 'thought']
const THINK_OPEN_RE = new RegExp(`<(${THINK_TAGS.join('|')})>`, 'i')
const THINK_CLOSE_RE = new RegExp(`</(${THINK_TAGS.join('|')})>`, 'i')
const THINK_MAX_MARKER_LEN = Math.max(...THINK_TAGS.map(t => t.length)) + 3 

function thinkTagPartialSuffixLen(s) {
  const from = Math.max(0, s.length - THINK_MAX_MARKER_LEN)
  for (let i = from; i < s.length; i++) {
    const suffix = s.slice(i)
    if (!suffix.startsWith('<')) continue
    for (const t of THINK_TAGS) {
      if (`<${t}>`.startsWith(suffix) || `</${t}>`.startsWith(suffix)) return i
    }
  }
  return s.length
}

export function createThinkTagFilter(onText, onReasoning) {
  let buf = ''
  let inTag = false

  function drain(final) {
    for (;;) {
      if (!inTag) {
        const m = buf.match(THINK_OPEN_RE)
        if (m) {
          if (m.index > 0) onText(buf.slice(0, m.index))
          buf = buf.slice(m.index + m[0].length)
          inTag = true
          continue
        }
        const safe = final ? buf.length : thinkTagPartialSuffixLen(buf)
        if (safe > 0) { onText(buf.slice(0, safe)); buf = buf.slice(safe) }
        return
      }
      const m = buf.match(THINK_CLOSE_RE)
      if (m) {
        if (m.index > 0) onReasoning(buf.slice(0, m.index))
        buf = buf.slice(m.index + m[0].length)
        inTag = false
        continue
      }
      const safe = final ? buf.length : thinkTagPartialSuffixLen(buf)
      if (safe > 0) { onReasoning(buf.slice(0, safe)); buf = buf.slice(safe) }
      return
    }
  }

  return {
    push(text) { buf += text; drain(false) },
    end() { drain(true) },
  }
}
