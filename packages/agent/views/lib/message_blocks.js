import { BLOCK_REGEX, OPEN_BLOCK_REGEX, resolveType } from "./renderers.js";

/**
 * Separa texto Markdown dos fenced blocks que têm renderizadores próprios.
 * Durante streaming, mantém o último bloco aberto disponível para preview.
 */
export function parseMessageBlocks(raw, isStreaming = false) {
    if (!raw) return { blocks: [], openBlock: null };

    const matches = [];
    BLOCK_REGEX.lastIndex = 0;
    let match;
    while ((match = BLOCK_REGEX.exec(raw)) !== null) {
        const type = resolveType(match[1]);
        if (!type) continue;
        matches.push({
            index: match.index,
            length: match[0].length,
            type,
            content: match[2].trim(),
        });
    }

    matches.sort((a, b) => a.index - b.index);

    const blocks = [];
    let currentPos = 0;
    for (const item of matches) {
        if (item.index < currentPos) continue;
        if (item.index > currentPos) {
            const textChunk = raw.slice(currentPos, item.index);
            if (textChunk.trim() || textChunk.includes("\n")) {
                blocks.push({ type: "text", content: textChunk });
            }
        }
        blocks.push({ type: item.type, content: item.content });
        currentPos = item.index + item.length;
    }

    const remaining = raw.slice(currentPos);
    let openBlock = null;
    if (isStreaming && remaining) {
        const openMatch =
            remaining.match(OPEN_BLOCK_REGEX) ||
            remaining.match(/```([a-zA-Z0-9_+-]*)[ \t]*[^\n]*\n([\s\S]*)$/);
        if (openMatch) {
            const [lang, partialContent] = [openMatch[1], openMatch[2]];
            const textBefore = remaining.slice(0, openMatch.index);
            if (textBefore.trim() || textBefore.includes("\n")) {
                blocks.push({ type: "text", content: textBefore, pending: true });
            }
            const type = resolveType(lang);
            openBlock = type && partialContent.trim().length > 10
                ? { type, content: partialContent, partial: true }
                : { type: "generic_code", lang, content: partialContent, partial: true };
        } else if (remaining.trim() || remaining.includes("\n")) {
            blocks.push({ type: "text", content: remaining });
        }
    } else if (remaining.trim() || remaining.includes("\n")) {
        blocks.push({ type: "text", content: remaining });
    }

    return { blocks: blocks.length ? blocks : [{ type: "text", content: raw }], openBlock };
}
