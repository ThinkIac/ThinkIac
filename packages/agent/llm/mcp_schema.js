


















/** Padrão que a API aceita para chave de propriedade de schema de tool. */
export const VALID_KEY = /^[a-zA-Z0-9_.-]{1,64}$/

/**
 * Remove propriedades com chave inválida de um schema (recursivo: entra em
 * `properties` aninhadas e em `items` de array). Não muta a entrada.
 *
 * @param {object} schema
 * @param {string} toolName        - só para compor a mensagem de diagnóstico
 * @param {string[]} dropped       - acumulador "tool.chave" das chaves removidas
 * @returns {object} schema saneado
 */
export function sanitizeSchema(schema, toolName, dropped) {
  if (!schema || typeof schema !== 'object') return schema

  let out = schema
  const props = schema.properties
  if (props && typeof props === 'object') {
    const clean = {}
    for (const [key, value] of Object.entries(props)) {
      if (!VALID_KEY.test(key)) { dropped.push(`${toolName}.${key}`); continue }
      clean[key] = sanitizeSchema(value, toolName, dropped)
    }
    out = { ...out, properties: clean }
    if (Array.isArray(out.required)) {
      
      
      out.required = out.required.filter(k => k in clean)
    }
  }

  if (out.items) out = { ...out, items: sanitizeSchema(out.items, toolName, dropped) }
  return out
}

/**
 * Saneia a lista de tools do MCP. Aceita tanto `inputSchema` (camelCase, formato
 * do SDK MCP) quanto `input_schema` (snake_case), preservando qual dos dois veio.
 *
 * @param {object[]} tools
 * @param {(msg:string)=>void} [warn] - onde reportar o que foi removido
 * @returns {object[]} tools saneadas
 */
export function sanitizeTools(tools, warn = () => {}) {
  const dropped = []
  const out = (tools || []).map(t => {
    const schema = t?.inputSchema ?? t?.input_schema
    if (!schema) return t
    const cleaned = sanitizeSchema(schema, t?.name ?? '?', dropped)
    return t.inputSchema ? { ...t, inputSchema: cleaned } : { ...t, input_schema: cleaned }
  })
  if (dropped.length) {
    warn(`[mcp_schema] ${dropped.length} propriedade(s) com chave inválida removida(s): ${dropped.join(', ')}`)
  }
  return out
}
