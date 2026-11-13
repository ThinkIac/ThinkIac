// openrouter/index.js — App de configuração do provider OpenRouter.
//
// Wrapper fino sobre agent/llm/provider_app.js (factory compartilhada). Aqui
// ficam só as anotações @register_hook/@register_router (que o runtime escaneia
// neste arquivo) delegando pros corpos da factory. OpenRouter é uma API
// OpenAI-compatible: uma chave (sk-or-…) dá acesso a centenas de modelos.

import { makeProviderApp } from '../agent/llm/provider_app.js'
import { discoverOpenRouterCapabilities } from './capabilities.js'

const app = makeProviderApp({
  poolName:     'openrouter',
  // O runtime identifica este catálogo pelo id, e há outro pool OpenRouter
  // (opencode-api) que não pertence a este app.
  poolId:       'openrouter-primary',
  provider:     'openrouter',
  defaultModel: 'anthropic/claude-sonnet-4.5',
  apiRoot:      'https://openrouter.ai/api/v1',
  keyRegex:     /^sk-or-[A-Za-z0-9._-]+$/,
  testStyle:    'openai',
  testHeaders:  { 'HTTP-Referer': 'https://thinkiac.cloud', 'X-Title': 'ThinkIac' },
  resolveCapabilities: discoverOpenRouterCapabilities,
  comment:      'Provider OpenRouter (API OpenAI-compatible). Uma chave (sk-or-…) dá acesso a centenas de modelos via provider/modelo. Gerenciado pelo app openrouter.',
})

export async function onBoot() {
  /**
   * @register_hook boot
   * @description Garante o slot canônico `openrouter-primary` em agent.config.json → llm.pools[].
   */
  return app.onBoot()
}

export async function getStatus() {
  /**
   * @register_router status
   * @method GET
   * @description Estado do slot openrouter (chave mascarada, modelo, endpoint, enabled).
   */
  return app.getStatus()
}

export async function saveSettings(req) {
  /**
   * @register_router save
   * @method POST
   * @description Salva a chave (api_keys[0]) e, se vier, o modelo — já ativa o slot. Body: { api_key, model? }.
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

export async function saveModels(req) {
  /**
   * @register_router models
   * @method POST
   * @description Substitui o catálogo models[] e define o padrão em model. Body: { models, model? }.
   */
  return app.saveModels(req)
}

export async function toggleEnabled(req) {
  /**
   * @register_router toggle
   * @method POST
   * @description Liga/desliga o slot openrouter. Body: { enabled: boolean }.
   */
  return app.toggleEnabled(req)
}

export async function testConnection() {
  /**
   * @register_router test
   * @method POST
   * @description Faz 1 turno real contra a API do OpenRouter e devolve a resposta (ou o erro).
   */
  return app.testConnection()
}
