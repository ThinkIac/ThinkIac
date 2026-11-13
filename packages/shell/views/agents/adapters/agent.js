// chatSocket.js — canal WebSocket único por aba do navegador para eventos de
// chat (tokens, steps, done…) e invalidação da lista de sessões.
//
// Conecta no hub WS do logos (`/ws?session=agent-ui-<tabId>`) e se subscreve
// nas sessões de CHAT abertas via `{ type:'chat:subscribe', sessions:[ids] }`.
// Recebe `chat:event` (com seq para dedupe/replay) e `sessions:updated`.
// Reconecta com backoff; a cada (re)abertura re-subscreve e dispara os
// handlers de reopen para o Home reconciliar sessões ativas.

const ROUTE_BASE = '/agent';

export const capabilities = Object.freeze([
    'sessions',
    'streaming',
    'attachments',
    'voice',
    'workspace',
]);

function endpoint(path) {
    const suffix = String(path || '');
    return `${ROUTE_BASE}${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
}

export function request(path, options = {}) {
    return fetch(endpoint(path), options);
}

export function resourceUrl(path) {
    return endpoint(path);
}

let ws = null;
let wsReady = false;
let reconnectAttempt = 0;
let reconnectTimer = null;
let currentSubs = [];
let lastSentSubs = null;
let tabId = null;

// ── Heartbeat / liveness ─────────────────────────────────────────────────────
// O evento `close` não dispara numa morte silenciosa do socket (proxy ocioso,
// sleep/wake, troca de rede) — sem isto os eventos de chat simplesmente param
// de chegar e a bolha trava em "pensando". Mandamos um ping app-level e
// exigimos o pong; se nenhum frame chega dentro de LIVENESS_TIMEOUT, forçamos
// close() → dispara a reconexão com replay (reconcileSession).
const HEARTBEAT_MS = 20_000;
const LIVENESS_TIMEOUT_MS = 60_000; // ~3 pings sem resposta → considera morto
let heartbeatTimer = null;
let lastActivity = 0;

const messageHandlers = new Set();
const reopenHandlers = new Set();
const commandHandlers = new Set();

function isSocketOpen(candidate) {
    return typeof WebSocket !== "undefined" && candidate?.readyState === WebSocket.OPEN;
}

function markAlive() {
    lastActivity = Date.now();
}

function stopHeartbeat() {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
}

function startHeartbeat() {
    stopHeartbeat();
    markAlive();
    heartbeatTimer = setInterval(() => {
        if (!isSocketOpen(ws)) return;
        // Sem nenhum frame (pong/evento) dentro da janela → conexão morta em
        // silêncio: força close() para acionar o backoff/reconnect.
        if (Date.now() - lastActivity > LIVENESS_TIMEOUT_MS) {
            try { ws.close(); } catch { /* já fechado */ }
            return;
        }
        try { ws.send(JSON.stringify({ type: "ping", t: Date.now() })); } catch { /* fechando */ }
    }, HEARTBEAT_MS);
}

function wsUrl() {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    tabId = getTabId();
    return `${proto}//${window.location.host}/ws?session=agent-ui-${tabId}`;
}

function getTabId() {
    const key = "agent:front-tab-id";
    const legacyKey = "aurora:front-tab-id";
    try {
        const existing = window.sessionStorage.getItem(key) || window.sessionStorage.getItem(legacyKey);
        if (existing) return existing;
        const created = `agent-ui-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
        window.sessionStorage.setItem(key, created);
        return created;
    } catch {
        return `agent-ui-${Math.random().toString(36).slice(2)}`;
    }
}

function viewport() {
    return { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1 };
}

function sendHello() {
    send({
        type: "ui:hello",
        tabId: tabId || getTabId(),
        route: `${window.location.pathname}${window.location.search}`,
        viewport: viewport(),
        platform: navigator.userAgentData?.platform || navigator.platform || "unknown",
        capabilities: ["ui:state", "ui:navigate", "ui:snapshot"],
    });
}

function sendSubscribe() {
    if (!isSocketOpen(ws)) return;
    const payload = JSON.stringify({ type: "chat:subscribe", sessions: currentSubs });
    if (payload === lastSentSubs) return;
    lastSentSubs = payload;
    ws.send(payload);
}

export function connect() {
    if (typeof window === "undefined" || ws) return;

    ws = new WebSocket(wsUrl());

    ws.addEventListener("open", () => {
        wsReady = true;
        reconnectAttempt = 0;
        lastSentSubs = null;
        sendHello();
        sendSubscribe();
        startHeartbeat();
        for (const cb of reopenHandlers) {
            try { cb(); } catch { /* handler não pode derrubar o socket */ }
        }
    });

    ws.addEventListener("message", (event) => {
        // Qualquer frame recebido comprova que a conexão está viva.
        markAlive();
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }
        // Resposta do heartbeat app-level — só serve para marcar vida (feito acima).
        if (msg.type === "pong") return;
        if (msg.type === "ui:command") {
            for (const cb of commandHandlers) {
                try { cb(msg.command); } catch { /* comando inválido não derruba o socket */ }
            }
            return;
        }
        if (
            msg.type !== "chat:event" &&
            msg.type !== "sessions:updated" &&
            msg.type !== "bus:event"
        )
            return;
        for (const cb of messageHandlers) {
            try { cb(msg); } catch { /* idem */ }
        }
    });

    ws.addEventListener("close", () => {
        wsReady = false;
        ws = null;
        stopHeartbeat();
        reconnectTimer = setTimeout(() => {
            reconnectAttempt++;
            connect();
        }, Math.min(1000 * 2 ** reconnectAttempt, 10000));
    });

    ws.addEventListener("error", () => {
        try { ws?.close(); } catch { /* já fechado */ }
    });
}

// Envia um objeto JSON pelo socket (se aberto). Usado pela ponte do bus
// (front→back): send({ type: "bus:emit", event, detail }).
export function send(obj) {
    if (!isSocketOpen(ws)) return false;
    try {
        ws.send(JSON.stringify(obj));
        return true;
    } catch {
        return false;
    }
}

export function subscribe(sessionIds) {
    currentSubs = [...new Set((sessionIds || []).filter(Boolean))];
    sendSubscribe();
}

export function on(handler) {
    messageHandlers.add(handler);
    return () => messageHandlers.delete(handler);
}

export function onReopen(handler) {
    reopenHandlers.add(handler);
    return () => reopenHandlers.delete(handler);
}

export function setUiState(state = {}) {
    return send({ type: "ui:state", route: `${window.location.pathname}${window.location.search}`, viewport: viewport(), ...state });
}

export function sendSnapshot(snapshot) {
    return send({ type: "ui:snapshot", snapshot });
}

export function onCommand(handler) {
    commandHandlers.add(handler);
    return () => commandHandlers.delete(handler);
}

export function isReady() {
    return wsReady;
}
