import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, renameSync, unlinkSync, rmSync, copyFileSync, createReadStream, createWriteStream } from 'fs';
import { resolve, join, dirname, extname, basename, sep } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';
import mimeTypes from 'mime-types';
import AdmZip from 'adm-zip';
import * as tar from 'tar';
import { readSpreadsheet } from './lib/spreadsheet.js';

const PROJECT_ROOT = process.cwd();
const VIEWERS_PATH = join(fileURLToPath(new URL('.', import.meta.url)), 'viewers.json');

let clipboard = null;

// ── Native preview view registry ────────────────────────────────────────
// Maps a lowercased extension (with leading dot) to { pkg, component }.
// Seeded with file-manager's own built-in previews at module load (i.e.
// before the app's single `boot` event fires), so any later registration
// via the `file:register:view` hook naturally overrides a built-in for the
// same extension — no separate priority system needed.
const VIEW_REGISTRY = new Map();

const BUILTIN_VIEWS = {
  text: [
    '.txt', '.md', '.markdown', '.json', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
    '.css', '.scss', '.html', '.htm', '.yml', '.yaml', '.sh', '.bash', '.py', '.rb',
    '.go', '.rs', '.java', '.c', '.cpp', '.h', '.svelte', '.vue', '.log', '.env',
    '.xml', '.toml', '.ini', '.csv', '.sql', '.gitignore',
  ],
  // Formats decoded directly by the browser's <img> element. Keep this list in
  // sync with the explorer category list so every native image preview also
  // receives an image thumbnail in the file grid.
  image: ['.png', '.jpg', '.jpeg', '.jpe', '.jfif', '.gif', '.apng', '.webp', '.svg', '.bmp', '.ico', '.avif'],
  video: ['.mp4', '.webm', '.mov', '.mkv', '.ogv'],
  audio: ['.mp3', '.wav', '.ogg', '.m4a', '.flac'],
  glb: ['.glb'],
  pdf: ['.pdf'],
  spreadsheet: ['.csv', '.tsv', '.xlsx', '.xlsm', '.ods'],
};
const CATEGORY_COMPONENT = {
  text: 'TextView',
  image: 'ImageView',
  video: 'VideoView',
  audio: 'AudioView',
  glb: 'GlbView',
  pdf: 'PdfView',
  spreadsheet: 'SpreadsheetView',
};

for (const [category, exts] of Object.entries(BUILTIN_VIEWS)) {
  for (const ext of exts) VIEW_REGISTRY.set(ext, { pkg: 'file-manager', component: CATEGORY_COMPONENT[category] });
}

function normalizeExt(ext) {
  return ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
}

export function onRegisterView(payload) {
  /**
   * @register_hook file:register:view
   * @description Register a native preview component for one or more file extensions.
   * `component` must be a bare filename (no path, no .svelte extension) of a file under
   * `<pkg>/views/` — the framework only routes a single path segment at
   * `/view/<pkg>/:page`, so nested component paths cannot be resolved. The last
   * registration for a given extension wins, which also lets this override
   * file-manager's own built-in defaults.
   * @param {object} payload
   * @param {string?} payload.ext - Single extension, leading dot optional (e.g. '.png' or 'png')
   * @param {string[]?} payload.exts - Multiple extensions at once
   * @param {string?} payload.pkg - Package folder owning the view; defaults to 'file-manager'
   * @param {string} payload.component - Bare filename under <pkg>/views/
   */
  if (!payload?.component) return;
  const pkg = payload.pkg || 'file-manager';
  const exts = payload.exts?.length ? payload.exts : (payload.ext ? [payload.ext] : []);
  for (const ext of exts) {
    VIEW_REGISTRY.set(normalizeExt(ext), { pkg, component: payload.component });
  }
}

// ── App "opener" registry ───────────────────────────────────────────────
// Maps a lowercased extension (with leading dot) to a LIST of openers. An
// opener lets a full Aurora App tab (not just the inline preview modal) claim a
// file type: right-clicking the file offers "Open with <App>", which opens the
// App as a tab with the file path mapped onto one of its `export let` props via
// a query param (the views layer feeds query params to view pages as props).
// Mirrors VIEW_REGISTRY / file:register:view, but is a list (several Apps may
// open the same extension) and targets tabs instead of the preview modal.
const OPENER_REGISTRY = new Map();

export function onRegisterOpener(payload) {
  /**
   * @register_hook file:register:opener
   * @description Register an Aurora App as an "opener" for one or more file
   * extensions. The App appears under the File Manager's "Open with…" context
   * menu and opens as a real tab with the file path passed as a query param
   * (which the views layer feeds to the page's matching `export let`).
   * @param {object} payload
   * @param {string?} payload.ext - Single extension, leading dot optional (e.g. '.md' or 'md')
   * @param {string[]?} payload.exts - Multiple extensions at once
   * @param {string} payload.pkg - Package folder owning the view (e.g. 'code-editor')
   * @param {string} payload.view - Bare view filename under <pkg>/views/ (e.g. 'Embed')
   * @param {string?} payload.param - Query param that receives the path; defaults to 'path'
   * @param {string?} payload.label - Menu label; defaults to a title-cased pkg name
   * @param {string?} payload.icon - Optional emoji/dataURL shown next to the label
   */
  if (!payload?.pkg || !payload?.view) return;
  const exts = payload.exts?.length ? payload.exts : (payload.ext ? [payload.ext] : []);
  if (!exts.length) return;
  const label = payload.label || payload.pkg.split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  const opener = {
    pkg: payload.pkg,
    view: payload.view,
    param: payload.param || 'path',
    label,
    icon: payload.icon || null,
  };
  for (const ext of exts) {
    const key = normalizeExt(ext);
    const list = OPENER_REGISTRY.get(key) || [];
    // Upsert by pkg+view so a re-run of the boot hook doesn't duplicate.
    const i = list.findIndex(o => o.pkg === opener.pkg && o.view === opener.view);
    if (i >= 0) list[i] = opener; else list.push(opener);
    OPENER_REGISTRY.set(key, list);
  }
}

function safeResolve(userPath) {
  const full = resolve(PROJECT_ROOT, userPath);
  if (full !== PROJECT_ROOT && !full.startsWith(`${PROJECT_ROOT}${sep}`)) {
    throw new Error('Path is outside workspace');
  }
  return full;
}

function loadViewers() {
  try {
    const raw = readFileSync(VIEWERS_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveViewers(viewers) {
  writeFileSync(VIEWERS_PATH, JSON.stringify(viewers, null, 2), 'utf-8');
}

function copyFolderRecursive(src, dest) {
  mkdirSync(dest, { recursive: true });
  const entries = readdirSync(src);
  for (const name of entries) {
    const s = join(src, name);
    const d = join(dest, name);
    const st = statSync(s);
    if (st.isDirectory()) {
      copyFolderRecursive(s, d);
    } else {
      copyFileSync(s, d);
    }
  }
}

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// LIST
export function list(input) {
  /**
   * @register_tool filemanage_list
   * @description List files and directories at a given path
   * @param {object} input
   * @param {string} input.path - Path relative to workspace root
   */
  const dir = safeResolve(input?.path || '.');
  if (!existsSync(dir)) return { success: false, error: 'Path does not exist' };
  const st = statSync(dir);
  if (!st.isDirectory()) return { success: false, error: 'Path is not a directory' };

  const entries = readdirSync(dir).map(name => {
    const full = join(dir, name);
    const s = statSync(full);
    return {
      name,
      type: s.isDirectory() ? 'directory' : 'file',
      size: s.size,
      sizeFormatted: formatSize(s.size),
      modified: s.mtime.toISOString(),
      ext: s.isDirectory() ? null : extname(name).toLowerCase(),
    };
  });

  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const relPath = input?.path || '.';
  return {
    success: true,
    path: relPath,
    absolutePath: dir,
    entries,
    parent: relPath === '.' ? null : dirname(relPath) === '.' ? '.' : dirname(relPath),
    segments: relPath === '.' ? [] : relPath.split(sep).filter(Boolean),
  };
}

export function routerList(req, res) {
  /**
   * @register_router list
   * @method GET
   */
  const path = req.query?.path || '.';
  return list({ path });
}

// CREATE
export function create(input) {
  /**
   * @register_tool filemanage_create
   * @description Create a file or directory
   * @param {object} input
   * @param {string} input.path - Path relative to workspace root
   * @param {string} input.type - 'file' or 'directory'
   * @param {string} input.content - Content for files
   */
  if (!input?.path) return { success: false, error: 'path is required' };
  const full = safeResolve(input.path);
  if (existsSync(full)) return { success: false, error: 'Path already exists' };
  mkdirSync(dirname(full), { recursive: true });
  if (input.type === 'directory') {
    mkdirSync(full);
    return { success: true, type: 'directory', path: input.path };
  } else {
    writeFileSync(full, input.content || '', 'utf-8');
    return { success: true, type: 'file', path: input.path, bytes: (input.content || '').length };
  }
}

export function routerCreate(req, res) {
  /**
   * @register_router create
   * @method POST
   */
  const { path, type, content } = req.body || {};
  return create({ path, type, content });
}

// RENAME
export function rename(input) {
  /**
   * @register_tool filemanage_rename
   * @description Rename a file or directory
   * @param {object} input
   * @param {string} input.path - Current path relative to workspace root
   * @param {string} input.newName - New name (basename only)
   */
  if (!input?.path || !input?.newName) return { success: false, error: 'path and newName are required' };
  const full = safeResolve(input.path);
  if (!existsSync(full)) return { success: false, error: 'Path does not exist' };
  const parent = dirname(full);
  const dest = join(parent, input.newName);
  if (existsSync(dest)) return { success: false, error: 'Destination already exists' };
  renameSync(full, dest);
  return { success: true, from: input.path, to: join(dirname(input.path), input.newName) };
}

export function routerRename(req, res) {
  /**
   * @register_router rename
   * @method POST
   */
  const { path, newName } = req.body || {};
  return rename({ path, newName });
}

// DELETE (soft — renames with a .deleted suffix; never shown in normal listings)
const DELETED_SUFFIX_RE = /\.deleted\d*$/;

function isDeletedName(name) {
  return DELETED_SUFFIX_RE.test(name);
}

function originalNameFor(deletedName) {
  return deletedName.replace(DELETED_SUFFIX_RE, '');
}

function uniqueDeletedName(dir, name) {
  let candidate = `${name}.deleted`;
  let n = 2;
  while (existsSync(join(dir, candidate))) {
    candidate = `${name}.deleted${n}`;
    n += 1;
  }
  return candidate;
}

export function del(input) {
  /**
   * @register_tool filemanage_delete
   * @description Soft-delete a file or directory: renames it with a `.deleted` suffix so it
   * disappears from normal listings but stays recoverable. Use filemanage_restore to bring it
   * back, or filemanage_permanentDelete (irreversible) to remove it for good.
   * @param {object} input
   * @param {string} input.path - Path relative to workspace root
   */
  if (!input?.path) return { success: false, error: 'path is required' };
  const full = safeResolve(input.path);
  if (!existsSync(full)) return { success: false, error: 'Path does not exist' };
  const dir = dirname(full);
  const deletedName = uniqueDeletedName(dir, basename(full));
  renameSync(full, join(dir, deletedName));
  return { success: true, path: input.path, deletedPath: join(dirname(input.path), deletedName) };
}

export function routerDelete(req, res) {
  /**
   * @register_router delete
   * @method POST
   */
  const { path } = req.body || {};
  return del({ path });
}

// RESTORE
export function restore(input) {
  /**
   * @register_tool filemanage_restore
   * @description Restore a soft-deleted file or directory to its original name
   * @param {object} input
   * @param {string} input.path - Path of the soft-deleted item (including its .deleted suffix), relative to workspace root
   */
  if (!input?.path) return { success: false, error: 'path is required' };
  const full = safeResolve(input.path);
  if (!existsSync(full)) return { success: false, error: 'Path does not exist' };
  const name = basename(full);
  if (!isDeletedName(name)) return { success: false, error: 'Path is not a deleted item' };
  const dir = dirname(full);
  const restoredName = originalNameFor(name);
  const restoredFull = join(dir, restoredName);
  if (existsSync(restoredFull)) return { success: false, error: 'A file with the original name already exists' };
  renameSync(full, restoredFull);
  return { success: true, path: input.path, restoredPath: join(dirname(input.path), restoredName) };
}

export function routerRestore(req, res) {
  /**
   * @register_router restore
   * @method POST
   */
  const { path } = req.body || {};
  return restore({ path });
}

// PERMANENT DELETE (irreversible — only allowed on already soft-deleted items)
export function permanentDelete(input) {
  /**
   * @register_tool filemanage_permanentDelete
   * @description Permanently delete a soft-deleted file or directory. Irreversible; requires
   * confirm: true. Refuses to act on an item that hasn't been soft-deleted first.
   * @param {object} input
   * @param {string} input.path - Path of the soft-deleted item (including its .deleted suffix), relative to workspace root
   * @param {boolean} input.confirm - Must be true to proceed
   */
  if (!input?.path) return { success: false, error: 'path is required' };
  if (!input.confirm) return { success: false, error: 'Confirmation required. Set confirm: true.' };
  const full = safeResolve(input.path);
  if (!existsSync(full)) return { success: false, error: 'Path does not exist' };
  if (!isDeletedName(basename(full))) {
    return { success: false, error: 'Refusing to permanently delete a non-deleted item; use filemanage_delete first.' };
  }
  const s = statSync(full);
  if (s.isDirectory()) {
    rmSync(full, { recursive: true, force: true });
  } else {
    unlinkSync(full);
  }
  return { success: true, path: input.path };
}

export function routerPermanentDelete(req, res) {
  /**
   * @register_router permanent-delete
   * @method POST
   */
  const { path, confirm } = req.body || {};
  return permanentDelete({ path, confirm });
}

// COPY
export function copy(input) {
  /**
   * @register_tool filemanage_copy
   * @description Copy one or more files/directories to the clipboard
   * @param {object} input
   * @param {string} input.path - Path relative to workspace root (single item)
   * @param {string[]} input.paths - Multiple paths relative to workspace root
   */
  const paths = input?.paths?.length ? input.paths : (input?.path ? [input.path] : []);
  if (!paths.length) return { success: false, error: 'path or paths is required' };
  const items = [];
  for (const p of paths) {
    const full = safeResolve(p);
    if (!existsSync(full)) return { success: false, error: `Path does not exist: ${p}` };
    items.push({ path: full, relativePath: p });
  }
  clipboard = { type: 'copy', items };
  return { success: true, action: 'copy', paths };
}

export function routerCopy(req, res) {
  /**
   * @register_router copy
   * @method POST
   */
  const { path, paths } = req.body || {};
  return copy({ path, paths });
}

// CUT
export function cut(input) {
  /**
   * @register_tool filemanage_cut
   * @description Cut one or more files/directories to the clipboard
   * @param {object} input
   * @param {string} input.path - Path relative to workspace root (single item)
   * @param {string[]} input.paths - Multiple paths relative to workspace root
   */
  const paths = input?.paths?.length ? input.paths : (input?.path ? [input.path] : []);
  if (!paths.length) return { success: false, error: 'path or paths is required' };
  const items = [];
  for (const p of paths) {
    const full = safeResolve(p);
    if (!existsSync(full)) return { success: false, error: `Path does not exist: ${p}` };
    items.push({ path: full, relativePath: p });
  }
  clipboard = { type: 'cut', items };
  return { success: true, action: 'cut', paths };
}

export function routerCut(req, res) {
  /**
   * @register_router cut
   * @method POST
   */
  const { path, paths } = req.body || {};
  return cut({ path, paths });
}

// PASTE
export function paste(input) {
  /**
   * @register_tool filemanage_paste
   * @description Paste clipboard content (one or more items) into a destination directory
   * @param {object} input
   * @param {string} input.dest - Destination directory path relative to workspace root
   */
  if (!clipboard) return { success: false, error: 'Clipboard is empty' };
  if (!input?.dest) return { success: false, error: 'dest is required' };
  const destDir = safeResolve(input.dest);
  if (!existsSync(destDir)) return { success: false, error: 'Destination does not exist' };

  const action = clipboard.type;
  const to = [];
  const errors = [];
  for (const item of clipboard.items) {
    const baseName = basename(item.path);
    const dest = join(destDir, baseName);
    const sourceIsDirectory = statSync(item.path).isDirectory();
    if (sourceIsDirectory && (destDir === item.path || destDir.startsWith(`${item.path}${sep}`))) {
      errors.push({ path: item.relativePath, error: 'Cannot paste a folder into itself' });
      continue;
    }
    if (existsSync(dest)) {
      errors.push({ path: item.relativePath, error: 'Destination already exists' });
      continue;
    }
    try {
      if (action === 'copy') {
        const s = statSync(item.path);
        if (s.isDirectory()) copyFolderRecursive(item.path, dest);
        else copyFileSync(item.path, dest);
      } else {
        renameSync(item.path, dest);
      }
      to.push(join(input.dest, baseName));
    } catch (e) {
      errors.push({ path: item.relativePath, error: e.message });
    }
  }
  if (action === 'cut') clipboard = null;
  return {
    success: errors.length === 0,
    action,
    to,
    errors,
    clipboardCleared: action === 'cut',
  };
}

export function routerPaste(req, res) {
  /**
   * @register_router paste
   * @method POST
   */
  const { dest } = req.body || {};
  return paste({ dest });
}

// MOVE
export function move(input) {
  /**
   * @register_tool filemanage_move
   * @description Move a file or directory to a destination
   * @param {object} input
   * @param {string} input.path - Path relative to workspace root
   * @param {string} input.dest - Destination path relative to workspace root
   */
  if (!input?.path || !input?.dest) return { success: false, error: 'path and dest are required' };
  const srcFull = safeResolve(input.path);
  if (!existsSync(srcFull)) return { success: false, error: 'Source does not exist' };
  const destFull = safeResolve(input.dest);
  mkdirSync(dirname(destFull), { recursive: true });
  if (existsSync(destFull)) return { success: false, error: 'Destination already exists' };
  renameSync(srcFull, destFull);
  return { success: true, from: input.path, to: input.dest };
}

export function routerMove(req, res) {
  /**
   * @register_router move
   * @method POST
   */
  const { path, dest } = req.body || {};
  return move({ path, dest });
}

// REGISTER VIEWER
export function registerViewer(input) {
  /**
   * @register_tool filemanage_registerViewer
   * @description Register a new viewer for file extensions
   * @param {object} input
   * @param {string} input.name - Viewer name
   * @param {string[]} input.extensions - Array of extensions (e.g. ['.png', '.jpg'])
   * @param {string} input.iframeUrl - URL for the iframe (receives ?path= query param)
   */
  if (!input?.name || !input?.extensions?.length || !input?.iframeUrl) {
    return { success: false, error: 'name, extensions (array), and iframeUrl are required' };
  }
  const viewers = loadViewers();
  const entry = {
    name: input.name,
    extensions: input.extensions.map(e => e.startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`),
    iframeUrl: input.iframeUrl,
  };
  const idx = viewers.findIndex(v => v.name === input.name);
  if (idx >= 0) viewers[idx] = entry;
  else viewers.push(entry);
  saveViewers(viewers);
  return { success: true, viewer: entry };
}

export function routerRegisterViewer(req, res) {
  /**
   * @register_router viewers/register
   * @method POST
   */
  const { name, extensions, iframeUrl } = req.body || {};
  return registerViewer({ name, extensions, iframeUrl });
}

// LIST VIEWERS
export function listViewers() {
  /**
   * @register_tool filemanage_listViewers
   * @description List all registered viewers
   */
  return { success: true, viewers: loadViewers() };
}

export function routerListViewers(req, res) {
  /**
   * @register_router viewers/list
   * @method GET
   */
  return listViewers();
}

// REMOVE VIEWER
export function removeViewer(input) {
  /**
   * @register_tool filemanage_removeViewer
   * @description Remove a registered viewer by name
   * @param {object} input
   * @param {string} input.name - Viewer name to remove
   */
  if (!input?.name) return { success: false, error: 'name is required' };
  const viewers = loadViewers();
  const filtered = viewers.filter(v => v.name !== input.name);
  if (filtered.length === viewers.length) return { success: false, error: 'Viewer not found' };
  saveViewers(filtered);
  return { success: true, name: input.name };
}

export function routerRemoveViewer(req, res) {
  /**
   * @register_router viewers/remove
   * @method POST
   */
  const { name } = req.body || {};
  return removeViewer({ name });
}

// RESOLVE VIEWER
export function resolveViewer(input) {
  /**
   * @register_tool filemanage_resolveViewer
   * @description Find a viewer for a given file path by extension. Checks the native
   * component registry (built-ins + `file:register:view` hook registrations) first,
   * falling back to legacy externally-registered iframe viewers.
   * @param {object} input
   * @param {string} input.path - File path relative to workspace root
   */
  if (!input?.path) return { success: false, error: 'path is required' };
  const ext = extname(input.path).toLowerCase();
  if (!ext) return { success: false, error: 'File has no extension' };

  const native = VIEW_REGISTRY.get(ext);
  if (native) {
    return {
      success: true,
      kind: 'component',
      pkg: native.pkg,
      component: native.component,
      url: `/view/${native.pkg}/${native.component}?path=${encodeURIComponent(input.path)}`,
    };
  }

  const viewers = loadViewers();
  const viewer = viewers.find(v => v.extensions.includes(ext));
  if (!viewer) return { success: false, error: 'No viewer found for this extension', ext };
  return { success: true, kind: 'iframe', viewer, ext };
}

export function routerResolveViewer(req, res) {
  /**
   * @register_router viewers/resolve
   * @method POST
   */
  const { path } = req.body || {};
  return resolveViewer({ path });
}

// RESOLVE OPENERS
export function resolveOpeners(input) {
  /**
   * @register_tool filemanage_resolveOpeners
   * @description List the Apps registered (via `file:register:opener`) that can
   * open a given file as a full Aurora tab. Each opener comes with a ready-to-open
   * URL carrying the path on its query param.
   * @param {object} input
   * @param {string} input.path - File path relative to workspace root
   */
  if (!input?.path) return { success: false, error: 'path is required', openers: [] };
  const ext = extname(input.path).toLowerCase();
  if (!ext) return { success: true, openers: [] };
  const list = OPENER_REGISTRY.get(ext) || [];
  const openers = list.map(o => ({
    pkg: o.pkg,
    view: o.view,
    label: o.label,
    icon: o.icon,
    url: `/view/${o.pkg}/${o.view}?${o.param}=${encodeURIComponent(input.path)}`,
  }));
  return { success: true, openers, ext };
}

export function routerResolveOpeners(req, res) {
  /**
   * @register_router openers/resolve
   * @method POST
   */
  const { path } = req.body || {};
  return resolveOpeners({ path });
}

// CLIPBOARD STATUS
export function clipboardStatus() {
  /**
   * @register_tool filemanage_clipboardStatus
   * @description Get current clipboard state
   */
  if (!clipboard) return { success: true, empty: true };
  return {
    success: true,
    empty: false,
    type: clipboard.type,
    count: clipboard.items.length,
    path: clipboard.items[0]?.relativePath,
    paths: clipboard.items.map(i => i.relativePath),
  };
}

export function routerClipboardStatus(req, res) {
  /**
   * @register_router clipboard
   * @method GET
   */
  return clipboardStatus();
}

// UPLOAD (multipart — accepts one or many files; `paths[i]` supplies the
// relative path for file i so a dropped/selected folder tree can be
// reconstructed, not just a flat batch of files)
export function upload(req) {
  /**
   * @register_router upload
   * @method POST
   * @upload files 500 1gb memory
   */
  const files = req.files || [];
  if (!files.length) return { status: 400, data: { success: false, error: 'No files received' } };

  const dest = req.body?.dest || '.';
  let relPaths = [];
  try {
    relPaths = JSON.parse(req.body?.paths || '[]');
  } catch {
    relPaths = [];
  }

  let destDir;
  try {
    destDir = safeResolve(dest);
  } catch (e) {
    return { status: 403, data: { success: false, error: e.message } };
  }
  if (!existsSync(destDir)) return { status: 400, data: { success: false, error: 'Destination does not exist' } };

  const written = [];
  const errors = [];
  files.forEach((file, i) => {
    const relPath = (relPaths[i] || file.originalname).replace(/^[/\\]+/, '');
    try {
      const targetRel = dest === '.' ? relPath : `${dest}/${relPath}`;
      const full = safeResolve(targetRel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, file.buffer);
      written.push(targetRel);
    } catch (e) {
      errors.push({ path: relPath, error: e.message });
    }
  });

  return { success: errors.length === 0, written, errors };
}

// EXTRACT (.zip, .rar, .tar, .gz, .tar.gz — extracts into a new sibling folder)
function archiveKind(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'targz';
  if (lower.endsWith('.tar')) return 'tar';
  if (lower.endsWith('.zip')) return 'zip';
  if (lower.endsWith('.rar')) return 'rar';
  if (lower.endsWith('.gz')) return 'gz';
  return null;
}

function baseArchiveName(name) {
  return name.replace(/\.tar\.gz$/i, '').replace(/\.tgz$/i, '').replace(/\.(zip|rar|tar|gz)$/i, '');
}

function commandExists(cmd) {
  try {
    execFileSync('which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function findUnrarBinary() {
  if (commandExists('unrar')) return { name: 'unrar', bin: 'unrar' };
  if (commandExists('7z')) return { name: '7z', bin: '7z' };
  return null;
}

export async function extract(input) {
  /**
   * @register_tool filemanage_extract
   * @description Extract a .zip, .rar, .tar, .gz or .tar.gz archive into a new sibling folder
   * @param {object} input
   * @param {string} input.path - Path to the archive file, relative to workspace root
   */
  if (!input?.path) return { success: false, error: 'path is required' };
  const full = safeResolve(input.path);
  if (!existsSync(full)) return { success: false, error: 'Path does not exist' };
  const kind = archiveKind(basename(full));
  if (!kind) return { success: false, error: 'Unsupported archive type' };

  const dir = dirname(full);
  const name = baseArchiveName(basename(full));
  let destName = name;
  let destDir = join(dir, destName);
  let n = 2;
  while (existsSync(destDir)) {
    destName = `${name} (${n})`;
    destDir = join(dir, destName);
    n += 1;
  }
  mkdirSync(destDir, { recursive: true });

  try {
    if (kind === 'zip') {
      const zip = new AdmZip(full);
      zip.extractAllTo(destDir, true);
    } else if (kind === 'tar' || kind === 'targz') {
      await tar.x({ file: full, cwd: destDir });
    } else if (kind === 'gz') {
      const outFile = join(destDir, name);
      await pipeline(createReadStream(full), createGunzip(), createWriteStream(outFile));
    } else if (kind === 'rar') {
      const tool = findUnrarBinary();
      if (!tool) {
        rmSync(destDir, { recursive: true, force: true });
        return { success: false, error: 'RAR extraction requires "unrar" or "7z" installed on the host system' };
      }
      const args = tool.name === 'unrar' ? ['x', '-y', full, `${destDir}/`] : ['x', full, `-o${destDir}`, '-y'];
      execFileSync(tool.bin, args, { stdio: 'ignore' });
    }
  } catch (e) {
    rmSync(destDir, { recursive: true, force: true });
    return { success: false, error: e.message };
  }

  const parentRel = dirname(input.path);
  const extractedTo = (parentRel === '.' ? destName : `${parentRel}/${destName}`);
  return { success: true, path: input.path, extractedTo };
}

export function routerExtract(req, res) {
  /**
   * @register_router extract
   * @method POST
   */
  const { path } = req.body || {};
  return extract({ path });
}

// RAW CONTENT (streaming, Range-aware — backs every native preview component)
export async function routerRawContent(req, res) {
  /**
   * @register_router raw
   * @method GET
   * @streaming
   */
  const relPath = req.query?.path;
  if (!relPath) {
    res.status(400).json({ success: false, error: 'path is required' });
    return;
  }

  let full;
  try {
    full = safeResolve(relPath);
  } catch (e) {
    res.status(403).json({ success: false, error: e.message });
    return;
  }

  if (!existsSync(full)) {
    res.status(404).json({ success: false, error: 'Not found' });
    return;
  }
  const stat = statSync(full);
  if (stat.isDirectory()) {
    res.status(400).json({ success: false, error: 'Path is a directory' });
    return;
  }

  const contentType = mimeTypes.lookup(full) || 'application/octet-stream';
  const disposition = `inline; filename="${basename(full).replace(/"/g, '')}"`;
  const range = req.headers.range;

  let rangeMatch = null;
  if (range) {
    try {
      rangeMatch = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    } catch {
      rangeMatch = null;
    }
  }

  if (rangeMatch) {
    const start = rangeMatch[1] ? parseInt(rangeMatch[1], 10) : 0;
    const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : stat.size - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= stat.size) {
      res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
      return;
    }
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': contentType,
      'Content-Disposition': disposition,
    });
    createReadStream(full, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': stat.size,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Content-Disposition': disposition,
    });
    createReadStream(full).pipe(res);
  }
}

export function routerSpreadsheet(req, res) {
  /**
   * @register_router spreadsheet
   * @method GET
   */
  const relPath = req.query?.path;
  if (!relPath) {
    res.status(400);
    return { success: false, error: 'path is required' };
  }
  try {
    const full = safeResolve(relPath);
    if (!existsSync(full) || statSync(full).isDirectory()) {
      res.status(404);
      return { success: false, error: 'Spreadsheet not found' };
    }
    return { success: true, ...readSpreadsheet(full) };
  } catch (error) {
    res.status(error.message === 'Path is outside workspace' ? 403 : 422);
    return { success: false, error: error.message };
  }
}
