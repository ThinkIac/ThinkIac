// memory/tools.js
// Tools públicas do grafo de memória, para qualquer agente/pacote que rode
// via run_runtime_tool. Ver README.md.

import { remember, relate, recall, forget, stats, migrateLegacyFacts, findOrCreateEntity } from './lib/graph.js'
import { runAgentTask } from '../agent/host/logos/index.js'

// Schema de saída para memory_extract — validação é rasa (agent.ts não
// implementa JSON Schema completo, só chave/tipo de topo), então o shape dos
// itens dentro de cada array não é verificado; tratamos entradas malformadas
// como best-effort abaixo (item sem name/content é ignorado, não falha tudo).
const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    entities: { type: 'array', description: 'Entidades encontradas: [{ name, type }]' },
    relations: { type: 'array', description: 'Relações entre entidades: [{ from, type, to }]' },
    facts: { type: 'array', description: 'Fatos atômicos a lembrar: [{ content, entity }]' },
  },
  required: ['entities', 'facts'],
}

export async function memoryRemember({ content, entity, type, sessionId } = {}) {
  /**
   * @register_tool memory_remember
   * @description Armazena um fato na memória de longo prazo, associado a uma entidade (grafo). Gera embedding vetorial best-effort para busca semântica.
   * @param {string} content - Conteúdo do fato
   * @param {string?} entity - Nome da entidade a que o fato pertence (padrão: "general")
   * @param {string?} type - Tipo da entidade: person, project, preference, fact, task, event, concept (padrão: "fact")
   * @param {string?} sessionId - Sessão onde o fato foi aprendido, se aplicável
   */
  return remember({ content, entity, type: type || 'fact', sessionId })
}

export async function memoryRelate({ from, type, to } = {}) {
  /**
   * @register_tool memory_relate
   * @description Cria uma relação dirigida entre duas entidades do grafo de memória (ex.: "Alice" --works_on--> "Projeto X"). Cria as entidades se não existirem.
   * @param {string} from - Nome da entidade de origem
   * @param {string} type - Tipo da relação (ex.: works_on, prefers, part_of, related_to)
   * @param {string} to - Nome da entidade de destino
   */
  if (!from || !to) return { success: false, error: 'from e to são obrigatórios' }
  return relate(from, type, to)
}

export async function memoryRecall({ query, limit, entity, pool } = {}) {
  /**
   * @register_tool memory_recall
   * @description Busca semântica (ou por substring, se não houver embeddings disponíveis) na memória de longo prazo. Retorna observações com a entidade dona e relações de 1 salto. Buscas escopadas por "entity" consideram todo o histórico da entidade; buscas globais ranqueiam sobre um lote recente (ver "pool").
   * @param {string} query - Texto da busca
   * @param {number?} limit - Número máximo de resultados (padrão: 5)
   * @param {string?} entity - Restringe a busca a uma entidade específica (sem cap de profundidade)
   * @param {number?} pool - Só para buscas SEM "entity": tamanho do lote recente ranqueado por similaridade (padrão: 500)
   */
  if (!query) return { success: false, error: 'query é obrigatório' }
  const results = await recall(query, { limit: limit || 5, entity: entity || null, pool: pool || 500 })
  return { success: true, results }
}

export async function memoryForget({ query } = {}) {
  /**
   * @register_tool memory_forget
   * @description Remove observações cujo conteúdo contém a query (substring, case-sensitive na comparação SQL). Remove também entidades que ficarem órfãs.
   * @param {string} query - Substring a remover
   */
  if (!query) return { success: false, error: 'query é obrigatório' }
  return forget(query)
}

export async function memoryStatus() {
  /**
   * @register_tool memory_status
   * @description Retorna contagens do grafo de memória (entidades, observações, relações).
   */
  return { success: true, ...stats() }
}

export async function memoryMigrateLegacyFacts() {
  /**
   * @register_tool memory_migrate_legacy_facts
   * @description Importa o facts.md/embeddings.json antigos do aurora para o grafo (entidade "legacy"). Idempotente — não roda duas vezes.
   */
  return migrateLegacyFacts()
}

export async function memoryExtract({ text, sessionId } = {}) {
  /**
   * @register_tool memory_extract
   * @description Extração automática de entidades/relações/fatos (NER via LLM) de um texto livre — opt-in: só roda quando explicitamente chamada, nunca automaticamente a partir de memory_remember. Usa o executor neutro do agent-runtime com saída estruturada.
   * @param {string} text - Texto livre de onde extrair entidades, relações e fatos
   * @param {string?} sessionId - Sessão de origem, se aplicável
   */
  const content = String(text ?? '').trim()
  if (!content) return { success: false, error: 'text é obrigatório' }

  const result = await runAgentTask({
    system: 'Você extrai conhecimento estruturado de texto livre para popular um grafo de memória. Responda SOMENTE com o JSON pedido — sem tools, sem texto fora do JSON.',
    goal: `Extraia entidades, relações e fatos atômicos deste texto:\n\n${content}`,
    tools: [],
    outputSchema: EXTRACT_SCHEMA,
  })

  if (!result.success || !result.output) {
    return { success: false, error: result.error || 'extração falhou ou não retornou JSON válido' }
  }

  const { entities = [], relations = [], facts = [] } = result.output

  let entitiesCreated = 0
  for (const e of entities) {
    if (!e?.name) continue
    await findOrCreateEntity({ name: e.name, type: e.type || 'fact' })
    entitiesCreated++
  }

  let factsStored = 0
  for (const f of facts) {
    if (!f?.content) continue
    await remember({ content: f.content, entity: f.entity, sessionId, source: 'extracted' })
    factsStored++
  }

  let relationsCreated = 0
  for (const r of relations) {
    if (!r?.from || !r?.to) continue
    await relate(r.from, r.type || 'related_to', r.to)
    relationsCreated++
  }

  return { success: true, entitiesCreated, factsStored, relationsCreated }
}
