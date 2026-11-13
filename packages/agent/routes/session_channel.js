



















import { sendToSession, isValidBridgeToken } from '../core/session_channel.js'
import { registerPendingQuestion } from '../core/pending_questions.js'
import { sendProactive } from '../channels/channels.js'





export function authorizeBridge(req, res) {
  const header = String(req.headers?.authorization ?? '')
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.headers?.['x-agent-session-token']
  if (isValidBridgeToken(token)) return true
  res.status(403).json({ success: false, error: 'Token da ponte de sessão ausente ou inválido (AGENT_SESSION_TOKEN).' })
  return false
}

/**
 * Núcleo do ask, compartilhado com routes/engineer.js (/agent/engineer/ask,
 * mantida por compatibilidade). Publica a pergunta na própria sessão — é o que
 * dá contexto pro usuário: ele vê a pergunta na conversa e responde ali mesmo,
 * como responderia a qualquer mensagem.
 *
 * @returns {Promise<string>} o texto da resposta do usuário
 */
export async function askInSession(sessionId, question, { timeoutMs } = {}) {
  
  
  const promise = registerPendingQuestion(sessionId, question, {
    timeoutMs: timeoutMs ?? undefined, 
  })

  
  
  sendToSession(sessionId, question, 'assistant').catch(() => {})
  sendProactive(
    `Pergunta da sessão "${sessionId}":\n\n${question}\n\n(Responda normalmente pelo chat — a resposta volta pra tarefa em andamento.)`
  ).catch(() => {})

  return await promise
}

export async function sessionSay(req, res) {
  /**
   * @register_router session/say
   * @method POST
   * @description Entrega uma mensagem numa sessão de chat (persistida + ao vivo) e responde na hora. Body: { session_id, message, role? }.
   */
  if (!authorizeBridge(req, res)) return
  const { session_id, message, role } = req.body ?? {}

  if (!session_id || !message) {
    res.status(400).json({ success: false, error: '`session_id` e `message` são obrigatórios' })
    return
  }

  const delivery = await sendToSession(session_id, message, role === 'user' ? 'user' : 'assistant')
  res.json({ success: true, ...delivery })
}

export async function sessionAsk(req, res) {
  /**
   * @register_router session/ask
   * @method POST
   * @description Pergunta na sessão e SEGURA a resposta HTTP até o usuário responder (ou o timeout estourar). Body: { session_id, question, timeout_ms? }.
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

export async function sessionTools(req, res) {
 /**
  * @register_router session/tools
  * @method POST
  * @description Ferramentas vinculadas a um turno ativo, autenticadas por capacidade efêmera.
  */
 const {getTurnTools}=await import('../core/turn_tools.js');
 const header=String(req.headers?.authorization||'');
 const turn=getTurnTools(header.startsWith('Bearer ')?header.slice(7):'');
 if(!turn)return res.status(403).json({success:false,error:'Turno ausente ou encerrado.'});
 try {
  const body=req.body||{};
  if(body.operation==='list')return res.json({success:true,tools:turn.tools});
  if(body.operation!=='call')return res.status(400).json({success:false,error:'Operação inválida.'});
  const result=await turn.call(body.name,body.args||{});
  return res.json({success:true,result});
 }catch(e){return res.status(400).json({success:false,error:e.message});}
}
