// Display copy lives beside the keyboard matcher so changes to the shell's
// shortcuts have one obvious place to update. `Mod` is rendered as Ctrl / ⌘ by
// the InputBar, keeping the catalog platform-neutral.
export const desktopShortcutGroups = [
    {
        id: "writing",
        label: "Writing and sending",
        shortcuts: [
            { keys: ["Enter"], label: "Send message" },
            { keys: ["Shift", "Enter"], label: "Start a new line" },
        ],
    },
    {
        id: "navigation",
        label: "Search and navigation",
        shortcuts: [
            { keys: ["Mod", "K"], label: "Open global search" },
            { keys: ["Mod", "B"], label: "Toggle sidebar", action: "toggle-sidebar" },
            { keys: ["Escape"], label: "Close the topmost panel" },
        ],
    },
    {
        id: "tabs",
        label: "Tab navigation alternatives · outside text fields",
        shortcuts: [
            { keys: ["Mod", "Shift", "1–0"], label: "Open tab by position", action: "select-index" },
            { keys: ["Mod", "Shift", "→"], label: "Open next tab", action: "next-tab" },
            { keys: ["Mod", "Shift", "←"], label: "Open previous tab", action: "previous-tab" },
        ],
    },
    {
        id: "tabs-legacy",
        label: "Tabs · Electron / browser permitting",
        shortcuts: [
            { keys: ["Mod", "1–0"], label: "Open tab by position", action: "select-index" },
            { keys: ["Mod", "Tab"], label: "Open next tab", action: "next-tab" },
            { keys: ["Mod", "Shift", "Tab"], label: "Open previous tab", action: "previous-tab" },
            { keys: ["Mod", "W"], label: "Close active tab", action: "close-active" },
            { keys: ["Mod", "Shift", "W"], label: "Close all tabs (browser may close the window)", action: "close-all" },
        ],
    },
    {
        id: "recovery",
        label: "Refresh and recovery",
        shortcuts: [
            { keys: ["Mod", "R"], label: "Refresh active tab", action: "refresh-active" },
            { keys: ["Mod", "Shift", "R"], label: "Reopen active tab", action: "reopen-active" },
            { keys: ["Mod", "Alt", "R"], label: "Refresh all tabs", action: "refresh-all" },
            { keys: ["Mod", "Alt", "Shift", "R"], label: "Recover runtime", action: "recover-runtime" },
        ],
    },
];

export function desktopShortcutAction(event, { isMobile = false } = {}) {
    if (
        isMobile
        || event?.isComposing
        || event?.getModifierState?.("AltGraph")
        || (!event?.ctrlKey && !event?.metaKey)
    ) return null;

    const key = String(event.key || "").toLowerCase();
    const code = String(event.code || "");
    if (event.shiftKey && !event.altKey) {
        const digit = /^Digit([0-9])$/.exec(code)?.[1];
        if (digit) return { type: "select-index", index: digit === "0" ? 9 : Number(digit) - 1 };
        if (code === "ArrowRight" || key === "arrowright") return { type: "next-tab" };
        if (code === "ArrowLeft" || key === "arrowleft") return { type: "previous-tab" };
    }
    if (key === "r") {
        if (event.shiftKey && event.altKey) return { type: "recover-runtime" };
        if (event.altKey) return { type: "refresh-all" };
        if (event.shiftKey) return { type: "reopen-active" };
        return { type: "refresh-active" };
    }
    if (event.altKey) return null;
    if (key === "b" && !event.shiftKey) return { type: "toggle-sidebar" };
    if (key === "w") return { type: event.shiftKey ? "close-all" : "close-active" };
    if (key === "tab") return { type: event.shiftKey ? "previous-tab" : "next-tab" };
    if (!event.shiftKey && /^[0-9]$/.test(key)) {
        return { type: "select-index", index: key === "0" ? 9 : Number(key) - 1 };
    }
    return null;
}

export function isEditableShortcutTarget(target) {
    return Boolean(target?.closest?.("input, textarea, select, [contenteditable]:not([contenteditable='false'])"));
}

export function isTextEditingShortcut(event, action) {
    if (action?.type === "toggle-sidebar") return true;
    const code = String(event?.code || "");
    const key = String(event?.key || "").toLowerCase();
    return Boolean(event?.shiftKey && !event?.altKey && (/^Digit[0-9]$/.test(code) || ["ArrowRight", "ArrowLeft"].includes(code) || ["arrowright", "arrowleft"].includes(key)));
}

export function adjacentTabId(tabs, activeId, direction) {
    if (!tabs.length) return null;
    const current = Math.max(0, tabs.findIndex((tab) => tab.sessionId === activeId));
    const next = (current + direction + tabs.length) % tabs.length;
    return tabs[next]?.sessionId ?? null;
}
