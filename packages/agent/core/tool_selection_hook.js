



export async function applyToolSelectionHook(dispatch, { tools, availableTools, requiredTools = [], always = () => false, ...context }) {
  const candidates = Array.isArray(availableTools) ? availableTools : tools;
  const protectedNames = new Set(candidates.filter(t => always(t) || requiredTools.includes(t.name)).map(t => t.name));
  try {
    const result = await dispatch('agent:tools:select', {
      ...context, tools: structuredClone(tools), availableTools: structuredClone(availableTools),
      requiredTools: [...protectedNames],
    });
    if (!Array.isArray(result?.selectedToolNames)) return tools;
    
    
    
    const eligible = Array.isArray(result.eligibleToolNames)
      ? new Set(result.eligibleToolNames)
      : null;
    const names = new Set([...result.selectedToolNames, ...protectedNames]);
    
    
    
    return candidates.filter(t => names.has(t.name) && (!eligible || eligible.has(t.name)));
  } catch {
    return tools;
  }
}
