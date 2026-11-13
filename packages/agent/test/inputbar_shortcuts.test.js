import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { desktopShortcutGroups, desktopShortcutAction } from "../views/lib/desktop_shortcuts.js";

const inputBarPath = new URL("../views/InputBar2.svelte", import.meta.url);

test("desktop shortcut documentation covers every registered shell action", () => {
  const documentedActions = new Set(
    desktopShortcutGroups.flatMap((group) => group.shortcuts.map((shortcut) => shortcut.action).filter(Boolean)),
  );
  const events = [
    { key: "b", ctrlKey: true },
    { key: "w", ctrlKey: true },
    { key: "w", ctrlKey: true, shiftKey: true },
    { key: "Tab", ctrlKey: true },
    { key: "Tab", ctrlKey: true, shiftKey: true },
    { key: "1", ctrlKey: true },
    { key: "r", ctrlKey: true },
    { key: "r", ctrlKey: true, shiftKey: true },
    { key: "r", ctrlKey: true, altKey: true },
    { key: "r", ctrlKey: true, shiftKey: true, altKey: true },
  ];

  for (const event of events) {
    const action = desktopShortcutAction(event);
    assert.ok(action, `expected a registered action for ${event.key}`);
    assert.ok(documentedActions.has(action.type), `${action.type} must appear in the shortcut help`);
  }
});

test("desktop shortcut documentation includes writing, search, tabs and recovery", () => {
  assert.deepEqual(
    desktopShortcutGroups.map((group) => group.id),
    ["writing", "navigation", "tabs", "tabs-legacy", "recovery"],
  );
  const shortcuts = desktopShortcutGroups.flatMap((group) => group.shortcuts);
  assert.ok(shortcuts.some((shortcut) => shortcut.keys.join("+") === "Enter"));
  assert.equal(
    shortcuts.find((shortcut) => shortcut.keys.join("+") === "Mod+Shift+W")?.label,
    "Close all tabs (browser may close the window)",
  );
  assert.ok(shortcuts.some((shortcut) => shortcut.keys.join("+") === "Shift+Enter"));
  assert.ok(shortcuts.some((shortcut) => shortcut.keys.join("+") === "Mod+K"));
  assert.ok(shortcuts.some((shortcut) => shortcut.action === "recover-runtime"));
});

test("InputBar renders an accessible shortcut help popover from the shared catalog", async () => {
  const source = await readFile(inputBarPath, "utf8");

  assert.match(source, /import \{ desktopShortcutGroups \} from "\.\/lib\/desktop_shortcuts\.js"/);
  assert.match(source, /aria-label="Keyboard shortcuts"/);
  assert.match(source, /aria-expanded=\{shortcutsOpen\}/);
  assert.match(source, /aria-controls="desktop-shortcuts"/);
  assert.match(source, /id="desktop-shortcuts"[\s\S]*role="dialog"[\s\S]*aria-labelledby="desktop-shortcuts-title"/);
  assert.match(source, /\{#each desktopShortcutGroups as group/);
  assert.match(source, /\{#each shortcut\.keys as key/);
});

test("shortcut help closes on Escape and outside click and remains desktop-only", async () => {
  const source = await readFile(inputBarPath, "utf8");

  assert.match(source, /if \(shortcutsOpen && shortcutsRoot && !shortcutsRoot\.contains\(e\.target\)\)[\s\S]*shortcutsOpen = false/);
  assert.match(source, /function handleKeydownGlobal\(e\)[\s\S]*e\.key === "Escape"[\s\S]*shortcutsOpen = false/);
  assert.match(source, /@media \(max-width: 820px\) \{[\s\S]*\.ib-caption \{\s*display: none;/);
});
