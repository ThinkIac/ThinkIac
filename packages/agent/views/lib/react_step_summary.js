const PREVIEW_LIMIT = 140;

function oneLine(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
}

function shorten(value) {
    return value.length > PREVIEW_LIMIT
        ? `${value.slice(0, PREVIEW_LIMIT - 1).replace(/\s+\S*$/, "")}…`
        : value;
}

function firstArgument(args) {
    if (args == null) return "";
    if (typeof args === "string") return oneLine(args);
    if (typeof args !== "object") return oneLine(args);

    const preferred = ["command", "path", "file_path", "query", "pattern", "url", "prompt"];
    const key = preferred.find((name) => args[name] != null) ?? Object.keys(args)[0];
    if (!key) return "";
    const value = args[key];
    return oneLine(typeof value === "string" ? value : JSON.stringify(value));
}

export function compactStepSummary(step = {}) {
    const label = oneLine(step.label) || "step";
    const argument = firstArgument(step.args);
    const summary = argument ? `${label} · ${argument}` : label;
    return shorten(summary);
}

export function compactStepDetail(step = {}) {
    const argument = firstArgument(step.args);
    if (!argument) return "";
    return shorten(argument);
}

export function latestStepReasoning(steps, fallback = "") {
    for (let index = (steps?.length ?? 0) - 1; index >= 0; index -= 1) {
        const reasoning = steps[index]?.reasoning;
        if (reasoning) return reasoning;
    }
    return fallback;
}
