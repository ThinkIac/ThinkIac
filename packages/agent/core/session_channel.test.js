/**
 * Testes do canal de sessão — como um agente de fora (subprocesso do Claude,
 * Flow, tarefa de Engineer) fala e pergunta DENTRO de uma sessão de chat.
 *
 * Cobre as três metades que o caminho tem que acertar junto:
 *   1. entrega    (sendToSession: persiste no histórico + emite ao vivo)
 *   2. espera     (pending_questions: uma pergunta por sessão, timeout, cancel)
 *   3. o retorno  (askInSession + resolvePendingQuestion: a resposta digitada
 *                  no chat volta pra chamada que estava pendurada)
 *
 * O bug histórico que motivou (3) está no docblock de handleRunEngineerTask:
 * a pergunta era registrada sob um id sintético que o chat nunca consultava,
 * então a resposta do usuário nunca voltava e o ask_user só morria no timeout.
 * Por isso os testes checam a CHAVE usada, não só o happy path.
 *
 * Roda com: node core/session_channel.test.js
 */

import { sendToSession, getBridgeToken, isValidBridgeToken } from './session_channel.js'
import {
  registerPendingQuestion,
  resolvePendingQuestion,
  cancelPendingQuestion,
  hasPendingQuestion,
  peekPendingQuestion,
} from './pending_questions.js'
import { getMessages, clearSession } from '../memory/session.js'

let passed = 0, failed = 0
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`) }
  else { failed++; console.error(`  ❌ ${msg}`) }
}

const SID = `test:session_channel:${process.pid}`



{
  const out = await sendToSession(SID, 'oi, achei o bug no parser')
  assert(out.persisted === true, 'sendToSession persiste a mensagem no histórico')
  assert(typeof out.live === 'boolean', 'devolve `live` dizendo se houve render ao vivo')

  const msgs = getMessages(SID)
  const last = msgs[msgs.length - 1]
  assert(last?.content === 'oi, achei o bug no parser', 'o texto entregue é o texto gravado')
  assert(last?.role === 'assistant', 'fala de agente entra como assistant por padrão')
}



{
  await sendToSession(SID, 'linha do usuário', 'user')
  await sendToSession(SID, 'role esquisito', 'system')
  const msgs = getMessages(SID)
  assert(msgs[msgs.length - 2]?.role === 'user', 'role "user" é preservado')
  assert(msgs[msgs.length - 1]?.role === 'assistant', 'role desconhecido vira assistant')
}



{
  let threw = false
  try { await sendToSession(null, null) } catch { threw = true }
  assert(threw === false, 'sendToSession não lança nem com sessão/conteúdo nulos')
}


{
  const t = getBridgeToken()
  assert(typeof t === 'string' && t.length > 0, 'getBridgeToken devolve um segredo')
  assert(getBridgeToken() === t, 'o mesmo segredo enquanto o processo vive')
  assert(isValidBridgeToken(t) === true, 'valida o próprio segredo')
  assert(isValidBridgeToken('qualquer-coisa') === false, 'rejeita segredo errado')
  assert(isValidBridgeToken('') === false, 'rejeita vazio')
  assert(isValidBridgeToken(undefined) === false, 'rejeita ausente')
}



{
  const promise = registerPendingQuestion(SID, 'posso apagar a branch antiga?')
  assert(hasPendingQuestion(SID) === true, 'a pergunta fica pendente na sessão')
  assert(peekPendingQuestion(SID)?.question === 'posso apagar a branch antiga?', 'peek devolve a pergunta em aberto')
  assert(hasPendingQuestion(`${SID}:outra`) === false, 'não vaza pra outra sessão')

  const resolved = resolvePendingQuestion(SID, 'pode sim')
  assert(resolved === true, 'resolvePendingQuestion acha a pergunta pela sessão')
  assert(await promise === 'pode sim', 'a chamada pendurada recebe o texto digitado no chat')
  assert(hasPendingQuestion(SID) === false, 'a pendência some depois de respondida')
}



{
  assert(resolvePendingQuestion(`${SID}:vazia`, 'texto') === false, 'sem pergunta pendente, resolve devolve false')
}




{
  const first = registerPendingQuestion(SID, 'primeira?')
  let msg = ''
  try { registerPendingQuestion(SID, 'segunda?') } catch (e) { msg = e.message }
  assert(/já existe uma pergunta pendente/i.test(msg), 'segunda pergunta na mesma sessão é recusada com erro explícito')
  assert(peekPendingQuestion(SID)?.question === 'primeira?', 'a primeira continua valendo')

  cancelPendingQuestion(SID, 'teste')
  await first.catch(() => {})
}



{
  const p = registerPendingQuestion(SID, 'ainda aí?', { timeoutMs: 30 })
  let msg = ''
  await p.catch(e => { msg = e.message })
  assert(/não respondeu/i.test(msg), 'timeout rejeita com "usuário não respondeu"')
  assert(hasPendingQuestion(SID) === false, 'timeout limpa a pendência')
}


{
  const p = registerPendingQuestion(SID, 'segue?')
  const cancelled = cancelPendingQuestion(SID, 'sessão limpa')
  let msg = ''
  await p.catch(e => { msg = e.message })
  assert(cancelled === true, 'cancelPendingQuestion acha a pendência')
  assert(msg === 'sessão limpa', 'a espera rejeita com o motivo do cancelamento')
  assert(cancelPendingQuestion(SID) === false, 'cancelar de novo não faz nada')
}




{
  const { askInSession } = await import('../routes/session_channel.js')
  const before = getMessages(SID).length

  const waiting = askInSession(SID, 'qual conta uso pro deploy?')
  
  await new Promise(r => setTimeout(r, 20))

  assert(hasPendingQuestion(SID) === true, 'askInSession deixa a pergunta pendente na sessão real')
  const msgs = getMessages(SID)
  assert(msgs.length > before, 'a pergunta aparece na conversa do usuário')
  assert(msgs[msgs.length - 1]?.content === 'qual conta uso pro deploy?', 'é o texto da pergunta que aparece')

  resolvePendingQuestion(SID, 'a de produção')
  assert(await waiting === 'a de produção', 'a resposta digitada no chat volta pro chamador')
}

clearSession(SID)

console.log(`\n${passed} passaram, ${failed} falharam`)
process.exit(failed === 0 ? 0 : 1)
