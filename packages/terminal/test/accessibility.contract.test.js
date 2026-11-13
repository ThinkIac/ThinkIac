import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const view = readFileSync(path.join(packageRoot, 'views/Index.svelte'), 'utf8');
const routes = readFileSync(path.join(packageRoot, 'routes.js'), 'utf8');

describe('contrato acessível do Terminal', () => {
  test('expõe a entrada xterm com nome acessível associado à aba', () => {
    expect(view).toContain("textarea.setAttribute('aria-label', `${tabName(tabId)} input`)");
    expect(view).toContain('aria-label="Terminal command"');
    expect(view).toContain('on:submit|preventDefault={submitMobileCommand}');
  });

  test('distingue conexão WebSocket de sessão PTY pronta', () => {
    expect(view).toContain("sessionStates[activeTabId] !== 'ready'");
    expect(view).toContain("'Starting session…'");
  });

  test('mantém reconexão durante indisponibilidade transitória, sem ocultar falhas de sessão', () => {
    expect(view).toContain('if (res.status >= 500 && res.status < 600) return true;');
    expect(view).toContain('if (res.redirected || !res.ok)');
    expect(view).toContain("stopTerminal('Terminal service is unavailable. Sign in again or retry.')");
    expect(view).toContain('if (!await loadCapabilities()) return;');
  });

  test('espelha o buffer renderizado em uma região de saída acessível', () => {
    expect(view).toContain('role="log"');
    expect(view).toContain('aria-label={`${activeTab?.name || \'Terminal\'} output`}');
    expect(view).toContain('inst.term.buffer.active');
  });

  test('só marca a sessão pronta após o acknowledgement do PTY', () => {
    expect(routes).toContain("type: 'terminal:pty:authenticated'");
    expect(view).toContain("msg.type === 'terminal:pty:authenticated'");
    expect(routes).toContain("type: 'terminal:pty:started'");
    expect(view).toContain("msg.type === 'terminal:pty:started'");
    expect(view).toContain("setSessionState(msg.ptyId, 'ready')");
  });

  test('mantém a view segura para SSR, sem globais no módulo', () => {
    expect(view).toContain("import { onMount, onDestroy, tick } from 'svelte'");
    expect(view).toContain("if (typeof window === 'undefined') return");
  });

  test('não exige randomUUID de WebViews Android antigos', () => {
    expect(view).toContain("typeof webCrypto?.randomUUID === 'function'");
    expect(view).toContain("typeof webCrypto?.getRandomValues === 'function'");
    expect(view).not.toContain('sessionId = crypto.randomUUID()');
  });

  test('monta o xterm mesmo sem ResizeObserver e permite a área flexível encolher no mobile', () => {
    expect(view).toContain("typeof ResizeObserver === 'function'");
    expect(view).toContain("else window.addEventListener('resize', resize)");
    expect(view).toContain('.terminal-body { flex-grow: 1; min-height: 0;');
    expect(view).toContain('href="/vendor/xterm/xterm.css"');
  });

  test('mantém o xterm interativo visível no mobile', () => {
    expect(view).toContain('function appendMobileOutput(tabId, data)');
    expect(view).toContain('appendMobileOutput(msg.ptyId, msg.data)');
    expect(view).toContain('class="mobile-terminal-console"');
    expect(view).toContain('class="mobile-terminal-command"');
    expect(view).not.toContain('.terminal-body :global(.xterm-pane) { visibility: hidden !important; }');
    expect(view).not.toMatch(/\.mobile-terminal-console\s*\{[^}]*display:\s*flex/s);
  });

  test('usa os assets empacotados e espera um layout válido antes do primeiro fit', () => {
    expect(view).toContain('await loadLocalXterm()');
    expect(view).not.toContain('cdn.jsdelivr.net/npm/@xterm');
    expect(view).toContain('container.clientWidth > 0 && container.clientHeight > 0');
    expect(view).toContain("window.visualViewport?.addEventListener('resize', onViewportResize)");
  });
});
