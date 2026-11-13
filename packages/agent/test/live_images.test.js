import assert from "node:assert/strict";
import test from "node:test";
import { renderMarkdown } from "../views/lib/markdown.js";
import { enhanceLiveImages } from "../views/lib/live_images.js";

test("marca somente a imagem gerada com o titulo reservado viva", () => {
    const live = renderMarkdown('![imagem](/generated.webp "viva")');
    const normal = renderMarkdown("![diagrama](/diagram.png)");
    assert.match(live, /data-live-image="true"/);
    assert.doesNotMatch(live, /title="viva"/);
    assert.doesNotMatch(normal, /data-live-image/);
});

test("a action de imagem viva e segura durante SSR", () => {
    assert.deepEqual(enhanceLiveImages({}), {});
});
