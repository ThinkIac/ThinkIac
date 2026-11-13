import test from "node:test";
import assert from "node:assert/strict";

import { applyGeneratedThemeToDocument } from "./theme.js";

function fakeDocument() {
    const nodes = new Map();
    const document = {
        documentElement: { dataset: {} },
        head: {
            appendChild(node) {
                nodes.set(node.id, node);
                return node;
            },
        },
        createElement() { return { id: "", textContent: "" }; },
        getElementById(id) { return nodes.get(id) || null; },
    };
    return document;
}

test("aplica o tema gerado em um documento isolado", () => {
    const document = fakeDocument();
    const applied = applyGeneratedThemeToDocument(document, "ocean", ":root { --tk-bg: #123456; }");

    assert.equal(applied, true);
    assert.equal(document.documentElement.dataset.thinkiacTheme, "ocean");
    assert.equal(document.getElementById("thinkiac-generated-theme").textContent, ":root { --tk-bg: #123456; }");
});

test("atualiza a tag existente sem duplicar estilos", () => {
    const document = fakeDocument();
    applyGeneratedThemeToDocument(document, "first", "old css");
    const style = document.getElementById("thinkiac-generated-theme");
    applyGeneratedThemeToDocument(document, "second", "new css");

    assert.equal(document.getElementById("thinkiac-generated-theme"), style);
    assert.equal(style.textContent, "new css");
    assert.equal(document.documentElement.dataset.thinkiacTheme, "second");
});

test("não aplica payload incompleto", () => {
    const document = fakeDocument();
    assert.equal(applyGeneratedThemeToDocument(document, "", "css"), false);
    assert.equal(applyGeneratedThemeToDocument(document, "theme", ""), false);
    assert.equal(document.getElementById("thinkiac-generated-theme"), null);
});
