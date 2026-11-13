
import { createMcpHttpClient } from './mcp_http_client.js'





























import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { sanitizeTools } from './mcp_schema.js'
import { serializeMcpError } from './mcp_context.js'

const mcpHttpUrl = process.env.AGENT_MCP_HTTP_URL || 'http://127.0.0.1:3333'
const mcpHttp = createMcpHttpClient({ baseUrl: mcpHttpUrl })

const SAY_TO_USER_TOOL = 'say_to_user'
const ASK_USER_TOOL = 'ask_user'

const SAY_TO_USER_DEF = {
  name: SAY_TO_USER_TOOL,
  description: 'Manda uma mensagem para o usuário humano DENTRO da sessão de chat, no meio do trabalho, sem esperar resposta. Use para dar sinal de vida numa tarefa longa, avisar de um achado importante, ou explicar uma decisão na hora em que ela é tomada — em vez de guardar tudo para um resumo no final. Não use para narrar cada passo pequeno: cada chamada aparece como uma mensagem na conversa do usuário.',
  inputSchema: {
    type: 'object',
    required: ['message'],
    properties: {
      message: { type: 'string', description: 'A mensagem, escrita para o usuário final ler (Markdown simples é suportado).' },
    },
  },
}

const ASK_USER_DEF = {
  name: ASK_USER_TOOL,
  description: 'Pergunta algo diretamente ao usuário humano real (não ao Agent) e ESPERA a resposta antes de continuar. Use quando precisar de uma decisão, confirmação ou dado que só o usuário sabe — a tarefa fica pausada até a resposta chegar (pode levar minutos). Não use pra perguntas retóricas ou que você mesmo pode responder investigando o código.',
  inputSchema: {
    type: 'object',
    required: ['question'],
    properties: {
      question: { type: 'string', description: 'A pergunta, em texto claro, pronta pra ser lida pelo usuário final (sem jargão interno).' },
      timeout_minutes: { type: 'number', description: 'Quanto esperar pela resposta antes de desistir (padrão 30min).' },
    },
  },
}

const BASE_URL = process.env.AGENT_BASE_URL || 'http://localhost:5040'





function resolveSessionId() {
  const sessionId = process.env.AGENT_SESSION_ID || process.env.AGENT_ENGINEER_SESSION_ID
  if (!sessionId) {
    throw new Error('Nenhuma sessão de chat vinculada a este processo (AGENT_SESSION_ID não definido) — não há usuário para falar. Quem disparou esta execução precisa passar a sessão (ex: run_claude com o parâmetro `session`).')
  }
  return sessionId
}

async function postSession(path, body) {
  
  
  
  const res = await fetch(`${BASE_URL}/agent/session/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.AGENT_SESSION_TOKEN ?? ''}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} em /agent/session/${path}`)
  const data = await res.json()
  if (!data.success) throw new Error(data.error || `Falha em /agent/session/${path}`)
  return data
}

async function handleSayToUser({ message }) {
  const data = await postSession('say', { session_id: resolveSessionId(), message })
  
  
  
  return data.live
    ? 'Mensagem entregue na sessão do usuário.'
    : 'Mensagem gravada no histórico da sessão, mas ninguém está com ela aberta no momento — o usuário verá quando abrir.'
}

async function handleAskUser({ question, timeout_minutes }) {
  const data = await postSession('ask', {
    session_id: resolveSessionId(),
    question,
    timeout_ms: timeout_minutes ? timeout_minutes * 60_000 : undefined,
  })
  return data.answer
}

async function turnRequest(body) {
  const started = Date.now()
  let res
  try {
    res = await fetch(`${BASE_URL}/agent/session/tools`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.AGENT_TURN_TOOLS_TOKEN}` },
      body: JSON.stringify(body),
    })
  } catch (error) {
    
    const knownCodes = new Set(['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ABORT_ERR'])
    const code = error?.cause?.code || error?.code
    console.error('[mcp_server] turn_transport', JSON.stringify({
      operation: body?.operation === 'list' ? 'list' : 'call',
      elapsedMs: Date.now() - started,
      code: knownCodes.has(code) ? code : 'UNKNOWN',
    }))
    throw error
  }
  const data = await res.json()
  if (!res.ok || !data.success) throw new Error(data.error || 'Falha na ponte do turno.')
  return data
}
async function fetchLiveTools() {
  if(process.env.AGENT_TURN_TOOLS_TOKEN)return sanitizeTools((await turnRequest({operation:'list'})).tools, msg=>console.error(msg));
  return sanitizeTools(await mcpHttp.listTools(), msg => console.error(msg))
}

async function callLiveTool(name, args) {
  if(process.env.AGENT_TURN_TOOLS_TOKEN)return (await turnRequest({operation:'call',name,args})).result;
  return mcpHttp.callTool(name, args)
}

const server = new Server(
  { name: 'thinkiac-runtime', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => {
  try {
    const tools = await fetchLiveTools()
    
    
    return { tools: process.env.AGENT_TURN_TOOLS_TOKEN ? tools : [SAY_TO_USER_DEF, ASK_USER_DEF, ...tools] }
  } catch (e) {
    
    
    
    if(process.env.AGENT_TURN_TOOLS_TOKEN)throw e;
    console.error(`[mcp_server] não consegui listar tools em ${mcpHttpUrl}: ${e.message}`)
    return { tools: [SAY_TO_USER_DEF, ASK_USER_DEF] }
  }
})

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  try {
    if (!process.env.AGENT_TURN_TOOLS_TOKEN && req.params.name === SAY_TO_USER_TOOL) {
      const ack = await handleSayToUser(req.params.arguments ?? {})
      return { content: [{ type: 'text', text: ack }] }
    }

    if (!process.env.AGENT_TURN_TOOLS_TOKEN && req.params.name === ASK_USER_TOOL) {
      const answer = await handleAskUser(req.params.arguments ?? {})
      return { content: [{ type: 'text', text: answer }] }
    }

    const result = await callLiveTool(req.params.name, req.params.arguments ?? {})
    return {
      content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }],
    }
  } catch (e) {
    const error = serializeMcpError(e)
    return {
      content: [{ type: 'text', text: JSON.stringify(error) }],
      structuredContent: error,
      isError: true,
    }
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
