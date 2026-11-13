import assert from "node:assert/strict";
import {
    clearComposerDraft,
    loadComposerDraft,
    saveComposerDraft,
} from "./composer_drafts.js";

const values = new Map();
const storage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
};


saveComposerDraft("orbit-a", "rascunho A", storage);
saveComposerDraft("orbit-b", "rascunho B", storage);
assert.equal(loadComposerDraft("orbit-a", storage), "rascunho A");
assert.equal(loadComposerDraft("orbit-b", storage), "rascunho B");


assert.equal(loadComposerDraft("orbit-a", storage), "rascunho A");


clearComposerDraft("orbit-a", storage);
assert.equal(loadComposerDraft("orbit-a", storage), "");
assert.equal(loadComposerDraft("orbit-b", storage), "rascunho B");


saveComposerDraft("", "ignorado", storage);
assert.equal(loadComposerDraft("", storage), "");
assert.equal(loadComposerDraft("orbit-c", null), "");
assert.doesNotThrow(() => saveComposerDraft("orbit-c", "texto", null));

console.log("composer drafts: ok");
