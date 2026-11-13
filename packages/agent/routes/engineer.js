








import { askInSession, authorizeBridge } from './session_channel.js'

export async function engineerAsk(req, res) {
  /**
   * @register_router engineer/ask
   * @method POST
   */
  if (!authorizeBridge(req, res)) return
  const { session_id, question, timeout_ms } = req.body ?? {}

  if (!session_id || !question) {
    res.status(400).json({ success: false, error: '`session_id` e `question` são obrigatórios' })
    return
  }

  try {
    const answer = await askInSession(session_id, question, { timeoutMs: timeout_ms })
    res.json({ success: true, answer })
  } catch (e) {
    res.status(200).json({ success: false, error: e.message })
  }
}
