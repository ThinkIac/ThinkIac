






















import { randomUUID } from 'crypto'
import { pushMessage } from '../memory/session.js'













let _bridgeToken = null

export function getBridgeToken() {
  if (!_bridgeToken) _bridgeToken = randomUUID()
  return _bridgeToken
}

/** true se `token` é o segredo desta instância. Comparação sobre o valor já gerado. */
export function isValidBridgeToken(token) {
  return Boolean(token) && token === getBridgeToken()
}

/**
 * Entrega `content` na sessão `sessionId`.
 *
 * @param {string} sessionId - id da sessão de chat (o real, o mesmo que o front usa)
 * @param {string} content   - texto da mensagem (Markdown, como qualquer mensagem do chat)
 * @param {'assistant'|'user'} [role] - de quem é a fala; default 'assistant'
 * @returns {Promise<{ persisted: boolean, live: boolean }>}
 */
export async function sendToSession(sessionId, content, role = 'assistant') {
  const sid = String(sessionId || 'default')
  const text = content == null ? '' : String(content)
  const kind = role === 'user' ? 'user' : 'assistant'
  const out = { persisted: false, live: false }

  try {
    pushMessage(sid, { role: kind, content: text })
    out.persisted = true
  } catch { /* segue pro render ao vivo — uma metade ainda é melhor que nenhuma */ }

  try {
    const chat = await import('../routes/chat.js')
    if (typeof chat.emit === 'function') {
      chat.beginEventCycle?.(sid)
      if (kind === 'user') {
        chat.emit(sid, 'user_message', { text, session_id: sid })
      } else {
        
        
        chat.emit(sid, 'start', { session_id: sid })
        chat.emit(sid, 'token', { text, session_id: sid })
        chat.emit(sid, 'commit', {})
        chat.emit(sid, 'done', { response: text, session_id: sid })
      }
      out.live = true
    }
  } catch { /* persistência já cobriu o piso */ }

  return out
}
