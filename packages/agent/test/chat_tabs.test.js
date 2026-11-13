import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { closeAllChatTabs, closeChatTab } from "../views/lib/chat_tabs.js";

const base = {
    tabs: [
        { sessionId: "orbit-a", name: "A" },
        { sessionId: "orbit-b", name: "B" },
    ],
    activeTab: "orbit-b",
    sessionId: "orbit-b",
    history: [{ role: "user", content: "oi" }],
    activeIsApp: false,
};


assert.deepEqual(closeChatTab("orbit-b", base), {
    ...base,
    tabs: [{ sessionId: "orbit-a", name: "A" }],
    activeTab: "orbit-a",
    sessionId: "orbit-a",
});


assert.deepEqual(closeChatTab("orbit-a", {
    ...base,
    tabs: [{ sessionId: "orbit-a", name: "A" }],
    activeTab: "orbit-a",
    sessionId: "orbit-a",
}), {
    ...base,
    tabs: [],
    activeTab: "",
    sessionId: "",
    history: [],
    activeIsApp: false,
});


assert.deepEqual(closeAllChatTabs({ ...base, activeTab: "tasks", activeIsApp: true }), {
    ...base,
    tabs: [],
    activeTab: "tasks",
    sessionId: "",
    history: [],
    activeIsApp: true,
});


assert.deepEqual(closeAllChatTabs({
    ...base,
    loadingMap: { "orbit-a": true },
    unreadMap: { "orbit-b": true },
}), {
    ...base,
    tabs: base.tabs,
    loadingMap: { "orbit-a": true },
    unreadMap: { "orbit-b": true },
});


assert.deepEqual(closeAllChatTabs({
    ...base,
    loadingMap: { "orbit-a": false, "orbit-b": false },
    unreadMap: { "orbit-a": false, "orbit-b": false },
}), {
    ...base,
    tabs: [],
    activeTab: "",
    sessionId: "",
    history: [],
    activeIsApp: false,
    loadingMap: {},
    unreadMap: {},
});

const [compact, menuList, sidebar, home] = await Promise.all([
    readFile(new URL("../views/ChatSessionsCompact.svelte", import.meta.url), "utf8"),
    readFile(new URL("../views/MenuList.svelte", import.meta.url), "utf8"),
    readFile(new URL("../views/Sidebar.svelte", import.meta.url), "utf8"),
    readFile(new URL("../views/Home.svelte", import.meta.url), "utf8"),
]);

assert.doesNotMatch(compact, /chatTabs\.length > 1/);
assert.doesNotMatch(compact, /Nenhuma conversa aberta/);
assert.match(compact, /const PAGE_SIZE = 8/);
assert.match(compact, /csc-pagination/);
assert.doesNotMatch(compact, /csc-pulse/);
assert.match(menuList, /aria-label="Fechar conversas prontas"/);
assert.match(menuList, /disabled=\{chatTabs\.length === 0\}/);
assert.match(sidebar, /closeAllChats/);
assert.match(sidebar, /import \{ createEventDispatcher, tick \} from "svelte"/);
assert.match(sidebar, /const openedMobilePanel = isMobile && mobilePanel && mobilePanel !== previousMobilePanel/);
assert.match(sidebar, /if \(scrollEl\) scrollEl\.scrollTop = 0/);
assert.match(sidebar, /bind:this=\{leftScrollEl\}/);
assert.match(sidebar, /bind:this=\{rightScrollEl\}/);
assert.match(sidebar, /bind:this=\{desktopScrollEl\}/);
assert.match(home, /on:closeAllChats=\{handleCloseAllChats\}/);

console.log("chat tabs: ok");
