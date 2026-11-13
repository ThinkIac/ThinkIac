import test from "node:test";
import assert from "node:assert/strict";

import { applyGeneratedThemeToDocument, applyThemeScrollbarToDocument } from "./theme.js";

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

test("aplica scrollbar discreta baseada no tema ao documento do iframe", () => {
    const document = fakeDocument();

    assert.equal(applyThemeScrollbarToDocument(document, "light"), true);
    assert.equal(document.documentElement.dataset.thinkiacThemeMode, "light");
    const style = document.getElementById("thinkiac-theme-scrollbar");
    assert.match(style.textContent, /scrollbar-width:\s*thin/);
    assert.match(style.textContent, /::-webkit-scrollbar/);
    assert.match(style.textContent, /6px/);
    assert.match(style.textContent, /--thinkiac-scrollbar-thumb:/);
    assert.match(style.textContent, /!important/);

    applyThemeScrollbarToDocument(document, "dark");
    assert.equal(document.getElementById("thinkiac-theme-scrollbar"), style);
    assert.equal(document.documentElement.dataset.thinkiacThemeMode, "dark");
});
