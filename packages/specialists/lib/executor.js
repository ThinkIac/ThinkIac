import { composePrompt, getSpecialistById, resolveModelSpec } from './catalog.js';

const DEFAULT_MAX_HISTORY = 8;

function normalizeMessages(messages = []) {
  return messages.slice(-DEFAULT_MAX_HISTORY)
    .filter((item) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
    .map((item) => ({ role: item.role, content: item.content.slice(0, 1200) }));
}

export function specialistTurnPrompt({ message, messages = [], context = null }) {
  const history = normalizeMessages(messages);
  return [
    context ? `Contexto confiável do canal:\n${JSON.stringify(context)}` : '',
    history.length ? `Histórico recente:\n${history.map((item) => `${item.role}: ${item.content}`).join('\n')}` : '',
    `Mensagem atual da pessoa:\n${String(message || '').slice(0, 1200)}`,
  ].filter(Boolean).join('\n\n');
}

/** Executa um especialista externo com uma allowlist literal de tools. */
export async function executeSpecialist({ specialistId, message, messages = [], context = null, toolNames = [], outputSchema = null, maxSteps = 6, model = null, sessionId = null }, invoke = null) {
  const specialist = getSpecialistById(specialistId);
  if (!specialist) throw new Error(`Especialista "${specialistId}" não encontrado`);
  const allowed = specialist.toolsAllowlist === null ? toolNames : toolNames.filter((name) => specialist.toolsAllowlist.includes(name));
  // Uma allowlist vazia é uma escolha válida para canais públicos: o modelo
  // responde sem tools. Só a ausência da allowlist representa acesso geral,
  // tratado pelo consumidor do canal antes de chegar aqui.
  const selectedModel = model || resolveModelSpec(specialist)?.model || null;
  const run = invoke || (async (payload, governance) => {
    const { invokeRuntimeTool } = await import('../../agent/core/runtime_bridge.js');
    return invokeRuntimeTool('aurora', 'call_llm_agent', payload, governance);
  });
  const result = await run({
    prompt: specialistTurnPrompt({ message, messages, context }),
    system: composePrompt(specialist),
    tool_names: allowed,
    model: selectedModel,
    max_steps: maxSteps,
    ...(sessionId ? { sessionId } : {}),
    ...(outputSchema ? { output_schema: outputSchema } : {}),
  }, sessionId ? { sessionId } : null);
  if (!result?.success) throw new Error(result?.error || 'Não foi possível executar o especialista.');
  return { ...result, specialistId: specialist.id, tools: allowed };
}
