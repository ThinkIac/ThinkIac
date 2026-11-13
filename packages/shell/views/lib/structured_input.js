const KNOWN_TYPES = new Set(["confirm", "multi_choice", "prompt", "rating"]);

const TYPE_ALIASES = new Map([
    ["confirmation", "confirm"],
    ["confirmacao", "confirm"],
    ["confirmar", "confirm"],
    ["choice", "multi_choice"],
    ["choices", "multi_choice"],
    ["select", "multi_choice"],
    ["selection", "multi_choice"],
    ["options", "multi_choice"],
    ["texto", "prompt"],
    ["text", "prompt"],
    ["input", "prompt"],
]);

function normalizeType(value, step) {
    const raw = String(value || "").trim().toLowerCase();
    if (KNOWN_TYPES.has(raw)) return raw;
    if (TYPE_ALIASES.has(raw)) return TYPE_ALIASES.get(raw);
    if (Array.isArray(step.options) || Array.isArray(step.opcoes)) return "multi_choice";
    return null;
}

function normalizeStep(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;

    const type = normalizeType(value.type ?? value.tipo, value);
    if (!type) return null;

    const question = value.question ?? value.pergunta;
    const options = value.options ?? value.opcoes;
    const step = { ...value, type };

    if (question !== undefined) step.question = question;
    delete step.pergunta;
    delete step.tipo;

    if (options !== undefined) step.options = options;
    delete step.opcoes;

    return step;
}

function parseBlock(content) {
    try {
        const parsed = JSON.parse(content.replace(/\u00a0/g, " ").trim());
        const values = Array.isArray(parsed) ? parsed : [parsed];
        const steps = values.map(normalizeStep);
        return steps.length && steps.every(Boolean) ? steps : null;
    } catch {
        return null;
    }
}

/**
 * Extracts a supported StructuredInput payload without swallowing malformed
 * message content. The canonical `thinkiac` fence stays fully supported.
 */
export function extractStructuredInput(content) {
    if (typeof content !== "string") return { content, steps: null };

    const match = content.match(/```(?:thinkiac|structuredinput)\s*\n?([\s\S]*?)\s*```|<structuredinput\s*>([\s\S]*?)<\/structuredinput\s*>/i);
    if (!match) return { content, steps: null };

    const steps = parseBlock(match[1] ?? match[2] ?? "");
    if (!steps) return { content, steps: null };

    return {
        content: content.replace(match[0], "").trim(),
        steps,
    };
}
