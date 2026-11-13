import assert from "node:assert/strict";
import test from "node:test";

import { parseMessageBlocks } from "./message_blocks.js";

test("preserva texto e entrega blocos registrados ao renderer dinâmico", () => {
    const parsed = parseMessageBlocks("Antes\n\n```mermaid\ngraph TD\n```\n\nDepois");

    assert.deepEqual(parsed.blocks, [
        { type: "text", content: "Antes\n\n" },
        { type: "mermaid", content: "graph TD" },
        { type: "text", content: "\n\nDepois" },
    ]);
    assert.equal(parsed.openBlock, null);
});

test("mantém fenced block incompleto como preview durante streaming", () => {
    const parsed = parseMessageBlocks("Resposta\n```mermaid\ngraph TD\n  A --> B", true);

    assert.deepEqual(parsed.blocks, [{ type: "text", content: "Resposta\n", pending: true }]);
    assert.deepEqual(parsed.openBlock, {
        type: "mermaid",
        content: "graph TD\n  A --> B",
        partial: true,
    });
});

test("não interpreta bloco incompleto quando a mensagem não está em streaming", () => {
    const source = "```mermaid\ngraph TD";
    const parsed = parseMessageBlocks(source, false);

    assert.deepEqual(parsed.blocks, [{ type: "text", content: source }]);
    assert.equal(parsed.openBlock, null);
});
