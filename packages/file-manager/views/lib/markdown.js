import { marked } from 'marked';

function escapeAttribute(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}

function safeUrl(value, { image = false } = {}) {
  const url = String(value || '').trim();
  if (!url || url.startsWith('#') || url.startsWith('/') || url.startsWith('./') || url.startsWith('../')) return url;
  const protocol = url.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (!protocol) return url;
  const allowed = image ? new Set(['http', 'https']) : new Set(['http', 'https', 'mailto']);
  return allowed.has(protocol) ? url : '';
}

const renderer = new marked.Renderer();
// Previews render files from the workspace, never executable HTML.
renderer.html = () => '';
renderer.link = (href, title, text) => {
  const url = safeUrl(href);
  if (!url) return text;
  return `<a href="${escapeAttribute(url)}"${title ? ` title="${escapeAttribute(title)}"` : ''}>${text}</a>`;
};
renderer.image = (href, title, text) => {
  const url = safeUrl(href, { image: true });
  if (!url) return '';
  const alt = String(text || '').replace(/<[^>]*>/g, '');
  return `<img src="${escapeAttribute(url)}" alt="${escapeAttribute(alt)}"${title ? ` title="${escapeAttribute(title)}"` : ''}>`;
};

export function renderMarkdown(source) {
  return marked.parse(String(source || ''), { gfm: true, breaks: true, renderer });
}
