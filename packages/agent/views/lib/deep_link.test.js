import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { resolveNotificationDeepLink } from "./deep_link.js";

const origin = "https://thinkiac.cloud";

test("resolve deep-links internos de chat, app e resultado", () => {
    assert.deepEqual(
        resolveNotificationDeepLink("/view/agent/Home?open=chat&session=orbit-1", origin),
        { type: "chat", session: "orbit-1" },
    );
    assert.deepEqual(
        resolveNotificationDeepLink(`${origin}/view/agent/Home?open=app&app=tasks`, origin),
        { type: "app", app: "tasks" },
    );
    assert.deepEqual(
        resolveNotificationDeepLink("/view/agent/Home?open=result&pkg=cnpj-scraper&file=uploads%2Fresult.csv", origin),
        { type: "result", pkg: "cnpj-scraper", file: "uploads/result.csv" },
    );
});

test("rejeita links internos incompletos e preserva links externos", () => {
    assert.equal(resolveNotificationDeepLink("/view/agent/Home?open=chat", origin), null);
    assert.equal(resolveNotificationDeepLink("/view/agent/Home?open=unknown", origin), null);
    assert.deepEqual(
        resolveNotificationDeepLink("https://example.com/docs", origin),
        { type: "external", href: "https://example.com/docs" },
    );
});

test("NtfyInbox despacha deep-links internos pelo bus local sem refresh", async () => {
    const source = await readFile(
        new URL("../components/NtfyInbox.svelte", import.meta.url),
        "utf8",
    );

    
    assert.match(
        source,
        /import\s*\{[^}]*emitLocal\s+as\s+busEmitLocal[^}]*\}\s*from\s*["']\.\.\/lib\/bus\.js["']/s,
    );
    assert.match(source, /busEmitLocal\(["']agent:deep-link["'],\s*target\)/);
});
