



























import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const PKG_DIR    = dirname(fileURLToPath(import.meta.url))
const TOKEN_URL  = 'https://auth.maritaca.ai/oauth/token'
const CLIENT_ID  = 'qBJrntH9D92AA5n0PR0ph1h54hSqP3C6'
const STORE_FILE = join(PKG_DIR, '..', '..', 'secrets', 'maritaca_tokens.json')
const REFRESH_MARGIN_MS = 5 * 60 * 1000 

/** Lê o estado do disco sem lançar — null se não houver nada persistido ainda. */
function peek() {
  if (!existsSync(STORE_FILE)) return null
  try { return JSON.parse(readFileSync(STORE_FILE, 'utf8')) } catch { return null }
}

function load() {
  const stored = peek()
  if (stored) return stored
  const seed = process.env.MARITACA_REFRESH_TOKEN
  if (!seed) {
    throw new Error(
      '[maritaca_auth] secrets/maritaca_tokens.json não existe e a env var ' +
      'MARITACA_REFRESH_TOKEN não está configurada — sem refresh_token pra iniciar.'
    )
  }
  return { refresh_token: seed, expires_at: 0 }
}

function mask(secret) {
  const s = String(secret ?? '')
  if (!s) return ''
  if (s.length <= 22) return `${s.slice(0, 4)}…${s.slice(-2)}`
  return `${s.slice(0, 12)}…${s.slice(-6)}`
}

function save(data) {
  const dir = dirname(STORE_FILE)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), 'utf8')
  chmodSync(STORE_FILE, 0o600) 
}

let inFlight = null 

/**
 * Troca o refresh_token atual por um access_token novo via Auth0. Chamada
 * automaticamente por getMaritacaBearer() quando o access_token salvo está
 * ausente/perto de expirar; também exportada pra bootstrap explícito quando
 * só temos um refresh_token cru sem access_token de uma troca ao vivo — ver
 * seedRefreshToken().
 */
export async function exchangeRefreshToken() {
  if (inFlight) return inFlight
  inFlight = (async () => {
    const tokens = load()

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: CLIENT_ID,
        refresh_token: tokens.refresh_token,
      }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`[maritaca_auth] falha ao trocar refresh_token por access_token (${res.status}): ${text}`)
    }

    const data = await res.json()
    const updated = {
      ...data,
      
      
      refresh_token: data.refresh_token || tokens.refresh_token,
      expires_at: Date.now() + (data.expires_in ?? 86400) * 1000,
    }
    save(updated)
    return updated
  })()
  try {
    return await inFlight
  } finally {
    inFlight = null
  }
}

/** Devolve sempre um access_token válido, renovando só quando falta < 5min pro expirar. */
export async function getMaritacaBearer() {
  const tokens = load()
  if (tokens.access_token && tokens.expires_at - REFRESH_MARGIN_MS > Date.now()) {
    return tokens.access_token
  }
  const fresh = await exchangeRefreshToken()
  return fresh.access_token
}

/**
 * Grava só um refresh_token cru (colado pelo usuário no formato antigo, ou
 * seed via env var) — sem access_token de uma troca ao vivo pra usar direto.
 * expires_at zerado força getMaritacaBearer() a trocar por um access_token na
 * próxima chamada, em vez de esperar o refresh automático. Prefira
 * seedTokenBundle() quando tiver o access_token disponível (bookmarklet/
 * console/login assistido atualizados) — evita essa troca extra na hora do
 * seed (não muda nada depois, já que o refresh automático funciona igual pros
 * dois casos — ver nota no topo do arquivo).
 */
export function seedRefreshToken(token) {
  const trimmed = String(token ?? '').trim()
  if (!trimmed) throw new Error('[maritaca_auth] refresh_token vazio.')
  save({ refresh_token: trimmed, expires_at: 0 })
}

/**
 * Grava um bundle { access_token, id_token, refresh_token, expires_in } que
 * já veio de UMA ÚNICA troca OAuth (login interativo capturado ao vivo pelo
 * login_capture.js) — o access_token AQUI já é válido de verdade, é o mesmo
 * que o navegador do usuário está usando. Evita uma troca extra e desnecessária
 * logo no seed (o access_token que acabou de sair do login já serve).
 */
export function seedTokenBundle({ access_token, id_token, refresh_token, expires_in } = {}) {
  const token = String(refresh_token ?? '').trim()
  if (!token) throw new Error('[maritaca_auth] bundle sem refresh_token.')
  if (!access_token) throw new Error('[maritaca_auth] bundle sem access_token.')
  save({
    access_token,
    id_token,
    refresh_token: token,
    token_type: 'Bearer',
    expires_at: Date.now() + (expires_in ?? 86400) * 1000,
  })
}

/** Estado mascarado pra UI — nunca devolve o refresh_token/access_token crus. */
export function getMaritacaAuthStatus() {
  const tokens = peek() ?? (process.env.MARITACA_REFRESH_TOKEN ? { refresh_token: process.env.MARITACA_REFRESH_TOKEN, expires_at: 0 } : null)
  if (!tokens) {
    return { configured: false, refreshTokenPreview: null, accessTokenValid: false, accessTokenExpiresAt: null, accessTokenExpiresInSeconds: null }
  }
  const now = Date.now()
  const validAccess = !!tokens.access_token && tokens.expires_at - REFRESH_MARGIN_MS > now
  return {
    configured: true,
    refreshTokenPreview: mask(tokens.refresh_token),
    accessTokenValid: validAccess,
    accessTokenExpiresAt: tokens.expires_at ? new Date(tokens.expires_at).toISOString() : null,
    accessTokenExpiresInSeconds: tokens.expires_at ? Math.floor((tokens.expires_at - now) / 1000) : null,
  }
}



if (import.meta.url === `file://${process.argv[1]}`) {
  getMaritacaBearer()
    .then((t) => console.log(t))
    .catch((e) => {
      console.error(e.message)
      process.exit(1)
    })
}
