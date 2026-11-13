// Shared fetch helpers for file-manager's Svelte views (Index + every preview
// component, each of which is served standalone and can't share JS state).

export function rawUrl(path) {
  return `/file-manager/raw?path=${encodeURIComponent(path)}`;
}

export function fetchRaw(path) {
  return fetch(rawUrl(path));
}

async function getJson(url) {
  const res = await fetch(url);
  return res.json();
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

export function list(path) {
  return getJson(`/file-manager/list?path=${encodeURIComponent(path)}`);
}

export function resolveViewer(path) {
  return postJson('/file-manager/viewers/resolve', { path });
}

export function resolveOpeners(path) {
  return postJson('/file-manager/openers/resolve', { path });
}

export function listViewers() {
  return getJson('/file-manager/viewers/list');
}

export function clipboardStatus() {
  return getJson('/file-manager/clipboard');
}

export function create(path, type, content) {
  return postJson('/file-manager/create', { path, type, content });
}

export function rename(path, newName) {
  return postJson('/file-manager/rename', { path, newName });
}

export function del(path) {
  return postJson('/file-manager/delete', { path });
}

export function restore(path) {
  return postJson('/file-manager/restore', { path });
}

export function permanentDelete(path) {
  return postJson('/file-manager/permanent-delete', { path, confirm: true });
}

export function copy(pathOrPaths) {
  return postJson('/file-manager/copy', Array.isArray(pathOrPaths) ? { paths: pathOrPaths } : { path: pathOrPaths });
}

export function cut(pathOrPaths) {
  return postJson('/file-manager/cut', Array.isArray(pathOrPaths) ? { paths: pathOrPaths } : { path: pathOrPaths });
}

export function paste(dest) {
  return postJson('/file-manager/paste', { dest });
}

export function move(path, dest) {
  return postJson('/file-manager/move', { path, dest });
}

export function extract(path) {
  return postJson('/file-manager/extract', { path });
}

// entries: [{ file: File, relPath: string }] — relPath preserves folder
// structure for dropped/selected directories; a plain multi-file selection
// just uses each file's own name.
export function uploadEntries(dest, entries) {
  const formData = new FormData();
  formData.append('dest', dest);
  const paths = [];
  for (const { file, relPath } of entries) {
    formData.append('files', file, file.name);
    paths.push(relPath);
  }
  formData.append('paths', JSON.stringify(paths));
  return fetch('/file-manager/upload', { method: 'POST', body: formData }).then((res) => res.json());
}
