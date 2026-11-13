import assert from "node:assert/strict";
import test from "node:test";

import { compactStepDetail, compactStepSummary, latestStepReasoning } from "./react_step_summary.js";

test("prioriza o reasoning da última step para a prévia ativa", () => {
    const steps = [
        { reasoning: "Primeiro raciocínio" },
        { reasoning: "Raciocínio atual" },
    ];

    assert.equal(latestStepReasoning(steps, "Reasoning inicial"), "Raciocínio atual");
});

test("mantém a prévia da tool em uma linha e limita argumentos extensos", () => {
    const summary = compactStepSummary({
        label: "run_shell",
        args: { command: "git status\n" + "x".repeat(300) },
    });

    assert.match(summary, /^run_shell · git status…$/);
    assert.ok(summary.endsWith("…"));
    assert.ok(summary.length <= 145);
    assert.doesNotMatch(summary, /\n/);
});

test("degrada para o nome da tool quando não há argumentos", () => {
    assert.equal(compactStepSummary({ label: "read_file" }), "read_file");
});

test("separa o argumento compacto para a linha plana da timeline", () => {
    assert.equal(
        compactStepDetail({ label: "run_shell", args: { command: "git status" } }),
        "git status",
    );
});
