



















































import { eventCall as $ } from '../host/agent_host.js'
import fs from 'node:fs'
import path from 'node:path'
import { getConfig, getDefaultModel, getEmbedModel } from '../utils/config.js'
import {
  buildSlots,
  getNextSlot,
  reportSlotSuccess,
  reportSlotFailure,
  notifySlotDisabled,
} from './llm_keys.js'
import { isMaritacaProvider, runMaritacaTurn } from './providers/maritaca.js'
import { runCliSlot } from './llm.js'
import { isCreditFailure, cooldownFor, parseRetryAt } from './cli_failures.js'
import { serializeToolResult } from './tool_results.js'
import {
  expandModelChain, isElm,
} from './elm.js'
import { getFreshModelCatalog, resolveGlobalModelFresh } from './model_registry.js'
import { resolveModel } from './model_catalog.js'



const FATAL_ERRORS = new Set([401, 402, 403, 429])


const MEDIA_TYPES = {
  
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image',
  '.webp': 'image', '.gif': 'image',
  
  '.wav': 'audio', '.mp3': 'audio', '.ogg': 'audio',
  '.flac': 'audio', '.aac': 'audio', '.m4a': 'audio',
  '.aiff': 'audio', '.pcm': 'audio', '.webm': 'audio',
  
  '.pdf': 'pdf',
  
  '.mp4': 'video', '.mpeg': 'video', '.mov': 'video',
  '.mkv': 'video',
}

const MIME_MAP = {
  
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif',
  
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  '.flac': 'audio/flac', '.aac': 'audio/aac', '.m4a': 'audio/mp4',
  '.aiff': 'audio/aiff', '.pcm': 'audio/L16', '.webm': 'audio/webm',
  
  '.pdf': 'application/pdf',
  
  '.mp4': 'video/mp4', '.mpeg': 'video/mpeg', '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
}


const AUDIO_FMT = {
  '.wav': 'wav', '.mp3': 'mp3', '.ogg': 'ogg', '.flac': 'flac',
  '.aac': 'aac', '.m4a': 'm4a', '.aiff': 'aiff', '.pcm': 'pcm16',
  '.webm': 'webm',
}



const PATH_REGEX = /(?:^|[\s"'(,])((\.{0,2}[/\\][\w\-./\\]+|[A-Za-z]:\\[\w\-./\\]+)\.(?:png|jpe?g|webp|gif|wav|mp3|ogg|flac|aac|m4a|aiff|pcm|webm|pdf|mp4|mpeg|mov|mkv))(?:$|[\s"').,])/gi



/**
 * Retorna o tipo de mídia ('image'|'audio'|'pdf'|'video'|null) de um path/url.
 */
function classifyMedia(src) {
  if (!src || typeof src !== 'string') return null
  const ext = path.extname(src.split('?')[0]).toLowerCase()
  return MEDIA_TYPES[ext] ?? null
}

/**
 * Detecta se uma string parece ser um path de arquivo local (não URL, não data:).
 */
function isLocalPath(str) {
  if (typeof str !== 'string') return false
  if (str.startsWith('http://') || str.startsWith('https://') || str.startsWith('data:')) return false
  const ext = path.extname(str).toLowerCase()
  return ext in MEDIA_TYPES
}

/**
 * Lê arquivo local e retorna base64 puro.
 */
function readBase64(filePath) {
  return fs.readFileSync(filePath).toString('base64')
}

/**
 * Converte um path (local ou URL) no content block correto para a API OpenRouter.
 *
 * @param {string} src   - path local ou URL pública
 * @param {string} [hint] - tipo forçado ('image'|'audio'|'pdf'|'video')
 * @returns {object|null}  content block ou null se não reconhecido
 */
function pathToBlock(src, hint) {
  const type = hint ?? classifyMedia(src)
  if (!type) return null

  const ext = path.extname(src.split('?')[0]).toLowerCase()
  const mime = MIME_MAP[ext] ?? 'application/octet-stream'
  const isLocal = isLocalPath(src)

  switch (type) {
    case 'image': {
      const url = isLocal ? `data:${mime};base64,${readBase64(src)}` : src
      return { type: 'image_url', image_url: { url } }
    }
    case 'audio': {
      
      if (!isLocal) {
        
        console.warn(`[LLM] Audio via URL não suportado pelo OpenRouter: ${src}. Use path local.`)
        return null
      }
      const fmt = AUDIO_FMT[ext] ?? 'wav'
      return { type: 'input_audio', input_audio: { data: readBase64(src), format: fmt } }
    }
    case 'pdf': {
      const fileData = isLocal ? `data:application/pdf;base64,${readBase64(src)}` : src
      const filename = path.basename(src)
      return { type: 'file', file: { filename, file_data: fileData } }
    }
    case 'video': {
      const url = isLocal ? `data:${mime};base64,${readBase64(src)}` : src
      return { type: 'video_url', video_url: { url } }
    }
    default:
      return null
  }
}



/**
 * Escaneia um texto livre em busca de paths de arquivo embutidos.
 * Retorna { cleanText, foundPaths[] }
 */
function scanTextForPaths(text) {
  if (typeof text !== 'string') return { cleanText: text, foundPaths: [] }
  const foundPaths = []
  const cleanText = text.replace(PATH_REGEX, (match, filePath) => {
    if (fs.existsSync(filePath)) {
      foundPaths.push(filePath)
    }
    return match 
  })
  return { cleanText, foundPaths }
}

/**
 * Processa uma mensagem e expande qualquer referência a arquivo no content.
 *
 * Regras de transformação:
 *   string simples que é path  → array [block]
 *   string simples com texto   → array [text block] + blocks extras se paths embutidos
 *   array: cada item inspecionado recursivamente
 *   block estruturado: url/data interna resolvida se for path local
 */
function resolveMessageContent(content) {
  
  if (typeof content === 'string') {
    
    if (isLocalPath(content) && fs.existsSync(content)) {
      const block = pathToBlock(content)
      return block ? [block] : [{ type: 'text', text: content }]
    }
    
    const { foundPaths } = scanTextForPaths(content)
    if (foundPaths.length === 0) return content 

    const blocks = [{ type: 'text', text: content }]
    for (const p of foundPaths) {
      const block = pathToBlock(p)
      if (block) blocks.push(block)
    }
    return blocks
  }

  
  if (Array.isArray(content)) {
    const result = []
    for (const entry of content) {
      
      if (typeof entry === 'string') {
        if (isLocalPath(entry) && fs.existsSync(entry)) {
          const block = pathToBlock(entry)
          if (block) { result.push(block); continue }
        }
        const { foundPaths } = scanTextForPaths(entry)
        result.push({ type: 'text', text: entry })
        for (const p of foundPaths) {
          const block = pathToBlock(p)
          if (block) result.push(block)
        }
        continue
      }

      
      if (entry?.type === 'text' && typeof entry.text === 'string') {
        const { foundPaths } = scanTextForPaths(entry.text)
        result.push(entry)
        for (const p of foundPaths) {
          const block = pathToBlock(p)
          if (block) result.push(block)
        }
        continue
      }

      
      if (entry?.type === 'image_url') {
        const url = entry.image_url?.url ?? entry.imageUrl?.url ?? ''
        if (isLocalPath(url)) {
          const block = pathToBlock(url, 'image')
          result.push(block ?? entry)
          continue
        }
        result.push(entry); continue
      }

      
      if (entry?.type === 'input_audio') {
        const data = entry.input_audio?.data ?? ''
        if (isLocalPath(data)) {
          const block = pathToBlock(data, 'audio')
          result.push(block ?? entry)
          continue
        }
        result.push(entry); continue
      }

      
      if (entry?.type === 'file') {
        const fd = entry.file?.file_data ?? entry.file?.fileData ?? ''
        if (isLocalPath(fd)) {
          const block = pathToBlock(fd, 'pdf')
          result.push(block ?? entry)
          continue
        }
        result.push(entry); continue
      }

      
      if (entry?.type === 'video_url') {
        const url = entry.video_url?.url ?? entry.videoUrl?.url ?? ''
        if (isLocalPath(url)) {
          const block = pathToBlock(url, 'video')
          result.push(block ?? entry)
          continue
        }
        result.push(entry); continue
      }

      result.push(entry)
    }
    return result
  }

  return content
}

/**
 * Aplica resolveMessageContent a todas as mensagens.
 */
function resolveMessagePaths(messages) {
  return messages.map(msg => {
    if (!msg?.content) return msg
    const resolved = resolveMessageContent(msg.content)
    return resolved === msg.content ? msg : { ...msg, content: resolved }
  })
}



/**
 * Inspeciona mensagens resolvidas + parâmetros explícitos para determinar
 * quais modalities são necessárias.
 *
 * Retorna o array de modalities ou null (não injeta se não necessário).
 *
 * Regra:
 *   - Se o caller já passou modalities → usa sem alteração
 *   - Se há bloco input_audio nas mensagens + modelo tem audio output → ["text","audio"]
 *   - Se imageConfig presente ou modelo é image-gen → ["image","text"]
 *   - Caso contrário → null (API usa default text)
 */
function detectRequiredModalities({ messages, modalities, imageConfig, audioConfig, model }) {
  if (modalities) return modalities 

  
  if (imageConfig) return ['image', 'text']

  
  if (audioConfig) return ['text', 'audio']

  
  
  return null
}



/**
 * Salva uma string base64 (ou data URL) como arquivo binário.
 * Retorna o path salvo.
 */
function saveGeneratedFile(dataOrUrl, outputDir = './generated', prefix = 'out') {
  let b64, ext = 'bin'

  if (typeof dataOrUrl === 'string' && dataOrUrl.startsWith('data:')) {
    const [header, data] = dataOrUrl.split(',')
    b64 = data
    const mime = header.replace('data:', '').replace(';base64', '')
    const mimeToExt = {
      'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
      'audio/wav': 'wav', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/flac': 'flac',
      'audio/mp4': 'm4a', 'audio/pcm': 'pcm', 'video/mp4': 'mp4',
    }
    ext = mimeToExt[mime] ?? 'bin'
  } else {
    b64 = dataOrUrl
  }

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })

  const ts = Date.now()
  const rand = Math.random().toString(36).slice(2, 6)
  const file = path.join(outputDir, `${prefix}-${ts}-${rand}.${ext}`)
  fs.writeFileSync(file, Buffer.from(b64, 'base64'))
  return file
}

/**
 * Baixa um vídeo de uma URL e salva em outputDir.
 * Retorna o path salvo.
 */
async function downloadVideo(url, outputDir = './generated', authHeader = null) {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })
  const ts = Date.now()
  const rand = Math.random().toString(36).slice(2, 6)
  const file = path.join(outputDir, `video_${ts}_${rand}.mp4`)
  const headers = authHeader ? { Authorization: authHeader } : {}
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`Falha ao baixar vídeo: HTTP ${res.status}`)
  const buf = await res.arrayBuffer()
  fs.writeFileSync(file, Buffer.from(buf))
  return file
}



/**
 * Monta o body da requisição para /api/v1/chat/completions.
 * Inclui todos os campos multimodal quando presentes.
 */
function buildRequestBody({
  chainModel, system, messages, tools,
  stream = false, config, requestOptions = null,
  modalities = null, imageConfig = null, audioConfig = null,
  plugins = null,
}) {
  const body = {
    model: chainModel,
    messages: [{ role: 'system', content: system }, ...messages],
  }

  if (stream) { body.stream = true; body.stream_options = { include_usage: true } }

  if (tools?.length > 0) {
    body.tools = tools.map(t => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    }))
  }

  if (config.llm?.max_tokens) body.max_tokens = config.llm.max_tokens
  if (config.llm?.temperature != null) body.temperature = config.llm.temperature

  for (const key of ['max_tokens','temperature','top_p','stop','tool_choice','parallel_tool_calls','response_format','seed','frequency_penalty','presence_penalty']) {
    if (requestOptions?.[key] !== undefined) body[key] = requestOptions[key]
  }

  if (modalities?.length) body.modalities = modalities
  if (imageConfig) body.image_config = imageConfig
  if (audioConfig) body.audio = audioConfig
  if (plugins?.length) body.plugins = plugins

  return body
}



/**
 * Inspeciona a mensagem da resposta, salva arquivos gerados (imagens, áudio)
 * e substitui os payloads base64 por paths locais.
 *
 * Modifica `msg` in-place e retorna listas de paths.
 */
function processOutputMedia(msg, { outputDir = './generated' } = {}) {
  const savedImages = []
  const savedAudios = []

  
  if (Array.isArray(msg.images)) {
    msg.images = msg.images.map((img, i) => {
      const url = img.image_url?.url ?? img.imageUrl?.url ?? ''
      if (!url) return img
      const filePath = saveGeneratedFile(url, outputDir, 'image')
      savedImages.push(filePath)
      return { type: 'image_url', image_url: { url: filePath, _local: true } }
    })
  }

  
  if (msg.audio?.data && !msg.audio._saved) {
    const fmt = msg.audio.format ?? 'wav'
    const mime = {
      wav: 'audio/wav', mp3: 'audio/mpeg', opus: 'audio/opus',
      flac: 'audio/flac', pcm: 'audio/pcm', pcm16: 'audio/L16'
    }[fmt] ?? 'audio/wav'
    const filePath = saveGeneratedFile(`data:${mime};base64,${msg.audio.data}`, outputDir, 'audio')
    savedAudios.push(filePath)
    msg.audio = { ...msg.audio, data: filePath, _saved: true }
    msg.audio_files = [filePath]
  }

  return { savedImages, savedAudios }
}



/**
 * Versão streaming de callLLM.
 *
 * @param {object}        opts
 * @param {string}        opts.system
 * @param {Array}         opts.messages
 * @param {Array}         [opts.tools]
 * @param {string|null}   [opts.model]
 * @param {object|null}   [opts.requirements]
 * @param {AbortSignal}   [opts.abortSignal]
 * @param {string|null}   [opts.sessionId]
 * @param {Function}      [opts.onToken]       callback(deltaText)
 * @param {Function}      [opts.onImage]       callback(filePath)
 * @param {Function}      [opts.onAudio]       callback(filePath)
 * @param {string[]|null} [opts.modalities]    ex: ["image","text"] | ["text","audio"]
 * @param {object|null}   [opts.imageConfig]   { aspect_ratio?, image_size?, ... }
 * @param {object|null}   [opts.audioConfig]   { voice?, format? }
 * @param {Array|null}    [opts.plugins]       ex: [{ id:"file-parser", pdf:{ engine:"cloudflare-ai" } }]
 * @param {string}        [opts.outputDir]     diretório para arquivos gerados
 */
export async function callLLMStream({
  system, messages, tools = [], model = null, requirements = null,
  abortSignal = null, sessionId = null,
  onToken = null, onReasoningToken = null, onImage = null, onAudio = null,
  onChunk = null, requestOptions = null, remoteRequest = false, pool = null,
  modalities = null, imageConfig = null, audioConfig = null,
  plugins = null, outputDir = './generated',
}) {
  const config = getConfig()
  let slots = buildSlots(config, pool ? { onlyPool: pool } : {})
  const resolution = !model ? await resolveGlobalModelFresh(requirements ?? {
    requires: {
      modalities: modalities?.map(value => `${value}:${value === 'image' || value === 'audio' ? 'output' : 'input'}`) ?? ['text:input'],
      ...(tools.length ? { tools: true } : {}),
    },
  }) : null
  if (resolution && !resolution.ok) throw new Error(`Nenhum modelo compatível: ${resolution.code}`)
  if (resolution?.selected) {
    model = resolution.selected.model
    const selectedSlots = slots.filter(slot => slot.poolName === resolution.selected.metadata?.poolName)
    if (selectedSlots.length) slots = selectedSlots
  }
  if (!slots.length) throw new Error('Nenhum pool LLM ativo.')

  const slot = getNextSlot(slots)
  
  
  
  let elmModel = null
  if (isElm(model, config)) {
    const members = expandModelChain([model], config)
    elmModel = members.find(m => slot.provider === 'anthropic' ? !m.includes('/') : !/^claude-/.test(m))
      ?? members[0]
  }
  const chainModel = elmModel || model || slot.model || getDefaultModel()
  const resolved = remoteRequest ? messages : resolveMessagePaths(messages)
  const finalMods = detectRequiredModalities({ messages: resolved, modalities, imageConfig, audioConfig, model: chainModel })

  const body = buildRequestBody({
    chainModel, system, messages: resolved, tools,
    stream: true, config, requestOptions,
    modalities: finalMods, imageConfig, audioConfig, plugins,
  })

  const res = await fetch(slot.url, {
    method: 'POST', headers: slot.headers,
    body: JSON.stringify(body), signal: abortSignal ?? undefined,
  })

  if (!res.ok) {
    const text = await res.text()
    if (FATAL_ERRORS.has(res.status)) {
      reportSlotFailure(slot.id, `HTTP ${res.status}: ${text}`)
      notifySlotDisabled(slot).catch(() => { })
    }
    throw new Error(`[${slot.poolName}] HTTP ${res.status}: ${text}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullContent = ''
  let fullReasoning = ''
  const toolCallsAccum = {}
  const imagesAccum = []
  const audioChunks = []
  let streamUsage = null
  let streamFinishReason = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n')
    buffer = lines.pop()

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') break

      let chunk
      try { chunk = JSON.parse(data) } catch { continue }

      if (chunk.usage) streamUsage = chunk.usage
      if (chunk.choices?.[0]?.finish_reason) streamFinishReason = chunk.choices[0].finish_reason
      onChunk?.(chunk)
      const delta = chunk.choices?.[0]?.delta
      if (!delta) continue

      if (delta.content) {
        fullContent += delta.content
        onToken?.(delta.content)
      }

      
      if (delta.reasoning_content) {
        fullReasoning += delta.reasoning_content
        onReasoningToken?.(delta.reasoning_content)
      }

      
      
      if (Array.isArray(delta.thinking)) {
        for (const block of delta.thinking) {
          if (block?.type === 'thinking' && block.thinking) {
            fullReasoning += block.thinking
            onReasoningToken?.(block.thinking)
          }
        }
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index
          if (!toolCallsAccum[idx]) {
            toolCallsAccum[idx] = { id: tc.id ?? `call_${idx}`, function: { name: '', arguments: '' } }
          }
          if (tc.id) toolCallsAccum[idx].id = tc.id
          if (tc.function?.name) toolCallsAccum[idx].function.name += tc.function.name
          if (tc.function?.arguments) toolCallsAccum[idx].function.arguments += tc.function.arguments
        }
      }

      
      if (delta.images) {
        for (const img of delta.images) {
          const url = img.image_url?.url ?? img.imageUrl?.url ?? ''
          if (url) imagesAccum.push(url)
        }
      }

      
      if (delta.audio?.data) audioChunks.push(delta.audio.data)
    }
  }

  reportSlotSuccess(slot.id)

  
  const savedImages = imagesAccum.map(url => {
    const fp = saveGeneratedFile(url, outputDir, 'image')
    onImage?.(fp)
    return fp
  })

  
  const savedAudios = []
  if (audioChunks.length > 0) {
    const full = audioChunks.join('')
    const fmt = audioConfig?.format ?? 'wav'
    const mimeMap = { wav: 'audio/wav', mp3: 'audio/mpeg', opus: 'audio/opus', flac: 'audio/flac', pcm16: 'audio/L16' }
    const mime = mimeMap[fmt] ?? 'audio/wav'
    const fp = saveGeneratedFile(`data:${mime};base64,${full}`, outputDir, 'audio')
    savedAudios.push(fp)
    onAudio?.(fp)
  }

  const toolCalls = Object.values(toolCallsAccum)
  const finishReason = streamFinishReason || (toolCalls.length > 0 ? 'tool_calls' : 'stop')

  if (fullContent && typeof $ !== 'undefined') {
    $('agent:token:usage', { usage: streamUsage || { completion_tokens: fullContent.length }, model: chainModel, provider: slot.provider, sessionId })
  }

  return {
    choices: [{
      message: {
        content: fullContent,
        reasoning_content: fullReasoning || undefined,
        tool_calls: toolCalls.length > 0 ? toolCalls.map(tc => ({ ...tc, type: 'function' })) : undefined,
        images: savedImages.length > 0
          ? savedImages.map(f => ({ type: 'image_url', image_url: { url: f, _local: true } }))
          : undefined,
        audio_files: savedAudios.length > 0 ? savedAudios : undefined,
      },
      finish_reason: finishReason,
    }],
    model: chainModel,
    usage: streamUsage,
  }
}



/**
 * Executa uma chamada chat/completions com round-robin + failover automático.
 *
 * @param {object}        opts
 * @param {string}        opts.system
 * @param {Array}         opts.messages
 * @param {Array}         [opts.tools]
 * @param {string|null}   [opts.model]
 * @param {object|null}   [opts.requirements]
 * @param {AbortSignal}   [opts.abortSignal]
 * @param {string|null}   [opts.sessionId]
 * @param {string[]|null} [opts.modalities]    ex: ["image","text"] | ["image"] | ["text","audio"]
 * @param {object|null}   [opts.imageConfig]   { aspect_ratio?, image_size?, strength?, style?, ... }
 * @param {object|null}   [opts.audioConfig]   { voice?, format? }
 * @param {Array|null}    [opts.plugins]       ex: [{ id:"file-parser", pdf:{ engine:"cloudflare-ai" } }]
 * @param {string}        [opts.outputDir]     diretório para arquivos gerados (default: "./generated")
 */
export async function callLLM({
  system, messages, tools = [], model = null, requirements = null,
  pool = null, cliOpts = null,
  abortSignal = null, sessionId = null, requestOptions = null, remoteRequest = false,
  modalities = null, imageConfig = null, audioConfig = null,
  plugins = null, outputDir = './generated',
}) {
  const config = getConfig()
  
  
  let slots = buildSlots(config, pool ? { onlyPool: pool } : {})
  const resolution = !model && !pool ? await resolveGlobalModelFresh(requirements ?? {
    requires: {
      modalities: modalities?.map(value => `${value}:${value === 'image' || value === 'audio' ? 'output' : 'input'}`) ?? ['text:input'],
      ...(tools.length ? { tools: true } : {}),
    },
  }) : null
  if (resolution && !resolution.ok) throw new Error(`Nenhum modelo compatível: ${resolution.code}`)
  if (resolution?.selected) {
    model = resolution.selected.model
    const selectedSlots = slots.filter(slot => slot.poolName === resolution.selected.metadata?.poolName)
    if (selectedSlots.length) slots = selectedSlots
  }

  if (!slots.length) {
    throw new Error(pool
      ? `Pool "${pool}" não encontrado ou sem chaves em agent.config.json.`
      : 'Nenhum pool LLM ativo. Configure llm.pools em agent.config.json.')
  }

  let usableSlots = slots

  
  const resolved = remoteRequest ? messages : resolveMessagePaths(messages)
  const maxRetries = Math.min(usableSlots.length, 5)
  let lastError = null
  
  
  
  
  const outOfCredit = new Set()
  
  
  const retryTimes = []
  let nonCreditFailure = false

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const slot = getNextSlot(usableSlots)
    const rawChain = model
      ? [model]
      : [slot.model ?? getDefaultModel()]
    let modelChain = expandModelChain(rawChain, config)

    
    
    
    
    
    if (slot.provider === 'codex-cli') {
      modelChain = [slot.model]
    
    
    
    
    
    
    
    } else if (slot.mode === 'cli' || isMaritacaProvider(slot.provider)) {
      modelChain = [slot.model ?? modelChain[0]]
    }

    for (const chainModel of modelChain) {
      const finalMods = detectRequiredModalities({ messages: resolved, modalities, imageConfig, audioConfig, model: chainModel })

      const body = buildRequestBody({
        chainModel, system, messages: resolved, tools,
        stream: false, config, requestOptions,
        modalities: finalMods, imageConfig, audioConfig, plugins,
      })

      let failureReported = false
      try {
        let data

        
        
        
        if (slot.mode === 'cli') {
          try {
            data = await runCliSlot(slot, chainModel, { system, messages: resolved, tools, sessionId, cliOpts, abortSignal })
          } catch (e) {
            
            
            
            const noCredit = isCreditFailure(e)
            
            
            
            const blob = `${e?.message || ''} ${e?.stderr || ''} ${e?.stdout || ''}`
            const cooldownMs = noCredit ? cooldownFor(e.failureKind ?? 'credit', blob) : 0
            const state = reportSlotFailure(slot.id, e.message, {
              forceDisable: noCredit,
              reason: e.failureKind ?? null,
              cooldownMs,
            })
            failureReported = true
            if (noCredit) {
              const retryAt = parseRetryAt(blob)
              outOfCredit.add(slot.cli?.account ?? slot.id)
              if (retryAt) retryTimes.push(retryAt)
              console.warn(
                `[llm] ${slot.id}${slot.cli?.account ? ` (conta "${slot.cli.account}")` : ''} sem crédito/cota` +
                (cooldownMs ? ` — volta ao rodízio em ${Math.round(cooldownMs / 60000)}min.` : ' — pulando para a próxima conta do pool.')
              )
            } else {
              nonCreditFailure = true
            }
            if (state.disabled) {
              notifySlotDisabled(slot, noCredit ? 'sem crédito' : null).catch(() => { })
            }
            lastError = e
            break
          }
        
        } else if (isMaritacaProvider(slot.provider)) {
          try {
            data = await runMaritacaTurn(slot, { chainModel, system, messages: resolved, tools, abortSignal })
          } catch (e) {
            if (FATAL_ERRORS.has(e.status)) {
              const state = reportSlotFailure(slot.id, e.message)
              failureReported = true
              nonCreditFailure = true
              if (state.disabled) notifySlotDisabled(slot).catch(() => { })
              lastError = e
              break
            }
            throw e
          }
        } else {
          const res = await fetch(slot.url, {
            method: 'POST', headers: slot.headers,
            body: JSON.stringify(body), signal: abortSignal ?? undefined,
          })

          if (FATAL_ERRORS.has(res.status)) {
            const text = await res.text()
            const state = reportSlotFailure(slot.id, `HTTP ${res.status}: ${text}`)
            failureReported = true
            nonCreditFailure = true
            if (state.disabled) notifySlotDisabled(slot).catch(() => { })
            lastError = new Error(`[${slot.poolName}] HTTP ${res.status}: ${text}`)
            break 
          }

          if (!res.ok) throw new Error(`[${slot.poolName}] HTTP ${res.status}: ${await res.text()}`)

          data = await res.json()
        }

        reportSlotSuccess(slot.id)

        if (data.usage && typeof $ !== 'undefined') $('agent:token:usage', { usage: data.usage, model: chainModel, provider: slot.provider, sessionId })

        
        const msg = data.choices?.[0]?.message
        if (msg) processOutputMedia(msg, { outputDir })

        return data

      } catch (e) {
        if (e.name === 'AbortError' || e.noRetry) throw e
        lastError = e
        if (!failureReported) {
          nonCreditFailure = true
          reportSlotFailure(slot.id, e.message)
        }
      }
    }
  }

  
  
  
  if (outOfCredit.size && !nonCreditFailure) {
    const contas = [...outOfCredit].join(', ')
    
    
    const proximo = retryTimes.length
      ? new Date(Math.min(...retryTimes)).toLocaleString('pt-BR')
      : null
    const msg = `Todas as contas do pool LLM estão sem crédito ou com a cota esgotada (${contas}). ` +
      (proximo
        ? `A primeira volta sozinha em ${proximo} — até lá, ative outro pool para continuar usando o chat.`
        : `Recarregue uma conta ou ative outro pool para voltar a usar o chat.`)
    notifyAllCreditsExhausted(msg).catch(() => { })
    const err = new Error(`[llm] ${msg}`)
    err.failureKind = 'credit'
    err.cause = lastError ?? undefined
    throw err
  }

  throw lastError ?? new Error('Todos os slots LLM falharam.')
}

async function notifyAllCreditsExhausted(message) {
  const { sendProactive } = await import('../channels/channels.js')
  await sendProactive(`[Agent] ${message}`)
}



/**
 * Gera áudio a partir de texto usando o endpoint dedicado /api/v1/audio/speech.
 *
 * @param {object}  opts
 * @param {string}  opts.input           - texto a ser sintetizado
 * @param {string}  opts.model           - ex: "openai/gpt-4o-mini-tts-2025-12-15"
 * @param {string}  opts.voice           - voz (varia por modelo)
 * @param {string}  [opts.responseFormat] - "mp3" (default) | "pcm"
 * @param {number}  [opts.speed]         - multiplicador de velocidade (apenas OpenAI)
 * @param {object}  [opts.provider]      - opções provider-specific
 * @param {string}  [opts.outputDir]     - onde salvar o arquivo gerado
 * @returns {Promise<{ filePath: string }>}
 */
export async function callTTS({
  input, model, voice,
  responseFormat = 'mp3', speed, provider,
  outputDir = './generated',
}) {
  const config = getConfig()
  const slots = buildSlots(config)
  if (!slots.length) throw new Error('Nenhum pool LLM ativo.')

  const slot = getNextSlot(slots)
  
  const baseUrl = slot.url.replace(/\/chat\/completions.*$/, '')
  const ttsUrl = `${baseUrl}/audio/speech`

  const body = { model, input, voice, response_format: responseFormat }
  if (speed != null) body.speed = speed
  if (provider) body.provider = provider

  const res = await fetch(ttsUrl, {
    method: 'POST', headers: slot.headers, body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`[TTS] HTTP ${res.status}: ${text}`)
  }

  
  const buf = await res.arrayBuffer()
  const ext = responseFormat === 'pcm' ? 'pcm' : 'mp3'
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })
  const ts = Date.now()
  const rand = Math.random().toString(36).slice(2, 6)
  const filePath = path.join(outputDir, `tts_${ts}_${rand}.${ext}`)
  fs.writeFileSync(filePath, Buffer.from(buf))

  return { filePath, model, voice, format: responseFormat }
}



/**
 * Retém somente slots que podem atender o endpoint HTTP de transcrição.
 * Providers CLI não expõem URL e não são compatíveis com callSTT.
 *
 * @param {Array<object>} slots
 * @returns {Array<object>}
 */
export function selectHttpSTTSlots(slots) {
  return (slots ?? []).filter(slot => {
    if (slot?.mode !== 'http' || typeof slot.url !== 'string') return false
    try {
      const protocol = new URL(slot.url).protocol
      return protocol === 'http:' || protocol === 'https:'
    } catch {
      return false
    }
  })
}

/**
 * Transcreve áudio para texto usando o endpoint dedicado /api/v1/audio/transcriptions.
 *
 * @param {object}  opts
 * @param {string}  opts.model           - ex: "openai/whisper-1"
 * @param {string}  opts.audioPath       - path local do arquivo de áudio
 * @param {string}  [opts.language]      - código ISO-639-1 (ex: "pt", "en")
 * @param {number}  [opts.temperature]   - 0–1
 * @param {object}  [opts.provider]      - opções provider-specific
 * @returns {Promise<{ text: string, usage: object }>}
 */
export async function callSTT({
  model, audioPath, language, temperature, provider,
}) {
  const config = getConfig()
  const slots = selectHttpSTTSlots(buildSlots(config))
  if (!slots.length) {
    throw new Error('Nenhum pool HTTP compatível com STT está ativo.')
  }

  const slot = getNextSlot(slots)
  const baseUrl = slot.url.replace(/\/chat\/completions.*$/, '')
  const sttUrl = `${baseUrl}/audio/transcriptions`

  const ext = path.extname(audioPath).toLowerCase()
  const fmt = AUDIO_FMT[ext] ?? 'wav'
  const b64 = readBase64(audioPath)

  const body = { model, input_audio: { data: b64, format: fmt } }
  if (language) body.language = language
  if (temperature != null) body.temperature = temperature
  if (provider) body.provider = provider

  const res = await fetch(sttUrl, {
    method: 'POST', headers: slot.headers, body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`[STT] HTTP ${res.status}: ${text}`)
  }

  return res.json()
}



/**
 * Gera vídeo via endpoint assíncrono /api/v1/videos, faz polling até completar
 * e baixa o arquivo para outputDir.
 *
 * @param {object}  opts
 * @param {string}  opts.model           - ex: "google/veo-3.1"
 * @param {string}  opts.prompt          - descrição do vídeo
 * @param {number}  [opts.duration]      - duração em segundos
 * @param {string}  [opts.resolution]    - "720p" | "1080p" | etc
 * @param {string}  [opts.aspectRatio]   - "16:9" | "9:16" | etc
 * @param {string}  [opts.size]          - "1280x720" etc
 * @param {Array}   [opts.frameImages]   - [{ type:"image_url", image_url:{url}, frame_type:"first_frame"|"last_frame" }]
 * @param {Array}   [opts.inputReferences] - [{ type:"image_url", image_url:{url} }]
 * @param {boolean} [opts.generateAudio] - gerar áudio junto (default: true)
 * @param {number}  [opts.seed]
 * @param {string}  [opts.callbackUrl]
 * @param {object}  [opts.provider]      - opções provider-specific
 * @param {string}  [opts.outputDir]
 * @param {number}  [opts.pollInterval]  - ms entre polls (default: 15000)
 * @param {number}  [opts.maxWaitMs]     - timeout total em ms (default: 600000 = 10min)
 * @param {Function} [opts.onStatus]     - callback(status, jobData)
 * @returns {Promise<{ filePath: string, jobId: string }>}
 */
export async function callVideoGen({
  model, prompt,
  duration, resolution, aspectRatio, size,
  frameImages, inputReferences,
  generateAudio, seed, callbackUrl, provider,
  outputDir = './generated',
  pollInterval = 15000,
  maxWaitMs = 600000,
  onStatus = null,
}) {
  const config = getConfig()
  const slots = buildSlots(config)
  if (!slots.length) throw new Error('Nenhum pool LLM ativo.')

  const slot = getNextSlot(slots)
  const baseUrl = slot.url.replace(/\/chat\/completions.*$/, '')
  const vidUrl = `${baseUrl}/videos`

  
  const resolveImageRef = (refs) => refs?.map(ref => {
    if (!ref?.image_url?.url) return ref
    const url = ref.image_url.url
    if (!isLocalPath(url)) return ref
    const ext = path.extname(url).toLowerCase()
    const mime = MIME_MAP[ext] ?? 'image/png'
    return { ...ref, image_url: { url: `data:${mime};base64,${readBase64(url)}` } }
  })

  const body = { model, prompt }
  if (duration != null) body.duration = duration
  if (resolution) body.resolution = resolution
  if (aspectRatio) body.aspect_ratio = aspectRatio
  if (size) body.size = size
  if (frameImages) body.frame_images = resolveImageRef(frameImages)
  if (inputReferences) body.input_references = resolveImageRef(inputReferences)
  if (generateAudio != null) body.generate_audio = generateAudio
  if (seed != null) body.seed = seed
  if (callbackUrl) body.callback_url = callbackUrl
  if (provider) body.provider = provider

  
  const submitRes = await fetch(vidUrl, {
    method: 'POST', headers: slot.headers, body: JSON.stringify(body),
  })
  if (!submitRes.ok) {
    const text = await submitRes.text()
    throw new Error(`[VideoGen] Submit HTTP ${submitRes.status}: ${text}`)
  }

  const job = await submitRes.json()
  const jobId = job.id
  const pollUrl = job.polling_url ?? `${vidUrl}/${jobId}`

  onStatus?.('pending', job)

  
  const deadline = Date.now() + maxWaitMs
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, pollInterval))

    const pollRes = await fetch(pollUrl, { headers: slot.headers })
    if (!pollRes.ok) continue

    const status = await pollRes.json()
    onStatus?.(status.status, status)

    if (status.status === 'completed') {
      const contentUrl = status.unsigned_urls?.[0] ?? `${vidUrl}/${jobId}/content`
      const authHeader = slot.headers?.Authorization ?? slot.headers?.authorization ?? null
      const filePath = await downloadVideo(contentUrl, outputDir, authHeader)
      return { filePath, jobId, model, status }
    }

    if (status.status === 'failed') {
      throw new Error(`[VideoGen] Geração falhou: ${status.error ?? 'erro desconhecido'}`)
    }
  }

  throw new Error(`[VideoGen] Timeout após ${maxWaitMs / 1000}s para job ${jobId}`)
}



export async function getEmbedding(text) {
  /** @register_hook llm:embed */
  const config = getConfig()
  const slots = buildSlots(config)
  if (!slots.length) throw new Error('Nenhum pool configurado para embeddings.')

  const slot = getNextSlot(slots)
  const embedModel = slot.embedModel ?? getEmbedModel()

  const res = await fetch(slot.embedUrl, {
    method: 'POST', headers: slot.headers,
    body: JSON.stringify({ model: embedModel, input: text }),
  })

  if (!res.ok) throw new Error(`Embedding [${slot.poolName}] ${res.status}: ${await res.text()}`)

  return (await res.json()).data[0].embedding
}



/**
 * Normaliza a resposta raw da API.
 * Devolve: { stop_reason, text, reasoning, tool_calls, images, audioFiles, annotations }
 */
export function parseResponse(r) {
  const msg = r.choices?.[0]?.message ?? {}

  const images = (msg.images ?? []).map(img => ({
    url: img.image_url?.url ?? img.imageUrl?.url ?? '',
    local: img.image_url?._local ?? false,
  }))

  const audioFiles = msg.audio_files ?? []

  
  const annotations = msg.annotations ?? []

  return {
    stop_reason: r.choices?.[0]?.finish_reason ?? 'stop',
    text: msg.content ?? '',
    reasoning: msg.reasoning_content ?? msg.reasoning ?? null,
    usage: r.usage ?? null,
    images,
    audioFiles,
    annotations,
    tool_calls: (msg.tool_calls ?? []).map(tc => {
      let parsedInput = {}
      try {
        parsedInput = JSON.parse(tc.function.arguments ?? '{}')
      } catch (e) {
        console.warn(`[LLM] Tool call "${tc.function.name}" JSON inválido: ${e.message}`)
        parsedInput = { _raw: tc.function.arguments, _error: e.message }
      }
      return { id: tc.id, name: tc.function.name, input: parsedInput }
    }),
  }
}

export function buildAssistantMessage(r) {
  const m = r.choices?.[0]?.message ?? {}
  return {
    ...m,
    content: m.content ?? '',
    reasoning_content: m.reasoning_content ?? m.reasoning ?? undefined,
  }
}

export function buildToolResultMessage(id, content, is_error = false) {
  const t = serializeToolResult(content)
  return { role: 'tool', tool_call_id: id, content: is_error ? `ERROR: ${t}` : t }
}



export async function onLlmStt(payload) {
  /**
   * @register_hook llm:stt
   * @description Transcreve áudio para texto usando Whisper via OpenRouter.
   *   Recebe audioPath (local), model (padrão: openai/whisper-large-v3-turbo), language, temperature, provider.
   *   Retorna { success, text, model }.
   */
  const {
    audioPath, model = 'openai/whisper-large-v3-turbo',
    language, temperature, provider,
  } = payload ?? {}

  if (!audioPath) return { success: false, error: 'audioPath é obrigatório' }
  if (!fs.existsSync(audioPath)) return { success: false, error: `Arquivo não encontrado: ${audioPath}` }

  try {
    const result = await callSTT({ model, audioPath, language, temperature, provider })
    console.log(`[STT] Transcrição concluída: "${result.text?.slice(0, 80)}..."`)
    return { success: true, text: result.text, model: result.model ?? null }
  } catch (e) {
    console.error(`[STT] Erro na transcrição: ${e.message}`)
    return { success: false, error: e.message }
  }
}




export async function routeRemoteLlm(payload) {
  /** @register_hook llm:route-remote */
  const config = getConfig()
  const pools = new Map((config?.llm?.pools ?? []).flatMap(pool =>
    [[pool.id, pool], [pool.name, pool], [pool.name ? `name:${pool.name}` : null, pool]].filter(([name]) => name)))
  const configuredRoutes = Array.isArray(payload?.gatewayRoutes) ? payload.gatewayRoutes.filter(route => route?.enabled !== false) : null
  
  
  
  const excludedRoutes = new Set((payload?.excludedRoutes ?? []).map(route => `${route?.pool}\0${route?.model}`))
  const routeFor = (poolName, model = null) => configuredRoutes?.find(route => {
    const routedPool = pools.get(route.poolId)
    const actualPool = pools.get(poolName)
    return routedPool && actualPool === routedPool && (model == null || route.modelId === model)
  })
  const eligibleSlots = buildSlots(config).filter(slot => {
    const pool = pools.get(slot.poolName)
    if (configuredRoutes && !routeFor(slot.poolName)) return false
    if (slot.provider === 'thinkiac' || (!configuredRoutes && pool?.remote_api === false)) return false
    if (slot.mode === 'cli') return configuredRoutes ? true : pool?.remote_api === true
    return /\/chat\/completions(?:[/?]|$)/.test(slot.url || '')
  })
  const poolNames = new Set(eligibleSlots.map(slot => slot.poolName))
  if (!poolNames.size) return { success: false, error: 'Nenhuma pool habilitada para a API remota.' }
  const accessModes = [...new Set(eligibleSlots.map(slot => slot.mode === 'cli' ? 'cli' : (slot.mode || 'api')))]
  const catalog = await getFreshModelCatalog()
  const eligibleAccesses = (catalog.accesses ?? []).filter(access => poolNames.has(access.metadata?.poolName)
    && (!configuredRoutes || routeFor(access.metadata?.poolName, access.model))
    && !excludedRoutes.has(`${access.metadata?.poolName}\0${access.model}`))
  const priorities = [...new Set(eligibleAccesses.map(access =>
    configuredRoutes
      ? Number(routeFor(access.metadata?.poolName, access.model)?.priority || 0)
      : Number(pools.get(access.metadata?.poolName)?.remote_api_priority || 0)))]
    .sort((left, right) => right - left)
  let resolution = null
  for (const priority of priorities) {
    resolution = resolveModel({
      ...catalog,
      accesses: eligibleAccesses.filter(access =>
        (configuredRoutes
          ? Number(routeFor(access.metadata?.poolName, access.model)?.priority || 0)
          : Number(pools.get(access.metadata?.poolName)?.remote_api_priority || 0)) === priority),
    }, {
      requires: { ...(payload?.requirements?.requires || {}), accessModes },
      override: payload?.model || null,
    })
    if (resolution.ok && resolution.selected) break
  }
  if (!resolution?.ok || !resolution.selected) return { success: false, error: 'Nenhum modelo da pool atende às capacidades solicitadas.' }
  return { success: true, model: resolution.selected.model, pool: resolution.selected.metadata.poolName,
    provider: resolution.selected.provider, economics: resolution.selected.economics }
}



export async function onLlmCall(payload) {
  /** @register_hook llm:call */
  const {
    prompt = null, system = 'You are a helpful assistant.',
    messages = [], model = null, requirements = null, tools = [],
    pool = null, cliOpts = null, sessionId = null, abortSignal = null,
    requestOptions = null, remoteRequest = false, stream = false, onChunk = null,
    modalities = null, imageConfig = null, audioConfig = null,
    plugins = null, outputDir = './generated',
  } = payload ?? {}

  const msgs = messages.length ? messages : [{ role: 'user', content: prompt || system }]

  try {
    const data = await (stream ? callLLMStream : callLLM)({
      system, messages: msgs, tools,
      model, requirements, pool, cliOpts, sessionId, abortSignal,
      requestOptions, remoteRequest, onChunk,
      modalities, imageConfig, audioConfig, plugins, outputDir,
    })

    const parsed = parseResponse(data)

    return {
      success: true,
      finish_reason: data.choices?.[0]?.finish_reason,
      text: parsed.text,
      reasoning: parsed.reasoning,
      images: parsed.images,
      audioFiles: parsed.audioFiles,
      annotations: parsed.annotations,
      tool_calls: parsed.tool_calls,
      usage: parsed.usage,
      model: data.model ?? null,
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
}



export async function callLlm(payload) {
  /**
   * @register_tool call_llm
   * @description Chama a LLM configurada da Agent. Suporta texto, imagens, áudio, PDF e vídeo
   *   como input (paths resolvidos automaticamente). Para output multimodal use os parâmetros
   *   modalities/imageConfig/audioConfig. Arquivos gerados são salvos em outputDir.
   * @param {string?}   prompt      - Prompt simples
   * @param {string?}   system      - System prompt
   * @param {string?}   model       - Override do modelo
   * @param {object?}   requirements - Contrato de capacidades, preferências e política.
   * @param {string[]?} modalities  - ["image","text"] | ["image"] | ["text","audio"]
   * @param {object?}   imageConfig - { aspect_ratio?, image_size?, strength?, style?, ... }
   * @param {object?}   audioConfig - { voice?, format? }
   * @param {object[]?} plugins     - [{ id:"file-parser", pdf:{ engine:"cloudflare-ai"|"mistral-ocr"|"native" } }]
   * @param {string?}   outputDir   - Diretório para arquivos gerados (default: "./generated")
   */
  const {
    prompt = null, system = 'You are a helpful assistant.',
    model = null, requirements = null,
    modalities = null, imageConfig = null, audioConfig = null,
    plugins = null, outputDir = './generated',
  } = payload ?? {}

  if (!prompt) throw new Error('`prompt` é obrigatório')

  const response = await callLLM({
    system, messages: [{ role: 'user', content: prompt }], tools: [],
    model, requirements, modalities, imageConfig, audioConfig, plugins, outputDir,
  })
  const parsed = parseResponse(response)
  return { success: true, text: parsed.text, images: parsed.images, audioFiles: parsed.audioFiles, annotations: parsed.annotations, model: response.model ?? null }
}



export {
  classifyMedia,
  resolveMessagePaths,
  pathToBlock,
  saveGeneratedFile,
  MEDIA_TYPES,
  MIME_MAP,
}
