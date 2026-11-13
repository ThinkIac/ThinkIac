import assert from "node:assert/strict";
import test from "node:test";

import { extractStructuredInput } from "./structured_input.js";

test("extrai o protocolo canônico thinkiac e remove somente o bloco", () => {
    const source = 'Antes\n```thinkiac\n[{"type":"confirm","question":"Prosseguir?"}]\n```\nDepois';

    assert.deepEqual(extractStructuredInput(source), {
        content: "Antes\n\nDepois",
        steps: [{ type: "confirm", question: "Prosseguir?" }],
    });
});

test("normaliza StructuredInput em fence e aliases legados", () => {
    const source = '```StructuredInput\n{"pergunta":"Qual opção?","opcoes":["A","B"]}\n```';

    assert.deepEqual(extractStructuredInput(source).steps, [{
        type: "multi_choice",
        question: "Qual opção?",
        options: ["A", "B"],
    }]);
});

test("aceita StructuredInput em tag XML", () => {
    const source = '<StructuredInput>{"type":"prompt","pergunta":"Descreva"}</StructuredInput>';

    assert.deepEqual(extractStructuredInput(source).steps, [{
        type: "prompt",
        question: "Descreva",
    }]);
});

test("não ativa formulário para payload sem tipo reconhecido", () => {
    const source = '```thinkiac\n{"question":"Sem tipo"}\n```';

    assert.deepEqual(extractStructuredInput(source), {
        content: source,
        steps: null,
    });
});
