














import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parseFm, clearAgentCache } from '../core/agent.js'
import { pushMessage } from '../memory/session.js'

const PKG_DIR = dirname(fileURLToPath(import.meta.url))
const AGENT_DIR = join(PKG_DIR, '..')
const AGENT_MD_PATH = join(AGENT_DIR, 'AGENT.md')
const DATA_DIR = join(AGENT_DIR, 'data')
const STATE_FILE = join(DATA_DIR, 'onboarding-state.json')

const DEFAULT_SESSION_ID = 'default'




const TONE_QUESTION = 'Qual tom você prefere que eu use nas nossas conversas?'
const INSTRUCTIONS_QUESTION = 'Tem algo que eu deva sempre lembrar sobre você ou seu negócio?'



function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
}

function readState() {
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')) } catch { return {} }
}

function writeState(state) {
  ensureDataDir()
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8')
}



function readAgentMd() {
  if (!existsSync(AGENT_MD_PATH)) return { meta: {}, body: '' }
  return parseFm(readFileSync(AGENT_MD_PATH, 'utf8'))
}

function upsertSection(body, header, content) {
  const re = new RegExp(`## ${header}\\n[\\s\\S]*?(?=\\n## |$)`)
  const block = `## ${header}\n${content}\n`
  if (re.test(body)) return body.replace(re, block).trim()
  return `${body.trim()}\n\n${block}`.trim()
}

function writeAgentMd(name, body) {
  ensureDataDir() 
  const content = `---\nname: ${name}\n---\n\n# ${name}\n\n${body}\n`
  writeFileSync(AGENT_MD_PATH, content, 'utf8')
  clearAgentCache() 
}



function resolveAssistantName(assistantName) {
  const trimmed = (assistantName || '').trim()
  if (!trimmed || trimmed.toLowerCase() === 'agent') return 'Agent'
  return `${trimmed} (Agent)`
}

function applyPart1(onboarding) {
  const name = resolveAssistantName(onboarding.assistantName)
  const { body } = readAgentMd()
  let next = body

  if (onboarding.purpose) next = upsertSection(next, 'Propósito', onboarding.purpose)
  if (onboarding.audience) next = upsertSection(next, 'Público', onboarding.audience)
  if (onboarding.briefContext) {
    next = upsertSection(next, 'Contexto', onboarding.briefContext)
  } else if (onboarding.context === 'empresa' && onboarding.role) {
    next = upsertSection(next, 'Contexto', `Empresa — cargo do dono: ${onboarding.role}`)
  } else if (onboarding.context === 'pessoal') {
    next = upsertSection(next, 'Contexto', 'Uso pessoal.')
  }

  writeAgentMd(name, next || `Assistente configurada via onboarding.`)
  return name
}

function applyPart2({ tone, instructions }) {
  const { meta, body } = readAgentMd()
  let next = body
  if (tone) next = upsertSection(next, 'Tom', tone)
  if (instructions) next = upsertSection(next, 'Instruções', instructions)
  writeAgentMd(meta.name || 'Agent', next)
}









function buildWelcomeMessage(onboarding, name) {
  const rows = [
    ['Nome', name],
    onboarding.briefContext ? ['Contexto', onboarding.briefContext] : (onboarding.context ? ['Contexto', onboarding.context === 'empresa' ? `Empresa${onboarding.role ? ` — ${onboarding.role}` : ''}` : 'Pessoal'] : null),
    onboarding.purpose ? ['Objetivo', onboarding.purpose] : null,
    onboarding.audience ? ['Para quem', onboarding.audience] : null,
  ].filter(Boolean)

  const table = [
    '| Campo | Valor |',
    '|---|---|',
    ...rows.map(([k, v]) => `| ${k} | ${v} |`),
  ].join('\n')

  const structuredInput = JSON.stringify([
    {
      type: 'multi_choice',
      question: TONE_QUESTION,
      mode: 'single',
      options: ['Direto e objetivo', 'Formal', 'Descontraído'],
    },
    {
      type: 'prompt',
      question: INSTRUCTIONS_QUESTION,
      placeholder: 'Ex.: sempre responda em português, meu foco principal é...',
    },
  ], null, 2)

  return [
    `Prazer, eu sou ${name}. Já anotei o essencial que você me contou no cadastro:`,
    '',
    table,
    '',
    '```mermaid',
    'graph LR',
    '  A[Você me conta o contexto] --> B[Eu ajusto tom e respostas]',
    '  B --> C[Você usa no dia a dia]',
    '  C --> D[Eu aprendo e refino com o tempo]',
    '```',
    '',
    'Só faltam duas coisas pra eu ficar redondo com você:',
    '',
    '```thinkiac',
    structuredInput,
    '```',
  ].join('\n')
}



export async function onOnboardingReceived({ onboarding }) {
  /**
   * @register_hook tenant:onboarding-received
   */
  if (!onboarding || typeof onboarding !== 'object') return

  try {
    const name = applyPart1(onboarding)
    pushMessage(DEFAULT_SESSION_ID, {
      role: 'assistant',
      content: buildWelcomeMessage(onboarding, name),
    })
    writeState({ ...readState(), [DEFAULT_SESSION_ID]: 'awaiting-part2' })
  } catch (err) {
    console.error('[onboarding] falha ao semear AGENT.md/mensagem de boas-vindas:', err.message)
  }
}




function parsePart2Answer(text) {
  if (!text.includes(TONE_QUESTION) || !text.includes(INSTRUCTIONS_QUESTION)) return null

  const blocks = text.split(/\n\n---\n\n/)
  const extract = (question) => {
    const block = blocks.find((b) => b.includes(question))
    if (!block) return null
    return block.replace(/^\*\*.*?\*\*(?:\s*\(\d+\/\d+\))?\n\n/, '').trim()
  }

  return { tone: extract(TONE_QUESTION), instructions: extract(INSTRUCTIONS_QUESTION) }
}

export async function onAgentMessage({ message, sessionId = DEFAULT_SESSION_ID }) {
  /**
   * @register_hook agent:message
   */
  if (!message || typeof message !== 'string') return

  const state = readState()
  if (state[sessionId] !== 'awaiting-part2') return

  const answer = parsePart2Answer(message)
  if (!answer) return

  try {
    applyPart2(answer)
  } catch (err) {
    console.error('[onboarding] falha ao aplicar Parte 2 no AGENT.md:', err.message)
  } finally {
    delete state[sessionId]
    writeState(state)
  }
}
