// codex/index.js — Rotas de configuração do provider OpenAI via API key.
//
// O app "Codex" tem 2 modos:
//   - Assinatura (CLI): logins do Codex CLI por perfil, provider "codex-cli".
//     Backend em /agent/codex-accounts.
//   - API Key (aqui): chave paga da OpenAI (sk-…), provider "openai"
//     (OpenAI-compatible, caminho HTTP default da engine). Pool separado
//     `openai-api`, sem tocar no pool CLI.
//
// Wrapper fino sobre agent/llm/provider_app.js. Anotações @register_router
// escaneadas neste arquivo; corpos delegados à factory. Rotas em /codex/*.

import { makeProviderApp } from '../agent/llm/provider_app.js'
// Carrega o executor do Shell. Os decorators de rota vivem no módulo para
// manter a configuração de API key acima independente do runtime do agente.
import * as agent from './routes.js'

const app = makeProviderApp({
  poolName:     'openai-api',
  provider:     'openai',
  defaultModel: 'gpt-4o',
  apiRoot:      'https://api.openai.com/v1',
  keyRegex:     /^sk-[A-Za-z0-9._-]+$/,
  testStyle:    'openai',
  comment:      'Provider OpenAI via API key paga (sk-…), API OpenAI-compatible. Gerenciado pela aba API Key do app codex. NÃO é o pool codex-cli (assinatura ChatGPT).',
})

export async function onBoot() {
  /**
   * @register_hook boot
   * @description Garante um slot `openai-api` (vazio/desligado) em agent.config.json → llm.pools[].
   */
  return app.onBoot()
}

export async function getStatus() {
  /**
   * @register_router status
   * @method GET
   * @description Estado do slot openai-api (chave mascarada, modelo, enabled).
   */
  return app.getStatus()
}

export async function saveSettings(req) {
  /**
   * @register_router save
   * @method POST
   * @description Salva a chave da OpenAI (api_keys[0]) e, se vier, o modelo — já ativa o slot. Body: { api_key, model? }.
   */
  return app.save(req)
}

export async function saveModel(req) {
  /**
   * @register_router model
   * @method POST
   * @description Atualiza só o modelo do slot. Body: { model }.
   */
  return app.saveModel(req)
}

export async function listModels() {
  /**
   * @register_router models
   * @method GET
   * @description Lista os modelos disponíveis para a API key OpenAI já salva, sem expor a chave ao navegador.
   */
  return app.listModels()
}

export async function saveModels(req) {
  /**
   * @register_router models
   * @method POST
   * @description Salva os modelos OpenAI habilitados. Body: { models: string[], model?: string }.
   */
  return app.saveModels(req)
}

export async function toggleEnabled(req) {
  /**
   * @register_router toggle
   * @method POST
   * @description Liga/desliga o slot openai-api. Body: { enabled: boolean }.
   */
  return app.toggleEnabled(req)
}

export async function testConnection() {
  /**
   * @register_router test
   * @method POST
   * @description Faz 1 turno real contra a API da OpenAI e devolve a resposta (ou o erro).
   */
  return app.testConnection()
}

// O runtime escaneia decorators no entrypoint do pacote. Os handlers do agente
// permanecem testáveis em routes.js; estes wrappers são só a superfície HTTP.
export function codexChatSend(req, res) { /** @register_router chat/send
 * @method POST */ return agent.chatSend(req, res) }
export function codexChatCancel(req) { /** @register_router chat/cancel
 * @method POST */ return agent.chatCancel(req) }
export function chatReconnect(req) { /** @register_router chat/stream/reconnect
 * @method POST */ return agent.chatReconnect(req) }
export function sessionHistory(req) { /** @register_router sessions/:sessionId/history
 * @method GET */ return agent.sessionHistory(req) }
export function sessionStatus(req) { /** @register_router sessions/:sessionId/status
 * @method GET */ return agent.sessionStatus(req) }
export function sessionClear(req) { /** @register_router sessions/:sessionId/clear
 * @method GET */ return agent.sessionClear(req) }
export function sessionsList() { /** @register_router sessions/list
 * @method GET */ return agent.sessionsList() }
export function workspaceGet(req) { /** @register_router session/workspace
 * @method GET */ return agent.workspaceGet(req) }
export function workspaceSet(req, res) { /** @register_router session/workspace
 * @method POST */ return agent.workspaceSet(req, res) }
export function workspaceBrowse(req, res) { /** @register_router workspaces/browse
 * @method GET */ return agent.workspaceBrowse(req, res) }
export function sessionModelGet(req) { /** @register_router session/model
 * @method GET */ return agent.sessionModelGet(req) }
export function sessionModelSet(req) { /** @register_router session/model
 * @method POST */ return agent.sessionModelSet(req) }
export function providerGet() { /** @register_router provider
 * @method GET */ return agent.providerGet() }
export function thinkingTitles() { /** @register_router chat/thinking-titles
 * @method GET */ return agent.thinkingTitles() }
export function titleConfig() { /** @register_router sessions/title-config
 * @method GET */ return agent.titleConfig() }
export function sessionFeedback() { /** @register_router sessions/:sessionId/feedback
 * @method POST */ return agent.sessionFeedback() }
