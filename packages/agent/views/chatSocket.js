








let ws = null;
let wsReady = false;
let reconnectAttempt = 0;
let reconnectTimer = null;
let currentSubs = [];
let lastSentSubs = null;
let tabId = null;







const HEARTBEAT_MS = 20_000;
const LIVENESS_TIMEOUT_MS = 60_000; 
let heartbeatTimer = null;
let lastActivity = 0;

const messageHandlers = new Set();
const reopenHandlers = new Set();
const commandHandlers = new Set();

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
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        
        
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
    try {
        const existing = window.sessionStorage.getItem(key);
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
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
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
        
        markAlive();
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }
        
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



export function send(obj) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
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
