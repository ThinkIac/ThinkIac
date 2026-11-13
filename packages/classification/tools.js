const approximation = require('./approximation');
const experience = require('./experience');

async function listModels() {
  /** @register_tool listModels @description Lista o catálogo global de modelos, acessos, capacidades e evidências. */
  const { getGlobalModelCatalog } = await import('../agent/llm/model_registry.js');
  return getGlobalModelCatalog();
}

async function selectModel(data = {}) {
  /** @register_tool selectModel @description Resolve um modelo por requisitos concretos, preferências, política e override explícito. @param {object?} requirements - Contrato {requires,prefers,policy,override}. */
  const { resolveGlobalModel } = await import('../agent/llm/model_registry.js');
  return resolveGlobalModel(data.requirements ?? data);
}

async function routerGetModels() {
  /** @register_router models @method GET */
  return listModels();
}

async function routerResolveModel(req) {
  /** @register_router models/resolve @method POST */
  return selectModel(req?.body ?? {});
}

function setApproximationLevel(data) {
  /** @register_tool setApproximationLevel @description Ajusta o nível de detalhe da classificação de ferramentas. @param {string} level - compact, detailed ou full. @param {string?} scope - session ou global. @param {string?} sessionId - Sessão. */
  return approximation.setLevel(data.sessionId || 'default', data.level, data.scope || 'session');
}
function getApproximationLevel(data = {}) {
  /** @register_tool getApproximationLevel @description Retorna o nível atual de aproximação. @param {string?} sessionId - Sessão. */
  const sessionId = data.sessionId || 'default'; const level = approximation.getLevel(sessionId);
  return { sessionId, level, mode: approximation.MODES[level] ?? approximation.MODES.compact };
}
function resetApproximationLevel(data = {}) {
  /** @register_tool resetApproximationLevel @description Restaura o nível de aproximação padrão. @param {string?} sessionId - Sessão opcional. */
  return approximation.resetLevel(data.sessionId);
}
function listApproximationModes() {
  /** @register_tool listApproximationModes @description Lista os modos de aproximação disponíveis. */
  return { modes: approximation.listModes() };
}
function queryExperience(data) {
  /** @register_tool query_experience @description Busca experiências de ferramentas semelhantes. @param {string} intent - Intenção da tarefa. @param {number?} limit - Limite. */
  return experience.queryExperienceTool(data);
}
function recordExperience(data) {
  /** @register_tool record_experience @description Registra uma experiência de ferramenta. @param {string} intent - Intenção. @param {string} tool - Ferramenta. @param {boolean?} success - Sucesso. */
  return experience.recordExperienceTool(data);
}

module.exports = { listModels, selectModel, routerGetModels, routerResolveModel, setApproximationLevel, getApproximationLevel, resetApproximationLevel, listApproximationModes, queryExperience, recordExperience };
