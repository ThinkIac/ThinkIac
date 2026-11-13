import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
    new URL("../views/Widget.svelte", import.meta.url),
    "utf8",
);

test("widget troca a lista pela tela de detalhes da conta selecionada", () => {
    assert.match(source, /let selectedAccount = null;/);
    assert.match(source, /function openAccount\(account\)/);
    assert.match(source, /function returnToAccounts\(\)/);
    assert.match(source, /on:click=\{\(\) => openAccount\(account\)\}/);
    assert.match(source, /\{#if selectedAccount\}/);
    assert.match(source, /on:click=\{returnToAccounts\}/);
    assert.match(source, /\bBack\b/);
    assert.doesNotMatch(source, /class:expanded=/);
});

test("widget mostra as janelas curta e semanal com reset na prévia", () => {
    assert.match(source, /function previewWindows\(account\)/);
    assert.match(source, /resets in \{formatReset\(window\.resetsAt\)\}/);
    assert.match(source, /return "Week";/);
});

test("widget usa textos em inglês e mantém a atualização pequena no topo", () => {
    assert.doesNotMatch(source, />Quota Codex</);
    assert.match(source, /<header class="widget-meta">/);
    assert.match(source, /Updated \{relativeUpdated\(updatedAt\)\}/);
});

test("widget do menu permanece plano e sem superfícies próprias", () => {
    assert.match(source, /\.wrap\s*\{[^}]*background:\s*transparent;/s);
    assert.match(source, /\.account-card\s*\{[^}]*border(?:-top)?:\s*1px solid var\(--tk-border\);[^}]*background:\s*transparent;/s);
});

test("widget acompanha a chave de tema canônica do Shell", () => {
    assert.match(source, /const THEME_KEY = "agent:theme";/);
    assert.doesNotMatch(source, /const THEME_KEY = "think:theme";/);
});

test("widget mantém uma coluna centralizada e contida", () => {
    assert.match(source, /\.wrap\s*\{[^}]*max-width:\s*420px;[^}]*margin:\s*0 auto;/s);
    assert.match(source, /\.account-list\s*\{[^}]*border-radius:\s*12px;/s);
});
