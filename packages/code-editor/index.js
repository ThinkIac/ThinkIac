const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { getProxy, dispatchEvent } = require('logos');

const execFileAsync = promisify(execFile);

const PACKAGES_DIR = path.resolve(__dirname, '../');
const TEXT_FILE_LIMIT = 2 * 1024 * 1024;

// Single source of truth for "a file this editor can open". It used to be two
// separate lists — a narrower one in handleListFiles and a wider one in the
// onBoot registrations — so file-manager happily offered "Open in Code Editor"
// for .py/.sh/.txt files that the explorer refused to list.
const EDITABLE_EXTS = [
    '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.svelte', '.json',
    '.css', '.scss', '.html', '.htm', '.md', '.markdown', '.yaml', '.yml',
    '.py', '.sh', '.bash', '.sql', '.toml', '.ini', '.txt', '.prisma',
];
// Extensionless files that are still plain text worth editing. Without these,
// a Dockerfile or a LICENSE is invisible in the explorer.
const EDITABLE_NAMES = new Set([
    'Dockerfile', 'Makefile', 'LICENSE', 'README', 'Procfile', '.env.example',
    '.gitignore', '.dockerignore', '.npmrc', '.nvmrc', '.editorconfig',
]);

function isEditable(fileName) {
    if (EDITABLE_NAMES.has(fileName)) return true;
    const ext = path.extname(fileName).toLowerCase();
    return ext !== '' && EDITABLE_EXTS.includes(ext);
}

// ── Write safety ────────────────────────────────────────────────────────────
// Agent edits these same files through its own tools, so the editor cannot
// assume it is the only writer. Reads carry the file's mtime, writes send it
// back, and a mismatch is refused instead of silently clobbering the other
// side's work.
const BACKUPS_DIR = path.join(__dirname, '.backups');
const BACKUPS_PER_FILE = 10;

/** Error carrying an HTTP status, so the routers can answer with it. */
function httpError(status, message, details) {
    return Object.assign(new Error(message), { status, details });
}

// Heuristic, not a format check: a NUL byte or a high share of control
// characters in the first 8 KB means reading this as UTF-8 produces garbage.
function looksBinary(buffer) {
    const sample = buffer.subarray(0, 8000);
    if (sample.length === 0) return false;
    if (sample.includes(0)) return true;
    let control = 0;
    for (const byte of sample) {
        if (byte < 9 || (byte > 13 && byte < 32)) control++;
    }
    return control / sample.length > 0.3;
}

function backupSlug(packageId, filePath) {
    // Matches the existing .backups/ naming convention already in this package.
    return `${packageId}_${filePath.replace(/\//g, '__')}`;
}

async function pruneBackups(slug) {
    let entries;
    try { entries = await fs.promises.readdir(BACKUPS_DIR); } catch { return; }
    const mine = entries.filter(name => name.startsWith(`${slug}_`) && name.endsWith('.bak')).sort();
    for (const stale of mine.slice(0, Math.max(0, mine.length - BACKUPS_PER_FILE))) {
        try { await fs.promises.unlink(path.join(BACKUPS_DIR, stale)); } catch { /* best effort */ }
    }
}

/** Copies the current contents aside before they are overwritten. */
async function snapshotBeforeWrite(packageId, filePath, fullPath) {
    let previous;
    try {
        previous = await fs.promises.readFile(fullPath);
    } catch (err) {
        if (err.code === 'ENOENT') return null; // creating a new file: nothing to keep
        throw err;
    }
    const slug = backupSlug(packageId, filePath);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await fs.promises.mkdir(BACKUPS_DIR, { recursive: true });
    const name = `${slug}_${stamp}.bak`;
    await fs.promises.writeFile(path.join(BACKUPS_DIR, name), previous);
    await pruneBackups(slug);
    return name;
}

function compareEntries(a, b) {
    // The same comparator is deliberately used for every level of the explorer.
    // Directory entries always precede files, like VS Code's "folders first".
    const kind = (a.type === 'directory' ? 0 : 1) - (b.type === 'directory' ? 0 : 1);
    return kind || a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' });
}

function safePackageId(packageId) {
    if (typeof packageId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(packageId)) {
        throw new Error('Invalid package');
    }
    return packageId;
}

function safeFilePath(filePath) {
    if (typeof filePath !== 'string' || !filePath.trim() || filePath.includes('\0')) throw new Error('Invalid path');
    const normalized = path.posix.normalize(filePath.replace(/\\/g, '/'));
    if (normalized === '.' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) throw new Error('Invalid path');
    return normalized;
}

function packageRoot(packageId) {
    const root = path.resolve(PACKAGES_DIR, safePackageId(packageId));
    if (!root.startsWith(PACKAGES_DIR + path.sep)) throw new Error('Invalid package');
    return root;
}

function targetPath(packageId, filePath) {
    const root = packageRoot(packageId);
    const target = path.resolve(root, safeFilePath(filePath));
    if (!target.startsWith(root + path.sep)) throw new Error('Invalid path');
    return target;
}

// Splits a combined path (absolute under PACKAGES_DIR, "packages/pkg/file", or
// bare "pkg/file") into {packageId, filePath} for the by-path routes, which
// exist because file-manager and chat blocks only carry a single path string.
function splitCombinedPath(combined) {
    let rel = combined;
    if (path.isAbsolute(combined)) {
        const resolved = path.resolve(combined);
        const withSep = PACKAGES_DIR + path.sep;
        if (!resolved.startsWith(withSep)) throw new Error('Path is outside packages directory');
        rel = path.relative(PACKAGES_DIR, resolved);
    } else {
        rel = rel.replace(/^\.?\/?(apps\/thinkiac\/)?packages\//, '');
    }
    const parts = rel.split(path.sep).filter(Boolean);
    if (parts.length < 2) throw new Error('Path must include a package folder and a file');
    return { packageId: parts[0], filePath: parts.slice(1).join('/') };
}

// Handler central - JS puro, testável isoladamente
async function handleListPackages() {
    const entries = await fs.promises.readdir(PACKAGES_DIR, { withFileTypes: true });
    const packages = entries
        .filter(d => d.isDirectory() && !d.name.startsWith('.'))
        .map(dir => {
            const pkgPath = path.join(PACKAGES_DIR, dir.name, 'package.json');
            let pkgData = { name: dir.name, description: '', version: '' };
            try {
                const raw = fs.readFileSync(pkgPath, 'utf-8');
                pkgData = { ...pkgData, ...JSON.parse(raw) };
            } catch (e) {
                // package.json não existe ou inválido
            }
            return {
                id: dir.name,
                name: dir.name,
                declaredName: typeof pkgData.name === 'string' && pkgData.name.trim() ? pkgData.name : dir.name,
                description: pkgData.description || '',
                version: pkgData.version || ''
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    
    return packages;
}

async function handleListFiles(packageId) {
    const pkgPath = packageRoot(packageId);
    const entries = [];
    
    async function scanDir(dir, base = '') {
        const children = await fs.promises.readdir(dir, { withFileTypes: true });
        // Hidden entries stay hidden, except for the handful of dotfiles that
        // are ordinary editable text (.gitignore, .env.example, …).
        const visible = children.filter(entry => entry.name !== 'node_modules'
                && (!entry.name.startsWith('.') || (entry.isFile() && EDITABLE_NAMES.has(entry.name))))
            .sort((a, b) => compareEntries({ type: a.isDirectory() ? 'directory' : 'file', name: a.name }, { type: b.isDirectory() ? 'directory' : 'file', name: b.name }));
        for (const entry of visible) {
            const fullPath = path.join(dir, entry.name);
            const relPath = base ? `${base}/${entry.name}` : entry.name;

            if (entry.isDirectory()) {
                entries.push({ type: 'directory', path: relPath, name: entry.name });
                await scanDir(fullPath, relPath);
            } else if (entry.isFile() && isEditable(entry.name)) {
                entries.push({
                    type: 'file',
                    path: relPath,
                    name: entry.name,
                    ext: path.extname(entry.name).slice(1).toLowerCase()
                });
            }
        }
    }
    
    await scanDir(pkgPath);
    return entries;
}

async function handleReadFile(packageId, filePath) {
    const fullPath = targetPath(packageId, filePath);
    let stat;
    try {
        stat = await fs.promises.stat(fullPath);
    } catch (err) {
        if (err.code === 'ENOENT') throw httpError(404, 'File not found');
        throw err;
    }
    if (!stat.isFile()) throw httpError(400, 'Not a file');
    if (stat.size > TEXT_FILE_LIMIT) {
        throw httpError(413, `File is too large to edit (${Math.round(stat.size / 1024)} KB)`);
    }
    const buffer = await fs.promises.readFile(fullPath);
    // Reading a PNG as utf-8 used to succeed and paint the editor with garbage.
    if (looksBinary(buffer)) throw httpError(415, 'File appears to be binary');
    return {
        path: filePath,
        content: buffer.toString('utf8'),
        // Round to whole milliseconds: mtimeMs carries sub-ms precision on some
        // filesystems that does not survive a JSON round-trip intact.
        mtime: Math.round(stat.mtimeMs),
        size: stat.size,
    };
}

async function handleWriteFile(packageId, filePath, content, baseMtime = null) {
    const fullPath = targetPath(packageId, filePath);
    let existing = null;
    try {
        existing = await fs.promises.stat(fullPath);
    } catch (err) {
        if (err.code !== 'ENOENT') throw err;
    }
    // A missing baseMtime means the caller opted out of conflict detection
    // (older clients, the by-path routes), so the write proceeds as before.
    if (existing && baseMtime != null && Math.round(existing.mtimeMs) !== Math.round(baseMtime)) {
        throw httpError(409, 'File changed on disk since it was opened', {
            conflict: true,
            currentMtime: Math.round(existing.mtimeMs),
            expectedMtime: Math.round(baseMtime),
        });
    }
    const backup = await snapshotBeforeWrite(packageId, filePath, fullPath);
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.promises.writeFile(fullPath, content, 'utf-8');
    const after = await fs.promises.stat(fullPath);
    return { path: filePath, success: true, mtime: Math.round(after.mtimeMs), size: after.size, backup };
}

async function handleCreate(packageId, filePath, type) {
    const fullPath = targetPath(packageId, filePath);
    if (!['file', 'directory'].includes(type)) throw new Error('Invalid entry type');
    try { await fs.promises.lstat(fullPath); throw new Error('Destination already exists'); } catch (err) { if (err.code !== 'ENOENT') throw err; }
    if (type === 'directory') await fs.promises.mkdir(fullPath, { recursive: false });
    else {
        await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.promises.writeFile(fullPath, '', { flag: 'wx' });
    }
    return { success: true, path: safeFilePath(filePath), type };
}

async function handleRename(packageId, from, to) {
    const source = targetPath(packageId, from);
    const destination = targetPath(packageId, to);
    if (source === destination) return { success: true, path: safeFilePath(to) };
    try { await fs.promises.lstat(destination); throw new Error('Destination already exists'); } catch (err) { if (err.code !== 'ENOENT') throw err; }
    await fs.promises.rename(source, destination);
    return { success: true, from: safeFilePath(from), path: safeFilePath(to) };
}

async function handleDelete(packageId, filePath) {
    const fullPath = targetPath(packageId, filePath);
    const stat = await fs.promises.lstat(fullPath); // ENOENT propagates as "not found"
    if (stat.isDirectory()) await fs.promises.rm(fullPath, { recursive: true });
    else await fs.promises.unlink(fullPath);
    return { success: true, path: safeFilePath(filePath), type: stat.isDirectory() ? 'directory' : 'file' };
}

// ── Git ─────────────────────────────────────────────────────────────────────
// Read-only: the editor shows which files it has touched and what changed. It
// never stages, commits or checks out — those stay a deliberate act elsewhere.
const GIT_TIMEOUT_MS = 10_000;

async function git(args, cwd) {
    try {
        const { stdout } = await execFileAsync('git', args, {
            cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024,
            windowsHide: true,
        });
        return stdout;
    } catch (err) {
        if (err.code === 'ENOENT') throw httpError(503, 'git is not installed');
        throw httpError(503, `git failed: ${(err.stderr || err.message || '').toString().trim().slice(0, 200)}`);
    }
}

// Porcelain output is always relative to the repository root, so the package's
// own prefix has to be stripped to line the paths up with the explorer.
async function gitPrefix(root) {
    return (await git(['rev-parse', '--show-prefix'], root)).trim();
}

const GIT_LABELS = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', U: 'conflict', '?': 'untracked' };

function gitLabel(code) {
    // Index status wins over worktree status when both are set.
    const staged = code[0] !== ' ' && code[0] !== '?' ? code[0] : null;
    return GIT_LABELS[staged ?? code[1] ?? code[0]] ?? 'modified';
}

async function handleGitStatus(packageId) {
    const root = packageRoot(packageId);
    const prefix = await gitPrefix(root);
    const stdout = await git(['status', '--porcelain', '--untracked-files=all', '--', '.'], root);
    const files = {};
    for (const line of stdout.split('\n')) {
        if (line.length < 4) continue;
        const code = line.slice(0, 2);
        let rel = line.slice(3);
        // Renames are reported as "old -> new"; the new path is what the tree shows.
        const arrow = rel.indexOf(' -> ');
        if (arrow !== -1) rel = rel.slice(arrow + 4);
        rel = rel.replace(/^"(.*)"$/, '$1');
        if (prefix && rel.startsWith(prefix)) rel = rel.slice(prefix.length);
        else if (prefix) continue; // outside this package
        if (rel) files[rel] = gitLabel(code);
    }
    return { package: packageId, files, staged: false };
}

async function handleGitDiff(packageId, filePath) {
    const root = packageRoot(packageId);
    targetPath(packageId, filePath); // rejects traversal before it reaches git
    const safe = safeFilePath(filePath);
    // HEAD first so staged changes show up too; '--' keeps a path that looks
    // like a revision from being parsed as one.
    const diff = await git(['diff', '--no-color', 'HEAD', '--', safe], root);
    if (diff.trim()) return { path: safe, diff, untracked: false };
    // Nothing against HEAD: either clean, or the file is not tracked at all.
    const tracked = (await git(['ls-files', '--', safe], root)).trim();
    return { path: safe, diff: '', untracked: !tracked };
}

// ── AI assist ───────────────────────────────────────────────────────────────
// The runtime already hosts the LLM pool; the editor being next to it and not
// using it was the actual gap.
const MAX_AI_INPUT = 24_000; // characters of selection/file sent to the model

const AI_ACTIONS = {
    explain: {
        label: 'Explain',
        mode: 'text', // answer goes to a panel
        system: 'You are a senior engineer reviewing code. Explain what the given code does, concisely and concretely. Point out anything surprising, wrong, or risky. Answer in the language the user writes in. No preamble.',
        instruction: 'Explain this code.',
    },
    review: {
        label: 'Review',
        mode: 'text',
        system: 'You are a careful code reviewer. Report concrete defects in the given code: wrong behaviour, unhandled cases, race conditions, security issues. Each finding: one line on what breaks and under what input. Say so plainly if you find nothing. No style nitpicks. Answer in the language the user writes in.',
        instruction: 'Review this code for defects.',
    },
    refactor: {
        label: 'Refactor',
        mode: 'replace', // answer replaces the selection
        system: 'You rewrite code. Return ONLY the rewritten code, no explanation and no markdown fence. Preserve the surrounding indentation style and the public behaviour exactly. Keep comments that still apply.',
        instruction: 'Refactor this code for clarity, without changing what it does.',
    },
    test: {
        label: 'Generate test',
        mode: 'text',
        system: 'You write tests. Return ONLY test code, no explanation. Match the test framework and assertion style already visible in the file when you can infer it; otherwise use node:test with node:assert/strict. Cover the behaviour that would actually break, not trivial getters.',
        instruction: 'Write tests for this code.',
    },
};

/** Models are chatty even when told not to be; unwrap a fenced block. */
function stripCodeFence(text) {
    const fenced = text.trim().match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n?```$/);
    return fenced ? fenced[1] : text.trim();
}

async function handleAiAssist({ packageId, filePath, action, selection, instruction }) {
    const spec = AI_ACTIONS[action];
    if (!spec) throw httpError(400, `Unknown action: ${action}`);
    const code = typeof selection === 'string' ? selection : '';
    if (!code.trim()) throw httpError(400, 'Nothing selected');
    if (code.length > MAX_AI_INPUT) {
        throw httpError(413, `Selection is too large (${code.length} chars, limit ${MAX_AI_INPUT})`);
    }

    // agent/llm is ESM and this package is CommonJS — same dynamic-import
    // bridge that classification/tools.js uses.
    let callLLM, parseResponse;
    try {
        ({ callLLM, parseResponse } = await import('../agent/llm/llm.js'));
    } catch (err) {
        throw httpError(503, `LLM runtime unavailable: ${err.message}`);
    }

    const where = packageId && filePath ? `${packageId}/${safeFilePath(filePath)}` : 'an unknown file';
    const userText = [
        `File: ${where}`,
        instruction?.trim() ? `Request: ${instruction.trim()}` : `Request: ${spec.instruction}`,
        '',
        'Code:',
        code,
    ].join('\n');

    let response;
    try {
        response = await callLLM({
            system: spec.system,
            messages: [{ role: 'user', content: userText }],
        });
    } catch (err) {
        throw httpError(502, `LLM call failed: ${err.message}`);
    }
    const parsed = parseResponse(response);
    const text = parsed.text ?? '';
    return {
        action,
        mode: spec.mode,
        model: parsed.model ?? null,
        text: spec.mode === 'replace' ? stripCodeFence(text) : text.trim(),
    };
}

async function handleSearch(packageId, query) {
    if (typeof query !== 'string' || !query.trim()) throw new Error('Search query is required');
    const needle = query.trim();
    const entries = await handleListFiles(packageId);
    const results = [];
    for (const file of entries.filter(entry => entry.type === 'file')) {
        if (results.length >= 200) break;
        const fullPath = targetPath(packageId, file.path);
        let content;
        try {
            const stat = await fs.promises.stat(fullPath);
            if (stat.size > TEXT_FILE_LIMIT) continue;
            const buffer = await fs.promises.readFile(fullPath);
            if (looksBinary(buffer)) continue; // no useful line matches in a blob
            content = buffer.toString('utf8');
        } catch { continue; }
        content.split(/\r?\n/).forEach((text, index) => {
            if (results.length < 200 && text.toLocaleLowerCase().includes(needle.toLocaleLowerCase())) {
                results.push({ path: file.path, line: index + 1, text: text.slice(0, 300) });
            }
        });
    }
    return { query: needle, results };
}

// Turns a rejected handler into a JSON body plus the status it asked for,
// instead of letting the framework surface an opaque 500.
async function respond(res, promise) {
    try {
        return await promise;
    } catch (err) {
        res.status(err.status || 500);
        return { error: err.message || 'Unexpected error', ...(err.details || {}) };
    }
}

// Rotas expostas via CommonJS
module.exports = {
    routerListPackages(req, res) {
        /**
         * @register_router packages
         * @method GET
         */
        return respond(res, handleListPackages());
    },

    routerListFiles(req, res) {
        /**
         * @register_router files
         * @method GET
         */
        const { package: packageId } = req.query;
        if (!packageId) {
            res.status(400);
            return { error: 'Missing package parameter' };
        }
        return respond(res, handleListFiles(packageId));
    },

    routerReadFile(req, res) {
        /**
         * @register_router file/read
         * @method GET
         */
        const { package: packageId, path: filePath } = req.query;
        if (!packageId || !filePath) {
            res.status(400);
            return { error: 'Missing package or path parameter' };
        }
        return respond(res, handleReadFile(packageId, filePath));
    },

    routerWriteFile(req, res) {
        /**
         * @register_router file/write
         * @method POST
         */
        // baseMtime is the mtime the client read the file at; omitting it opts
        // out of conflict detection.
        const { package: packageId, path: filePath, content, baseMtime } = req.body;
        if (!packageId || !filePath || content === undefined) {
            res.status(400);
            return { error: 'Missing required fields' };
        }
        return respond(res, handleWriteFile(packageId, filePath, content, baseMtime));
    },

    routerCreate(req, res) {
        /**
         * @register_router file/create
         * @method POST
         */
        const { package: packageId, path: filePath, type } = req.body || {};
        if (!packageId || !filePath) { res.status(400); return { error: 'Missing package or path' }; }
        return respond(res, handleCreate(packageId, filePath, type));
    },

    routerRename(req, res) {
        /**
         * @register_router file/rename
         * @method POST
         */
        const { package: packageId, from, to } = req.body || {};
        if (!packageId || !from || !to) { res.status(400); return { error: 'Missing package, from or to' }; }
        return respond(res, handleRename(packageId, from, to));
    },

    routerDelete(req, res) {
        /**
         * @register_router file/delete
         * @method POST
         */
        const { package: packageId, path: filePath } = req.body || {};
        if (!packageId || !filePath) { res.status(400); return { error: 'Missing package or path' }; }
        return respond(res, handleDelete(packageId, filePath));
    },

    routerGitStatus(req, res) {
        /**
         * @register_router git/status
         * @method GET
         */
        const { package: packageId } = req.query || {};
        if (!packageId) { res.status(400); return { error: 'Missing package' }; }
        return respond(res, handleGitStatus(packageId));
    },

    routerGitDiff(req, res) {
        /**
         * @register_router git/diff
         * @method GET
         */
        const { package: packageId, path: filePath } = req.query || {};
        if (!packageId || !filePath) { res.status(400); return { error: 'Missing package or path' }; }
        return respond(res, handleGitDiff(packageId, filePath));
    },

    routerAiAssist(req, res) {
        /**
         * @register_router ai/assist
         * @method POST
         */
        const { package: packageId, path: filePath, action, selection, instruction } = req.body || {};
        if (!action || typeof selection !== 'string') {
            res.status(400);
            return { error: 'Missing action or selection' };
        }
        return respond(res, handleAiAssist({ packageId, filePath, action, selection, instruction }));
    },

    routerAiActions(req, res) {
        /**
         * @register_router ai/actions
         * @method GET
         */
        return Object.entries(AI_ACTIONS).map(([id, spec]) => ({ id, label: spec.label, mode: spec.mode }));
    },

    routerSearch(req, res) {
        /**
         * @register_router search
         * @method GET
         */
        const { package: packageId, q } = req.query || {};
        if (!packageId || !q) { res.status(400); return { error: 'Missing package or q' }; }
        return respond(res, handleSearch(packageId, q));
    },

    routerReadFileByPath(req, res) {
        /**
         * @register_router file/read-by-path
         * @method GET
         */
        const { path: combinedPath } = req.query;
        if (!combinedPath) {
            res.status(400);
            return { error: 'Missing path parameter' };
        }
        let split;
        try {
            split = splitCombinedPath(combinedPath);
        } catch (e) {
            res.status(400);
            return { error: e.message };
        }
        return respond(res, handleReadFile(split.packageId, split.filePath));
    },

    routerWriteFileByPath(req, res) {
        /**
         * @register_router file/write-by-path
         * @method POST
         */
        const { path: combinedPath, content, baseMtime } = req.body;
        if (!combinedPath || content === undefined) {
            res.status(400);
            return { error: 'Missing path or content' };
        }
        let split;
        try {
            split = splitCombinedPath(combinedPath);
        } catch (e) {
            res.status(400);
            return { error: e.message };
        }
        return respond(res, handleWriteFile(split.packageId, split.filePath, content, baseMtime));
    },

    onBoot(payload, context) {
        /**
         * @register_hook boot
         */
        // Register this package's Embed view as the code-file viewer for
        // file-manager's file browser (last registration wins, so this
        // overrides file-manager's own BUILTIN_VIEWS.text default).
        dispatchEvent('file:register:view', {
            pkg: 'code-editor',
            component: 'Embed',
            exts: EDITABLE_EXTS,
        });
        // Also offer to open those files as a full editor TAB (File Manager
        // "Abrir em Code Editor"), not just the inline preview modal. Same view
        // + ?path=, so the Embed page's `export let path` receives the file.
        dispatchEvent('file:register:opener', {
            pkg: 'code-editor',
            view: 'Embed',
            param: 'path',
            label: 'Code Editor',
            exts: EDITABLE_EXTS,
        });
        console.log('[code-editor] Package initialized');
    },
    _test: {
        compareEntries, safeFilePath, safePackageId, isEditable, EDITABLE_EXTS,
        looksBinary, backupSlug, handleReadFile, handleWriteFile, handleDelete, BACKUPS_DIR,
        gitLabel, stripCodeFence, handleGitStatus, handleGitDiff, handleAiAssist, AI_ACTIONS,
    }
};
