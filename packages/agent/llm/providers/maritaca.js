




















































import { flattenToPrompt } from '../text_tool_protocol.js'
import { readWithIdleTimeout } from '../stream_utils.js'
import { getMaritacaBearer } from './maritaca_auth.js'



const BROWSER_HEADERS = {
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Origin': 'https://chat.maritaca.ai',
  'Referer': 'https://chat.maritaca.ai/',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
}

/**
 * Monta os headers de uma requisição pro Maritaca. Nunca deve ser logado —
 * carrega o token em texto puro. O token é obtido por getMaritacaBearer()
 * (maritaca_auth.js) — não depende mais de slot.key nem slot.cookie (auth
 * agora é global ao processo, não por slot/pool).
 *
 * Esquema "Auth", NÃO "Bearer": confirmado inspecionando uma request real do
 * navegador (`authorization: Auth <jwt>`) — é ISSO que causava o 401
 * "Incorrect API key" que parecia problema de conta/plano (chegava a passar
 * validação completa no Auth0, mas o backend do chat.maritaca.ai não
 * reconhece o esquema "Bearer" padrão e cai num fallback que trata o header
 * inteiro como se fosse uma API key da API paga). NÃO "corrigir" pra "Bearer"
 * — não é RFC 6750 padrão, é literal o texto "Auth" que o client deles manda.
 */
async function getMaritacaHeaders({ accept } = {}) {
  return {
    'Content-Type': 'application/json',
    ...BROWSER_HEADERS,
    ...(accept ? { Accept: accept } : {}),
    Authorization: `Auth ${await getMaritacaBearer()}`,
  }
}













function buildMaritacaToolsPreamble(tools) {
  if (!tools?.length) return ''
  const list = tools
    .map(t => `- ${t.name}: ${t.description ?? ''}\n  input_schema: ${JSON.stringify(t.input_schema ?? {})}`)
    .join('\n')

  return [
    '# Sua tarefa',
    'Você é um classificador de intenção. Você NÃO executa nada e NÃO tem acesso a dado nenhum — você apenas LÊ o pedido do usuário e diz a qual intenção ele corresponde, extraindo os campos citados no pedido.',
    '',
    'Responda em um de dois formatos, nunca misturados:',
    '',
    '1. Se o pedido corresponder a uma das intenções catalogadas, sua resposta inteira é APENAS este objeto JSON, sozinho, sem texto antes ou depois e sem cercas markdown:',
    '   {"intencao": "<id da intenção>", "campos": {<campos extraídos do pedido>}}',
    '2. Se nenhuma intenção corresponder, ESQUEÇA este catálogo por completo e responda ao usuário como um assistente normal, em prosa, cumprindo o que ele pediu. NÃO mencione intenção, catálogo nem classificação, e NÃO diga que "nada corresponde": apenas responda o pedido diretamente.',
    '',
    'Não use nenhum recurso interno seu de busca, histórico de conversas ou memória: eles não enxergam os dados deste contexto e produzem classificação errada. Classifique apenas pelo pedido.',
    '',
    'No formato 1, classificar JÁ É a resposta completa e correta — não acrescente nada, não se desculpe, não comente, não chame função nativa. Uma intenção por vez.',
    '',
    '# Catálogo de intenções (id: a que tipo de pedido corresponde)',
    list,
    '',
    'Aplique o formato acima ao ÚLTIMO pedido do usuário na conversa abaixo.',
  ].join('\n')
}

function buildMaritacaContent({ system, messages, tools }) {
  return flattenToPrompt(system, messages, buildMaritacaToolsPreamble(tools))
}



function tryJson(s) { try { return JSON.parse(s) } catch { return null } }

/** Primeiro bloco {...} balanceado de um texto. */
function firstBraceBlock(text) {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') { depth--; if (depth === 0) return text.slice(start, i + 1) }
  }
  return null
}

/**
 * Normaliza os vários formatos de saída em uma lista [{name, input}]:
 *   - o formato pedido pelo preâmbulo de classificação:
 *     {"intencao": "<id>", "campos": {...}};
 *   - e os formatos herdados que o Sabiá às vezes emite quando foge do padrão,
 *     ainda reconhecíveis: {"tool_calls": [...]}, wrapper singular
 *     ({"tool_call": {...}}/{"tool_call": [...]}) e o objeto solto sem wrapper
 *     ({"name": "plan_set", "input": {...}}).
 * Sempre devolve um array (vazio se não reconhecer nada).
 */
function normalizeToolCallList(obj) {
  if (!obj) return []
  if (Array.isArray(obj)) return obj
  
  if (obj.intencao) return [{ name: obj.intencao, input: obj.campos ?? {} }]
  if (Array.isArray(obj.tool_calls)) return obj.tool_calls
  if (Array.isArray(obj.tool_call)) return obj.tool_call
  if (obj.tool_call && typeof obj.tool_call === 'object') return [obj.tool_call]
  if (obj.name) return [obj]
  return []
}

/**
 * Converte a saída de texto do modelo no array de tool_calls (formato
 * OpenAI-like). O caminho principal hoje é o objeto de classificação
 * {"intencao": "<id>", "campos": {...}} que o preâmbulo pede; também aceita
 * JSON com aspas duplas ou o repr de dict do Python (aspas simples) e os
 * formatos herdados ({"tool_calls": [...]}, {"name": ...}) — ver
 * normalizeToolCallList. É isso que evita o JSON vazar como texto puro pro
 * usuário quando o Sabiá não segue o padrão à risca. Retorna [] se não houver
 * nenhuma chamada reconhecível.
 */
function parseToolCallsFromStdout(stdout) {
  
  
  const s = String(stdout ?? '').replace(/```[a-zA-Z]*\n?/g, '').trim()
  if (!s) return []
  
  
  
  
  
  
  if (
    !/intencao\s*['"]?\s*:/.test(s) &&
    !/tool_calls?\s*['"]?\s*:/.test(s) &&
    !/\bname\b\s*['"]?\s*:\s*['"]/.test(s)
  ) return []

  let obj = tryJson(s)
  if (!obj) {
    const block = firstBraceBlock(s)
    if (block) obj = tryJson(block) || tryJson(block.replace(/'/g, '"'))
  }

  return normalizeToolCallList(obj)
    .filter(tc => tc?.name)
    
    
    
    .slice(0, 1)
    .map((tc, i) => ({
      id: `maritaca_call_${Date.now()}_${i}`,
      type: 'function',
      function: { name: tc.name, arguments: JSON.stringify(tc.input ?? {}) },
    }))
}



/**
 * Lê o SSE de /chat/message. Separa raciocínio (onProgress {type:'reasoning'})
 * de resposta (onToken), e captura tool_calls do stdout do code_execution.
 * Assim que captura tool_calls, ABORTA o stream (corta o loop do modelo) e
 * retorna. Devolve { reasoning, answer, toolCalls, nativeCustomCall }.
 *
 * `toolNames` é o Set das tools custom do Agent deste turno — usado pra
 * detectar tentativas de function-calling NATIVO (que o backend rejeita).
 */
async function consumeMaritacaStream(res, { onToken, onProgress, toolNames, abortSignal = null }) {
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const names = toolNames instanceof Set ? toolNames : new Set()

  let buffer = ''
  let inReasoning = false
  let reasoningDeltas = ''
  const reasoningChunks = []
  let answerRaw = ''
  let toolCalls = []
  let nativeCustomCall = false
  let suppressAnswer = false
  let aborted = false

  const stop = async () => {
    aborted = true
    try { await reader.cancel() } catch { /* já fechado */ }
  }

  
  
  
  
  
  
  
  
  
  
  
  
  let dupBuf = ''

  
  
  const echoStart = (s) => {
    let best = s.length
    for (const rc of reasoningChunks) {
      if (!rc) continue
      const idx = s.indexOf(rc)
      if (idx >= 0 && idx < best) best = idx
      for (let i = Math.max(0, s.length - rc.length + 1); i < best; i++) {
        if (rc.startsWith(s.slice(i))) { best = i; break }
      }
    }
    return best
  }

  
  
  const echoAtStart = (s) => {
    let best = 0
    for (const rc of reasoningChunks) {
      if (rc && rc.length > best && s.startsWith(rc)) best = rc.length
    }
    return best
  }

  const emitAnswer = (text) => {
    dupBuf += text
    while (dupBuf) {
      const hitLen = echoAtStart(dupBuf)
      
      
      if (reasoningChunks.some(rc => rc && rc.length > dupBuf.length && rc.startsWith(dupBuf))) break
      if (hitLen) { dupBuf = dupBuf.slice(hitLen); continue }
      const cut = echoStart(dupBuf)
      if (cut === 0) break 
      answerRaw += dupBuf.slice(0, cut)
      if (onToken) onToken(dupBuf.slice(0, cut))
      dupBuf = dupBuf.slice(cut)
    }
  }

  
  
  
  const flushAnswer = () => {
    const hitLen = echoAtStart(dupBuf)
    const rest = dupBuf.slice(hitLen)
    dupBuf = ''
    if (rest) {
      answerRaw += rest
      if (onToken) onToken(rest)
    }
  }

  const handle = async (chunk) => {
    
    if ('filenames' in chunk) return

    
    if (chunk.event === 'thinking' || chunk?.data?.status === 'reasoning') {
      inReasoning = true
      return
    }

    
    if (typeof chunk.reasoning === 'string') {
      reasoningChunks.push(chunk.reasoning)
      inReasoning = false
      return
    }

    
    if ('tool' in chunk) {
      if (chunk.tool === 'reasoning') { inReasoning = false; return }

      
      
      
      if (chunk.tool === 'code_exec_python') {
        const out = typeof chunk.stdout === 'string' ? chunk.stdout
                  : typeof chunk.content === 'string' ? chunk.content
                  : null
        if (out != null) {
          const parsed = parseToolCallsFromStdout(out)
          if (parsed.length) {
            toolCalls = parsed
            if (onProgress) for (const tc of parsed) {
              let input = {}
              try { input = JSON.parse(tc.function.arguments) } catch {}
              onProgress({ type: 'tool-step', name: tc.function.name, input })
            }
            await stop()   
          }
        }
        return 
      }

      
      
      
      
      const content = String(chunk.content ?? '')
      if (names.has(chunk.tool) || /unknown tool/i.test(content)) {
        nativeCustomCall = true
        
        
        
        
        
        suppressAnswer = true
        return
      }

      
      if (onProgress) onProgress({ type: 'tool-result', name: chunk.tool, content })
      return
    }

    
    if (typeof chunk.text === 'string') {
      if (inReasoning) {
        reasoningDeltas += chunk.text
        if (onProgress) onProgress({ type: 'reasoning', text: chunk.text })
      } else if (!suppressAnswer) {
        emitAnswer(chunk.text)
      }
    }
  }

  outer:
  while (!aborted) {
    let result
    
    
    try {
      result = await readWithIdleTimeout(reader, undefined, abortSignal)
    } catch (e) {
      try { await reader.cancel() } catch { /* já fechado */ }
      
      
      break
    }
    if (result.done) break
    buffer += decoder.decode(result.value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop()
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue
      let chunk
      try { chunk = JSON.parse(data) } catch { continue }
      await handle(chunk)
      if (aborted) break outer
    }
  }

  
  
  
  flushAnswer()

  
  
  
  let answer = answerRaw
  for (const rc of reasoningChunks) {
    if (rc && answer.includes(rc)) answer = answer.split(rc).join('')
  }
  answer = answer.trim()

  const reasoning = reasoningChunks.length ? reasoningChunks.join('\n\n') : reasoningDeltas
  return { reasoning: reasoning || null, answer, toolCalls, nativeCustomCall }
}



async function createMaritacaChat(slot, abortSignal) {
  const res = await fetch(`${slot.url}/chat/create`, {
    method: 'POST',
    headers: await getMaritacaHeaders({ accept: '*/*' }),
    signal: abortSignal ?? undefined,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const err = new Error(`[maritaca] HTTP ${res.status} ao criar chat: ${text}`)
    err.status = res.status
    throw err
  }

  const json = await res.json()
  const chatId = json?.chat_data?.chat_id
  if (!chatId) throw new Error('[maritaca] resposta de /chat/create sem chat_id')
  return chatId
}

async function sendMaritacaMessage(slot, chatId, content, { model, onToken, onProgress, toolNames, codeExecution = false, abortSignal } = {}) {
  const payload = {
    chat_id: chatId,
    content,
    model: model ?? slot.model ?? 'sabia-4-thinking',
    position: 2,
    is_user: true,
    files: [],
    web_search: false,
    
    
    code_execution: !!codeExecution,
    data_ocean: false,
    reasoning: true,
    use_competitor: false,
    source_interface: 'web',
    deep_research: false,
    deep_research_mode: 'full',
    panorama: false,
    panorama_decline: false,
    deep_research_proposals: false,
    deep_research_decline: false,
    delta: true,
  }

  const res = await fetch(`${slot.url}/chat/message`, {
    method: 'POST',
    headers: await getMaritacaHeaders({ accept: 'text/event-stream' }),
    body: JSON.stringify(payload),
    signal: abortSignal ?? undefined,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const err = new Error(`[maritaca] HTTP ${res.status} ao enviar mensagem: ${text}`)
    err.status = res.status
    throw err
  }

  return consumeMaritacaStream(res, { onToken, onProgress, toolNames, abortSignal })
}






const MAX_TOOL_ATTEMPTS = 2

function buildResponse(reasoning, content, toolCalls, chainModel) {
  return {
    choices: [{
      message: {
        content,
        reasoning_content: reasoning ?? undefined,
        tool_calls: toolCalls.length ? toolCalls : undefined,
      },
      finish_reason: toolCalls.length ? 'tool_calls' : 'stop',
    }],
    model: chainModel,
  }
}

/**
 * Executa 1 turno completo (create chat efêmero + send message + parse) e
 * devolve o mesmo shape "OpenAI chat-completions" que todo outro provider
 * produz. Único ponto de entrada exportado — usado tanto por callLLM quanto
 * por callLLMStream em llm.js. Com o enquadramento de classificação (nota 4) o
 * modelo devolve o objeto {"intencao":...,"campos":...} em texto de forma
 * confiável (10/10 na spike); o parse fica em parseToolCallsFromStdout.
 *
 *   - SEM tools (chat puro): streaming ao vivo (onToken + onProgress).
 *   - COM tools: raciocínio streama ao vivo (onProgress). A RESPOSTA streama
 *     ao vivo também, EXCETO quando o começo parece o objeto JSON de
 *     classificação — '{', uma cerca ```` ``` ```` etc. (ver looksLikeCall/
 *     bufToken) — nesse caso fica bufferizada até o fim da tentativa; se
 *     confirmar uma intenção, o JSON cru não é mostrado, se for prosa legítima
 *     é reemitida de uma vez. O retry (raro) só dispara se o modelo escorregar
 *     pro function-calling NATIVO sem produzir nenhuma classificação.
 */
export async function runMaritacaTurn(slot, { chainModel, system, messages, tools = [], onToken = null, onProgress = null, abortSignal = null }) {
  
  
  
  const offeredTools = (tools ?? []).filter(t => t.name !== 'run_parallel')
  const content = buildMaritacaContent({ system, messages, tools: offeredTools })

  
  if (!offeredTools.length) {
    const chatId = await createMaritacaChat(slot, abortSignal)
    const { reasoning, answer } = await sendMaritacaMessage(slot, chatId, content, {
      model: chainModel, onToken, onProgress, codeExecution: false, abortSignal,
    })
    return buildResponse(reasoning, answer, [], chainModel)
  }

  
  
  
  
  
  
  
  
  const toolNames = new Set(offeredTools.map(t => t.name))
  let last = null

  
  
  const RETRY_NUDGE = '\n\nATENÇÃO: sua resposta anterior não seguiu o formato (tentou chamar uma função nativa, que não existe aqui). NÃO se desculpe e NÃO comente o erro. Se o último pedido corresponde a uma intenção do catálogo, responda AGORA com APENAS o objeto JSON {"intencao": "<id>", "campos": {<campos>}}, sozinho, sem texto antes ou depois e sem cercas markdown. Uma intenção por vez.'

  for (let attempt = 0; attempt < MAX_TOOL_ATTEMPTS; attempt++) {
    const attemptContent = attempt === 0 ? content : content + RETRY_NUDGE
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    const looksLikeCall = txt =>
      txt[0] === '{' || txt[0] === '`' || /^print\s*\(/i.test(txt) || /"tool_calls?"/.test(txt)
    const answerBuf = []
    let liveMode = false
    let checked = false
    const bufToken = t => {
      if (liveMode) { onToken?.(t); return }
      answerBuf.push(t)
      if (checked) return
      const trimmed = answerBuf.join('').trimStart()
      
      if (trimmed.length < 8) return
      checked = true
      if (!looksLikeCall(trimmed)) {
        liveMode = true
        for (const b of answerBuf) onToken?.(b)
        answerBuf.length = 0
      }
    }

    
    
    
    const chatId = await createMaritacaChat(slot, abortSignal)
    const { reasoning, answer, toolCalls, nativeCustomCall } = await sendMaritacaMessage(slot, chatId, attemptContent, {
      model: chainModel, onToken: bufToken, onProgress, toolNames, codeExecution: false, abortSignal,
    })

    
    
    
    let calls = toolCalls
    let fromText = false
    if (!calls.length) {
      const parsed = parseToolCallsFromStdout(answer)
      if (parsed.length) { calls = parsed; fromText = true }
    }

    const isLast = attempt === MAX_TOOL_ATTEMPTS - 1
    
    if (nativeCustomCall && !calls.length && !isLast) { last = { reasoning, answer, answerBuf }; continue }

    if (calls.length) {
      if (fromText && onProgress) for (const tc of calls) {
        let input = {}
        try { input = JSON.parse(tc.function.arguments) } catch {}
        onProgress({ type: 'tool-step', name: tc.function.name, input })
      }
      return buildResponse(reasoning, '', calls, chainModel)
    }
    
    
    
    
    for (const t of answerBuf) onToken?.(t)
    return buildResponse(reasoning, answer, [], chainModel)
  }

  
  
  if (last) {
    for (const t of last.answerBuf) onToken?.(t)
    return buildResponse(last.reasoning, last.answer, [], chainModel)
  }
  return buildResponse(null, '', [], chainModel)
}

export function isMaritacaProvider(providerName) {
  return providerName === 'maritaca'
}
