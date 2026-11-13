// Fetch helpers da view do OpenRouter. Rotas montadas pelo logos em /openrouter/*.

const BASE = '/openrouter'

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* body não-JSON */ }
  if (!res.ok) {
    // Se o corpo não for JSON (ex.: página de erro 5xx do Cloudflare/proxy),
    // não despeja o HTML inteiro na tela — mensagem curta e legível.
    if (json?.error) throw new Error(json.error)
    if (res.status >= 502 && res.status <= 504) {
      throw new Error(`Servidor indisponível (${res.status}) — tente de novo em instantes.`)
    }
    throw new Error(json?.error || `Erro ${res.status}`)
  }
  return json
}

/** Estado do slot (chave mascarada). */
export const getStatus = () => req('GET', '/status')

/** Salva a chave e, opcionalmente, o modelo — já ativa o slot. */
export const saveKey = ({ api_key, model } = {}) => req('POST', '/save', { api_key, model })

/** Atualiza só o modelo (sem recolar a chave). */
export const setModel = model => req('POST', '/model', { model })

/** Atualiza o catálogo canônico models[] e seu modelo padrão. */
export const setModels = (models, model) => req('POST', '/models', { models, model })

/** Liga/desliga o slot. */
export const setEnabled = enabled => req('POST', '/toggle', { enabled })

/** Testa a conexão ao vivo contra a API do OpenRouter. */
export const testConnection = () => req('POST', '/test')
