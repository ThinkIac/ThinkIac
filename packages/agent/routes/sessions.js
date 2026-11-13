import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { gunzip } from 'zlib';
import { promisify } from 'node:util';
const unzip = promisify(gunzip);

import { eventCall as $ } from '../host/agent_host.js';
import { activeSessions } from '../core/agent.js';
import { notifySessionsUpdated } from '../core/chat_bus.js';
import { resetCliSession } from '../llm/cli_sessions.js';
import { setAssistantFeedback } from '../memory/session.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SESSION_DIR = path.resolve(__dirname, '../sessions');
const ARCHIVE_DIR = path.resolve(__dirname, '../session-archives');
const ARCHIVE_PATH_RE = /^[A-Za-z0-9_-]{1,200}\/\d+\.json\.gz$/;

async function loadArchivedSession(archive) {
    if (!archive?.path || !ARCHIVE_PATH_RE.test(archive.path)) throw new Error('ponteiro de arquivo compactado inválido');
    const filePath = path.join(ARCHIVE_DIR, archive.path);
    const compressed = await fs.readFile(filePath);
    const checksum = createHash('sha256').update(compressed).digest('hex');
    if (archive.checksum && checksum !== archive.checksum) throw new Error('checksum do arquivo compactado não confere');
    return JSON.parse((await unzip(compressed)).toString('utf8'));
}

async function removeArchivedSession(sessionId, archive) {
    const safeId = String(sessionId || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 200);
    if (!archive?.path || !ARCHIVE_PATH_RE.test(archive.path) || !archive.path.startsWith(`${safeId}/`)) return;
    try { await fs.unlink(path.join(ARCHIVE_DIR, archive.path)); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
}



const metaCache = new Map(); 

let listing = null;
async function listSessions() {
    /**
     * @register_router sessions/list
     * @method GET
     */
    if (!listing) listing = readSessionList().finally(() => { listing = null; });
    return listing;
}

async function readSessionList() {
    try {
        await fs.mkdir(SESSION_DIR, { recursive: true });

        const files = await fs.readdir(SESSION_DIR);
        const jsonFiles = new Set(files.filter(f => f.endsWith('.json')));

        for (const cached of metaCache.keys()) {
            if (!jsonFiles.has(cached)) metaCache.delete(cached);
        }

        const sessions = [];
        const pendingFiles = [...jsonFiles];
        let nextFile = 0;
        await Promise.all(Array.from({ length: Math.min(8, pendingFiles.length) }, async () => {
        while (nextFile < pendingFiles.length) {
            const fileIndex = nextFile++;
            const file = pendingFiles[fileIndex];
            
            
            try {
                const filePath = path.join(SESSION_DIR, file);
                const stat = await fs.stat(filePath);

                let entry = metaCache.get(file);
                if (!entry || entry.mtimeMs !== stat.mtimeMs) {
                    const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
                    entry = {
                        mtimeMs: stat.mtimeMs,
                        meta: {
                            id: data.id ?? file.replace(/\.json$/, ''),
                            created_at: data.created_at,
                            updated_at: stat.mtime.toISOString(),
                            message_count: data.messages?.length ?? 0,
                            title: data.title ?? null,
                            summary: data.summary ?? null,
                            fileName: file
                        }
                    };
                    metaCache.set(file, entry);
                }
                sessions[fileIndex] = { ...entry.meta, active: activeSessions.has(entry.meta.id) };
            } catch (err) {
                await $('session:error', `listSessions: skipping ${file}: ${err.message}`);
            }
        }

        }));

        return sessions.filter(Boolean).sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
    } catch (err) {
        await $('session:error', err.message);
        return [];
    }
}

async function getHistory(req, res, ctx) {
    /**
     * @register_router sessions/:sessionId/history
     * @method GET
     */
    const { params, query } = req;
    const sessionId = params?.sessionId;
    const requestedLimit = query?.limit;
    const limit = requestedLimit === "all"
        ? null
        : Math.max(1, Math.min(1000, Number.parseInt(requestedLimit, 10) || 100));

    if (!sessionId) return { message: "sessionId is required" };

    try {
        const filePath = path.join(SESSION_DIR, `${sessionId}.json`);
        const content = await fs.readFile(filePath, 'utf8');
        const data = JSON.parse(content);

        
        
        let messages = data.messages || [];
        if (data.archive) {
            const archived = await loadArchivedSession(data.archive);
            messages = [...(archived.messages || []), ...(data.messages || [])];
        }

        
        
        
        
        const filtered = messages.filter(m => {
            if (m.role === 'tool') return false;          
            if (m.role === 'assistant' && !m.content
                && (!Array.isArray(m.tool_calls) || m.tool_calls.length === 0)) return false;
            return true;
        });

        return limit === null ? filtered : filtered.slice(-limit);
    } catch (err) {
        await $('session:error', err.message);
        return null;
    }
}

function normaliseSearchText(value) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

function trigrams(value) {
    const compact = `  ${value.replace(/\s+/g, ' ').trim()}  `;
    const grams = new Set();
    for (let index = 0; index <= compact.length - 3; index += 1) {
        grams.add(compact.slice(index, index + 3));
    }
    return grams;
}



function similarityScore(query, text) {
    const haystack = normaliseSearchText(text);
    if (!query || !haystack) return 0;

    const terms = [...new Set(query.split(' ').filter(term => term.length > 1))];
    const matchedTerms = terms.filter(term => haystack.includes(term));
    const phrase = haystack.includes(query);
    const coverage = terms.length ? matchedTerms.length / terms.length : 0;
    const queryGrams = trigrams(query);
    const textGrams = trigrams(haystack);
    let shared = 0;
    for (const gram of queryGrams) if (textGrams.has(gram)) shared += 1;
    const dice = queryGrams.size + textGrams.size
        ? (2 * shared) / (queryGrams.size + textGrams.size)
        : 0;

    
    
    if (!phrase && coverage === 0 && (query.length < 4 || dice < 0.18)) return 0;
    return (phrase ? 1000 : 0) + coverage * 500 + dice * 100;
}

function searchSnippet(text, query) {
    const source = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (!source) return '';
    const normalisedSource = normaliseSearchText(source);
    const firstTerm = query.split(' ').find(Boolean) || '';
    const position = normalisedSource.indexOf(firstTerm);
    
    
    const start = Math.max(0, position - 72);
    const end = Math.min(source.length, start + 200);
    return `${start > 0 ? '…' : ''}${source.slice(start, end)}${end < source.length ? '…' : ''}`;
}

async function searchSessions(req, res, ctx) {
    /**
     * @register_router sessions/search
     * @method GET
     */
    const query = normaliseSearchText(req.query?.q);
    if (query.length < 2) return [];

    try {
        const files = (await fs.readdir(SESSION_DIR)).filter(file => file.endsWith('.json'));
        const results = await Promise.all(files.map(async file => {
            try {
                const filePath = path.join(SESSION_DIR, file);
                const [content, stat] = await Promise.all([fs.readFile(filePath, 'utf8'), fs.stat(filePath)]);
                const data = JSON.parse(content);
                let messages = data.messages || [];
                if (data.archive) {
                    const archived = await loadArchivedSession(data.archive);
                    messages = [...(archived.messages || []), ...messages];
                }

                const fields = [data.title, data.summary, ...messages.map(message => message?.content)];
                let bestScore = 0;
                let bestText = '';
                for (const field of fields) {
                    const score = similarityScore(query, field);
                    if (score > bestScore) {
                        bestScore = score;
                        bestText = field;
                    }
                }
                if (!bestScore) return null;

                return {
                    id: data.id ?? file.replace(/\.json$/, ''),
                    created_at: data.created_at,
                    updated_at: stat.mtime.toISOString(),
                    message_count: messages.length,
                    title: data.title ?? null,
                    summary: data.summary ?? null,
                    match: searchSnippet(bestText, query),
                    score: bestScore,
                    active: activeSessions.has(data.id ?? file.replace(/\.json$/, '')),
                };
            } catch (error) {
                await $('session:error', `searchSessions: skipping ${file}: ${error.message}`);
                return null;
            }
        }));

        return results
            .filter(Boolean)
            .sort((a, b) => b.score - a.score || (b.updated_at || '').localeCompare(a.updated_at || ''))
            .slice(0, 100);
    } catch (error) {
        await $('session:error', `searchSessions: ${error.message}`);
        return [];
    }
}

async function getSessionStatus(req, res, ctx) {
    /**
     * @register_router sessions/:sessionId/status
     * @method GET
     */
    const { params } = req;
    const sessionId = params?.sessionId;

    if (!sessionId) {
        return { error: "sessionId is required" };
    }

    return {
        active: activeSessions.has(sessionId),
        sessionId,
    };
}

async function saveFeedback(sessionId, assistantOrdinal, feedback) {
    if (!sessionId) throw new Error('sessionId is required');
    return setAssistantFeedback(sessionId, assistantOrdinal, feedback);
}

async function setMessageFeedback(req, res, ctx) {
    /**
     * @register_router sessions/:sessionId/feedback
     * @method POST
     */
    try {
        const sessionId = req.params?.sessionId;
        const { assistant_ordinal, value, reason, comment } = req.body ?? {};
        const feedback = await saveFeedback(sessionId, assistant_ordinal, { value, reason, comment });
        return { success: true, feedback };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function clearSession(req, res, ctx) {
    /**
     * @register_router sessions/:sessionId/clear
     * @method GET
     */
    const { params, query } = req;
    const sessionId = params?.sessionId;

    try {
        const filePath = path.join(SESSION_DIR, `${sessionId}.json`);
        const content = await fs.readFile(filePath, 'utf8');
        const data = JSON.parse(content);

        await removeArchivedSession(sessionId, data.archive);

        data.messages = [];
        data.summary = null;
        data.archive = null;
        data.compactedAt = null;
        
        data.title = null;
        data.title_message_count = 0;

        await fs.writeFile(filePath, JSON.stringify(data, null, 2));
        
        
        
        resetCliSession('claude-cli', sessionId);
        notifySessionsUpdated('cleared', sessionId);
        return true;
    } catch (err) {
        await $('session:error', err.message);

        return false;
    }
}

async function deleteSession(req, res, ctx) {
    /**
     * @register_router sessions/:sessionId
     * @method DELETE
     */
    const { params } = req;
    const sessionId = params?.sessionId;

    if (!sessionId) {
        return { success: false, message: "sessionId is required" };
    }

    try {
        const filePath = path.join(SESSION_DIR, `${sessionId}.json`);
        const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
        await removeArchivedSession(sessionId, data.archive);
        await fs.unlink(filePath);
        resetCliSession('claude-cli', sessionId);
        notifySessionsUpdated('deleted', sessionId);

        return { success: true, message: `Session ${sessionId} deleted successfully` };
    } catch (err) {
        await $('session:error', err.message);
        
        return { success: false, error: err.message };
    }
}







async function getTitleConfig(req, res, ctx) {
    /**
     * @register_router sessions/title-config
     * @method GET
     */
    try {
        const { getTitleSettings } = await import('../core/session_title_settings.js');
        return getTitleSettings();
    } catch (err) {
        await $('session:error', `getTitleConfig: ${err.message}`);
        return { error: err.message };
    }
}

async function setTitleConfig(req, res, ctx) {
    /**
     * @register_router sessions/title-config
     * @method POST
     */
    try {
        const { saveTitleSettings } = await import('../core/session_title_settings.js');
        return saveTitleSettings(req.body ?? {});
    } catch (err) {
        
        
        await $('session:error', `setTitleConfig: ${err.message}`);
        return { error: err.message };
    }
}

export {
    listSessions, searchSessions, getHistory, getSessionStatus, clearSession, deleteSession,
    getTitleConfig, setTitleConfig, setMessageFeedback
};
