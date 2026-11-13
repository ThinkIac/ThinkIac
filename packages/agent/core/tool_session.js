function asObject(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Makes the active chat session available to every runtime tool invocation.
 * Runtime tools are called both directly and through `run_runtime_tool`; both
 * forms must resolve ownership against the same authenticated player presence.
 */
export function injectToolSession(toolCalls, sessionId, depth = 0) {
  if (depth > 8) throw new Error('Encadeamento de ferramentas excessivo.');
  for (const toolCall of toolCalls || []) {
    const input = asObject(toolCall?.input);
    if (!input) continue;

    input.sessionId = sessionId;
    toolCall.input = input;

    if (toolCall.name === 'run_tool') {
      const nested = {name: input.name, input: input.input || {}};
      injectToolSession([nested], sessionId, depth + 1);
      input.input = nested.input;
    }
    if (toolCall.name === 'run_parallel') injectToolSession(input.tools, sessionId, depth + 1);
    if (toolCall.name !== 'run_runtime_tool') continue;
    const args = asObject(input.args ?? {});
    if (!args) continue;
    args.sessionId = sessionId;
    input.args = args;
  }
}
