import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const source = readFileSync(new URL('../views/Index.svelte', import.meta.url), 'utf8');

describe('Desktop composition handoff', () => {
  test('creates a new session for a Desktop composition and opens selected recent sessions', () => {
    expect(source).toContain('export let handoff');
    expect(source).toContain('export let desktopSession');
    expect(source).toContain('openDesktopComposition');
    expect(source).toContain('function consumeDesktopHandoff()');
    expect(source).toContain('url.searchParams.delete("handoff")');
    expect(source).toContain('history.replaceState');
    expect(source).toContain('source !== "thinkiac-desktop"');
    expect(source).toContain('type === "shell:new-message"');
    expect(source).toContain('type === "shell:open-session"');
    expect(source).toContain('type === "shell:stop"');
    expect(source).toContain('handleStop(data.detail?.sessionId)');
    expect(source).toContain('type: "open:shell-window"');
  });
});
