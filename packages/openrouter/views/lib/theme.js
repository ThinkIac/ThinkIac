// Theme sync helper for views outside Agent's .shell (same situation as
// packages/maritaca/views/lib/theme.js — see apps/thinkiac/AGENTS.md).
// Source of truth stays localStorage['agent:theme'], written by
// packages/agent/views/theme.js's setTheme(); this module only reads it and
// notifies listeners, since this view opens in its own iframe (its own
// window/document) and needs its own live-sync subscription.

const KEY = 'agent:theme';

export function getTheme() {
  if (typeof window === 'undefined') return 'dark';
  try {
    const saved = window.localStorage.getItem(KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'dark';
  } catch {
    return 'dark';
  }
}

export function onThemeChange(callback) {
  if (typeof window === 'undefined') return () => {};
  function handler(event) {
    if (event.key === KEY) callback(event.newValue === 'light' ? 'light' : 'dark');
  }
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}
