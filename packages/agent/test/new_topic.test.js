import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createNewTopicWorkspace } from "../views/lib/new_topic.js";

const current = {
    tabs: [{ sessionId: "orbit-old", name: "Em andamento", pinned: true }],
    appTabs: [{ id: "tasks", name: "Tasks" }],
    loadingMap: { "orbit-old": true },
    unreadMap: { "orbit-old": 2 },
};
const next = createNewTopicWorkspace("orbit-new", current);

assert.deepEqual(next.tabs, [
    { sessionId: "orbit-old", name: "Em andamento", pinned: true },
    { sessionId: "orbit-new", name: "Nova Missão", pinned: false },
]);
assert.deepEqual(next.appTabs, current.appTabs);
assert.equal(next.activeTab, "orbit-new");
assert.equal(next.sessionId, "orbit-new");
assert.deepEqual(next.history, []);
assert.equal(next.activeIsApp, false);
assert.deepEqual(next.loadingMap, current.loadingMap);
assert.deepEqual(next.unreadMap, current.unreadMap);

const [sidebar, menuList, sessions] = await Promise.all([
    readFile(new URL("../views/Sidebar.svelte", import.meta.url), "utf8"),
    readFile(new URL("../views/MenuList.svelte", import.meta.url), "utf8"),
    readFile(new URL("../views/Sessions.svelte", import.meta.url), "utf8"),
]);

assert.equal(sidebar.includes("<!-- Footer -->"), false);
assert.equal(sidebar.includes('class="new-topic-btn'), false);
const activeSessionsBlock = menuList.match(
    /item\.id === "chat-sessions"([\s\S]*?)item\.id === "sessions"/,
)?.[1] ?? "";
const sessionsBlock = menuList.match(
    /item\.id === "sessions"([\s\S]*?)\{:else\}/,
)?.[1] ?? "";

assert.match(activeSessionsBlock, /on:click=\{onNewTopic\}[\s\S]*<ChatSessionsCompact/);
assert.match(activeSessionsBlock, /rounded-\[var\(--tk-radius-md\)\]/);
assert.doesNotMatch(sessionsBlock, /on:click=\{onNewTopic\}/);
assert.match(sessions, /class="[^"]*\bsessions-new-topic\b[^"]*"[\s\S]*on:click=\{onNewTopic\}/);

console.log("new topic workspace: ok");
