import assert from "node:assert/strict";
import test from "node:test";

import { renderMarkdown } from "./markdown.js";

test("renderiza Markdown comum com listas e tabelas nativas", () => {
    const html = renderMarkdown(
        "# Título\n\n- um\n- dois\n\n| A | B |\n|---|---|\n| 1 | 2 |",
    );

    assert.match(html, /<h1>Título<\/h1>/);
    assert.match(html, /<ul>/);
    assert.match(html, /<table>/);
});

test("mantém a apresentação existente de checklist", () => {
    const html = renderMarkdown("- [x] feito\n- [ ] falta");

    assert.match(html, /<ul class="task-list">/);
    assert.match(html, /class="task-checkbox checked"/);
    assert.match(html, /class="task-checkbox"/);
    assert.doesNotMatch(html, /<input/);
});

test("não executa HTML bruto vindo da resposta", () => {
    const html = renderMarkdown(
        '<script>alert("xss")</script><img src=x onerror=alert(1)>',
    );

    assert.doesNotMatch(html, /<script|<img/i);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /&lt;img/);
});

test("mantém links, imagens com largura e carregamento lazy", () => {
    const html = renderMarkdown(
        "[Docs](https://example.com)\n\n![Mapa](https://example.com/a.png){width=128}",
    );

    assert.match(html, /target="_blank"/);
    assert.match(html, /rel="noopener noreferrer"/);
    assert.match(html, /<img[^>]+width="128"[^>]+loading="lazy"/);
});

test("preserva matemática, admonitions e notas de rodapé", () => {
    const html = renderMarkdown(
        "A identidade $e^{i\\pi}+1=0$.[^e]\n\n> [!TIP]\n> Leia isto.\n\n[^e]: Euler",
    );

    assert.match(html, /class="katex"/);
    assert.match(html, /class="admonition admonition-tip"/);
    assert.match(html, /class="footnotes"/);
    assert.match(html, /Euler/);
});

test("não transforma fenced blocks de plugins em HTML genérico", () => {
    const source = "```counter\n10 Cliques\n```";
    const html = renderMarkdown(source);

    assert.match(html, /<pre><code class="language-counter">/);
    assert.doesNotMatch(html, /iframe|pkg-widget/);
});
