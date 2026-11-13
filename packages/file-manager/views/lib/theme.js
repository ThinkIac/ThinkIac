// Theme sync helper for views outside Aurora's .shell (same situation as
// packages/terminal/views/Index.svelte — see apps/thinkiac/AGENTS.md).
// Source of truth stays localStorage['agent:theme'], written by
// packages/agent/views/theme.js's setTheme(); this module only reads it and
// notifies listeners, since every preview page opens in its own iframe
// (its own window/document) and needs its own live-sync subscription.

const KEY = 'agent:theme';

function applyDocumentTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.body?.setAttribute('data-theme', theme);
}

export function getTheme() {
  if (typeof window === 'undefined') return 'dark';
  try {
    const saved = window.localStorage.getItem(KEY);
    const theme = saved === 'light' || saved === 'dark' ? saved : 'dark';
    applyDocumentTheme(theme);
    return theme;
  } catch {
    return 'dark';
  }
}

export function onThemeChange(callback) {
  if (typeof window === 'undefined') return () => {};
  function handler(event) {
    if (event.key !== KEY) return;
    const theme = event.newValue === 'light' ? 'light' : 'dark';
    applyDocumentTheme(theme);
    callback(theme);
  }
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}
