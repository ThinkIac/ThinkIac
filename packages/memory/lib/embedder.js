// memory/lib/embedder.js
// Provedor de embeddings best-effort. O pacote memory não tem LLM/provider
// próprio — reaproveita aurora/llm/llm.js (getEmbedding) quando presente, do
// mesmo jeito que aurora/memory/session.js fazia antes desta refatoração.
// Sem aurora instalado (ou sem pool HTTP configurado para embeddings), a
// busca semântica degrada para substring match — nunca quebra o fluxo.

let _tried = false
let _getEmbedding = null

async function resolveEmbedder() {
  if (_tried) return _getEmbedding
  _tried = true
  try {
    const mod = await import('../../agent/llm/llm.js')
    _getEmbedding = mod.getEmbedding ?? null
  } catch {
    _getEmbedding = null
  }
  return _getEmbedding
}

/** Retorna o vetor de embedding do texto, ou null se nenhum provider estiver disponível. */
export async function embed(text) {
  const fn = await resolveEmbedder()
  if (!fn) return null
  try {
    return await fn(text)
  } catch {
    return null
  }
}

export function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return -1
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  if (!na || !nb) return -1
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}
