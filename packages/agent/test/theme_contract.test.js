import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { getTheme as getAgentTheme } from "../views/theme.js";
import { getTheme as getShellTheme } from "../../shell/views/theme.js";
import { getTheme as getDesktopTheme } from "../../desktop/views/lib/theme.js";

const packagesRoot = new URL("../../", import.meta.url);
const legacyKey = "aurora:" + "theme";
const legacyEvent = "aurora:" + "theme-changed";

async function collectSourceFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            if (["data", "uploads", ".atomic_bin", ".backups", "views.bak"].includes(entry.name)) return [];
            return collectSourceFiles(fullPath);
        }
        return /\.(?:js|svelte)$/.test(entry.name) && !entry.name.endsWith('.test.js') ? [fullPath] : [];
    }));
    return nested.flat();
}

test("o contrato ativo usa think:theme e conserva a migração de preferência legada", async () => {
    const [agentTheme, shellTheme, desktopTheme] = await Promise.all([
        readFile(new URL("../views/theme.js", import.meta.url), "utf8"),
        readFile(new URL("../../shell/views/theme.js", import.meta.url), "utf8"),
        readFile(new URL("../../desktop/views/lib/theme.js", import.meta.url), "utf8"),
    ]);

    for (const source of [agentTheme, shellTheme, desktopTheme]) {
        assert.match(source, /THEME_KEY\s*=\s*["']think:theme["']/);
        assert.match(source, /LEGACY_THEME_KEY/);
        assert.match(source, /localStorage\.setItem\((?:THEME_KEY|KEY),/);
    }
    assert.match(agentTheme, /think:theme-changed/);
    assert.match(shellTheme, /think:theme-changed/);
    assert.match(desktopTheme, /think:theme-changed/);
});

test("a leitura legada persiste o tema na chave nova", () => {
    const previousStorage = globalThis.localStorage;
    const values = new Map([[legacyKey, "light"]]);
    globalThis.localStorage = {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, String(value)),
    };

    try {
        for (const getTheme of [getAgentTheme, getShellTheme, getDesktopTheme]) {
            values.delete("think:theme");
            assert.equal(getTheme(), "light");
            assert.equal(values.get("think:theme"), "light");
        }
    } finally {
        globalThis.localStorage = previousStorage;
    }
});

test("consumidores ativos não dependem da chave ou evento legados", async () => {
    const files = await collectSourceFiles(fileURLToPath(packagesRoot));
    const exceptions = new Set([
        fileURLToPath(new URL("../views/theme.js", import.meta.url)),
        fileURLToPath(new URL("../../shell/views/theme.js", import.meta.url)),
        fileURLToPath(new URL("../../desktop/views/lib/theme.js", import.meta.url)),
        fileURLToPath(new URL("./theme_contract.test.js", import.meta.url)),
    ]);
    const legacyReferences = [];

    for (const file of files) {
        if (exceptions.has(file)) continue;
        const source = await readFile(file, "utf8");
        if (source.includes(legacyKey) || source.includes(legacyEvent)) legacyReferences.push(file);
    }

    assert.deepEqual(legacyReferences, []);
});

test("Desktop define o canvas do iframe antes da view montar", async () => {
    const source = await readFile(new URL("../../desktop/views/lib/iframe-theme.js", import.meta.url), "utf8");
    assert.match(source, /target\.documentElement\.dataset\.theme\s*=/);
    assert.match(source, /html, body\s*\{\s*background:/);
});
