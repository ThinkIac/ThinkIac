import assert from "node:assert/strict";
import test from "node:test";

import {
    BLOCK_REGEX,
    getProps,
    registerRenderer,
    resolveType,
    unregisterRenderer,
} from "./renderers.js";

test("pacotes podem registrar renderer, aliases e props sem editar MessageList", () => {
    const loader = async () => ({ default: class TestWidget {} });
    registerRenderer("xray", loader, {
        aliases: ["radiografia"],
        propMap: (source) => ({ image: source.trim() }),
    });

    assert.equal(resolveType("xray"), "xray");
    assert.equal(resolveType("RADIOGRAFIA"), "xray");
    assert.deepEqual(getProps("xray", " exame.png "), { image: "exame.png" });

    BLOCK_REGEX.lastIndex = 0;
    const match = BLOCK_REGEX.exec("```radiografia\nexame.png\n```");
    assert.ok(match);
    assert.equal(resolveType(match[1]), "xray");
    assert.equal(match[2].trim(), "exame.png");

    unregisterRenderer("xray");
    assert.equal(resolveType("xray"), null);
    assert.equal(resolveType("radiografia"), null);
});
