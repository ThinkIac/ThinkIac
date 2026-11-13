// Extension helpers with no CodeMirror dependency, so the views can import them
// at module scope without dragging the editor bundle into the server render.

export const KNOWN_LANGS = new Set([
    'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'svelte', 'html', 'htm', 'json',
    'css', 'scss', 'md', 'markdown', 'py', 'sql', 'yaml', 'yml', 'sh', 'bash',
    'toml', 'ini',
]);

/**
 * Extension of a *file name*, not of a path: "views/Index" has no extension,
 * and splitting the whole path on '.' would return a path segment for it.
 */
export function extOf(filePath) {
    if (!filePath) return '';
    const name = String(filePath).split('/').pop();
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** Label for the status bar; 'text' when no grammar is wired up. */
export function langLabel(filePath) {
    const ext = extOf(filePath);
    return KNOWN_LANGS.has(ext) ? ext : 'text';
}
