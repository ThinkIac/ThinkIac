// Contrato completo: ../../docs/package-widgets-and-ui-bus.md
// bus.js — event bus LOCAL do frontend do Shell, espelhando a semântica do
// `$` (dispatchEvent) do logos no backend. Permite que qualquer view/widget
// dispare eventos de UI e que a Home reaja — sem prop-drilling.
//
//   import { $, on } from "./lib/bus.js";
//   $("open:app", "file-manager");             // abre outro app
//   $("open:iframe", { url, title: "Docs" }); // abre um iframe com título de aba
//   $("open:canvas", { html });                // abre o Canvas de verdade com esse HTML
//   const off = on("open:app", (pkg) => { ... });
//
// Ponte com iframes: apps rodam em <iframe> (possivelmente cross-origin), então
// não conseguem importar este módulo. Eles chamam
//   parent.postMessage({ source: "aurora", type: "open:app", detail: "pkg" }, "*")
// e a ponte abaixo re-emite no bus local. Mensagens sem `source:"aurora"` são
// ignoradas para não colidir com outros postMessage.

export const SHELL_SOURCE = "thinkiac-shell";
const ACCEPTED_SOURCES = new Set([SHELL_SOURCE, "aurora"]);
export const isShellMessage = (msg) => Boolean(msg && ACCEPTED_SOURCES.has(msg.source));

const handlers = new Map(); // event -> Set<fn>

// ── Gestos — contrato Flutter → Lógos/front ───────────────────────────────
//
// O app Flutter chama, após reconhecer um gesto de BORDA:
//   window.__thinkiacGestures.dispatch(JSON.stringify({
//     type: "swipe", direction: "right", distance: 72, velocity: .8,
//     fromEdge: "left", atScrollTop: true
//   }))
//
// `dispatch` retorna Promise<{handled:boolean}> no browser. No WebView, o
// Flutter registra o JavaScriptChannel `ThinkIacGestures`; após chamar
// `dispatch({requestId, ...})`, recebe nesse canal `{requestId, handled}`.
// Apps em iframe optam por receber o gesto com:
//   parent.postMessage({source:"aurora", type:"gesture:register", detail:{type:"swipe"}}, "*")
// e respondem à mensagem `gesture:dispatch` com `gesture:result` + requestId.
// Assim o shell só executa seu fallback quando o app ativo não o consumiu.

const GESTURE_DIRECTIONS = new Set(["left", "right", "down"]);
const GESTURE_EDGES = new Set(["left", "right", null]);

export function normalizeGesture(raw) {
    if (!raw || typeof raw !== "object" || raw.type !== "swipe") return null;
    if (!GESTURE_DIRECTIONS.has(raw.direction)) return null;
    const fromEdge = raw.fromEdge ?? null;
    if (!GESTURE_EDGES.has(fromEdge)) return null;
    return {
        type: "swipe",
        direction: raw.direction,
        distance: Number.isFinite(Number(raw.distance)) ? Number(raw.distance) : 0,
        velocity: Number.isFinite(Number(raw.velocity)) ? Number(raw.velocity) : 0,
        fromEdge,
        atScrollTop: Boolean(raw.atScrollTop),
        source: raw.source === "web" ? "web" : "native",
    };
}

/** Cria um roteador ordenado: maior prioridade decide antes do fallback. */
export function createGestureRouter() {
    const gestureHandlers = new Set();

    function register(handler, { priority = 0 } = {}) {
        const entry = { handler, priority };
        gestureHandlers.add(entry);
        return () => gestureHandlers.delete(entry);
    }

    async function dispatch(rawGesture) {
        const gesture = normalizeGesture(rawGesture);
        if (!gesture) return { handled: false, reason: "invalid" };
        const ordered = [...gestureHandlers].sort((a, b) => b.priority - a.priority);
        for (const { handler } of ordered) {
            try {
                const result = await handler(gesture);
                if (result === true || result?.handled === true) {
                    return { handled: true };
                }
            } catch (error) {
                // Um app defeituoso não pode bloquear o fallback do sistema.
                console.error("[gestures] handler falhou:", error);
            }
        }
        return { handled: false };
    }

    return { register, dispatch };
}

/** Expõe a ponte nativa estável usada pelo Flutter e por testes de WebView. */
export function installNativeGestureBridge(dispatch) {
    if (typeof window === "undefined") return () => {};
    const receive = (payload) => {
        let raw = payload;
        if (typeof payload === "string") {
            try { raw = JSON.parse(payload); } catch { return Promise.resolve({ handled: false, reason: "invalid-json" }); }
        }
        return Promise.resolve(dispatch(raw)).then((result) => {
            // `evaluateJavascript` não espera Promise em todas as versões de
            // WebView. O canal é a resposta nativa determinística do protocolo.
            window.ThinkIacGestures?.postMessage?.(JSON.stringify({
                requestId: raw?.requestId ?? null,
                handled: result?.handled === true,
            }));
            return result;
        });
    };
    const onGesture = (event) => receive(event.detail);
    window.__thinkiacGestures = { version: 1, dispatch: receive };
    window.addEventListener("logos:gesture", onGesture);
    return () => {
        window.removeEventListener("logos:gesture", onGesture);
        if (window.__thinkiacGestures?.dispatch === receive) delete window.__thinkiacGestures;
    };
}

/**
 * Ponte assíncrona para o iframe ativo. Só frames que se registraram recebem
 * o gesto; timeout curto garante que o menu do shell não fique preso.
 */
export function createIframeGestureBridge({ getActiveFrame, timeout = 140 }) {
    const registered = new WeakSet();
    const pending = new Map();
    let requestSequence = 0;

    function handleMessage(event) {
        const msg = event?.data;
        if (!isShellMessage(msg) || typeof msg.type !== "string") return;
        const frame = getActiveFrame?.();
        if (!frame?.contentWindow || event.source !== frame.contentWindow) return;
        if (msg.type === "gesture:register" && msg.detail?.type === "swipe") {
            registered.add(frame.contentWindow);
            return;
        }
        if (msg.type !== "gesture:result") return;
        const request = pending.get(msg.detail?.requestId);
        if (!request) return;
        pending.delete(msg.detail.requestId);
        clearTimeout(request.timer);
        request.resolve({ handled: msg.detail?.handled === true });
    }

    function dispatch(gesture) {
        const frame = getActiveFrame?.();
        if (!frame?.contentWindow || !registered.has(frame.contentWindow)) {
            return Promise.resolve({ handled: false });
        }
        const requestId = `gesture-${Date.now().toString(36)}-${++requestSequence}`;
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                pending.delete(requestId);
                resolve({ handled: false, reason: "timeout" });
            }, timeout);
            pending.set(requestId, { resolve, timer });
            frame.contentWindow.postMessage({
                source: "logos",
                type: "gesture:dispatch",
                detail: { requestId, gesture },
            }, "*");
        });
    }

    return { dispatch, handleMessage };
}

/**
 * Fallback PWA para as gavetas mobile.
 *
 * Para abrir, o toque precisa começar na faixa física de 24px. Com uma
 * gaveta já aberta, o gesto de fechamento pode começar em qualquer ponto da
 * sua superfície, que é o comportamento esperado de uma drawer nativa.
 */
export function installEdgeSwipeDetector(element, dispatch, isEnabled = () => true, getOpenPanel = () => null) {
    if (!element || typeof window === "undefined") return () => {};
    let start = null;
    const edge = 24;
    const threshold = 64;
    const protectedSelector = "input, textarea, select, [contenteditable='true'], [data-gesture-protect]";
    const onDown = (event) => {
        if (!isEnabled() || event.pointerType !== "touch" || event.target?.closest?.(protectedSelector)) return;
        const fromEdge = event.clientX <= edge ? "left" : event.clientX >= window.innerWidth - edge ? "right" : null;
        const openPanel = getOpenPanel();
        if (!openPanel && !fromEdge) return;
        start = { id: event.pointerId, x: event.clientX, y: event.clientY, at: performance.now(), fromEdge, openPanel };
        element.setPointerCapture?.(event.pointerId);
    };
    const onUp = (event) => {
        if (!start || event.pointerId !== start.id) return;
        const active = start;
        start = null;
        const dx = event.clientX - active.x;
        const dy = event.clientY - active.y;
        if (Math.abs(dx) < threshold || Math.abs(dx) <= Math.abs(dy)) return;
        const direction = dx > 0 ? "right" : "left";
        const closesOpenPanel = (active.openPanel === "left" && direction === "left")
            || (active.openPanel === "right" && direction === "right");
        const opensFromEdge = !active.openPanel && ((active.fromEdge === "left" && direction === "right")
            || (active.fromEdge === "right" && direction === "left"));
        if (!closesOpenPanel && !opensFromEdge) return;
        dispatch({ type: "swipe", direction, distance: Math.abs(dx), velocity: Math.abs(dx) / Math.max(performance.now() - active.at, 1), fromEdge: active.fromEdge, atScrollTop: window.scrollY <= 0, source: "web" });
    };
    const onCancel = () => { start = null; };
    element.addEventListener("pointerdown", onDown, { passive: true });
    element.addEventListener("pointerup", onUp, { passive: true });
    element.addEventListener("pointercancel", onCancel, { passive: true });
    return () => {
        element.removeEventListener("pointerdown", onDown);
        element.removeEventListener("pointerup", onUp);
        element.removeEventListener("pointercancel", onCancel);
    };
}

// Prefixos que fazem o evento ATRAVESSAR pro backend (via WS → dispatchEvent).
// `logos:` é o primário; `think:` é alias. Ex.: $("logos:algo", x) cai nos
// @register_hook logos:algo do backend.
const SERVER_PREFIXES = ["logos:", "think:"];

// Encaminhador para o backend (setado pela camada WS — ver setServerForwarder).
let serverForwarder = null;

/** Liga o encaminhamento front→back. fn(event, detail) envia pelo socket. */
export function setServerForwarder(fn) {
    serverForwarder = fn;
}

function isServerEvent(event) {
    return SERVER_PREFIXES.some((p) => event.startsWith(p));
}

// Dispara SÓ localmente (sem reencaminhar). Usado para eventos que CHEGAM do
// backend, evitando loop de reenvio.
export function emitLocal(event, detail) {
    const set = handlers.get(event);
    if (!set) return 0;
    let n = 0;
    for (const fn of [...set]) {
        try {
            fn(detail);
            n++;
        } catch (e) {
            // Um handler não pode derrubar os demais.
            console.error(`[bus] handler de "${event}" falhou:`, e);
        }
    }
    return n;
}

/**
 * Dispara um evento no bus. Assinatura espelha o $ do backend.
 * Local por padrão; encaminha pro backend se o nome começar com logos: (ou o
 * alias think:), ou se opts.server === true.
 *   $("open:app", "pkg")                 // local
 *   $("logos:reindex", { id })           // local + backend (@register_hook logos:reindex)
 *   $("qualquer", x, { server: true })   // força encaminhar
 */
export function $(event, detail, opts = {}) {
    const n = emitLocal(event, detail);
    if (serverForwarder && (opts.server === true || isServerEvent(event))) {
        try {
            serverForwarder(event, detail);
        } catch (e) {
            console.error(`[bus] forward de "${event}" falhou:`, e);
        }
    }
    return n;
}

/** Assina um evento. Retorna função de unsubscribe. */
export function on(event, handler) {
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event).add(handler);
    return () => handlers.get(event)?.delete(handler);
}

/** Assina uma única vez. */
export function once(event, handler) {
    const off = on(event, (detail) => {
        off();
        handler(detail);
    });
    return off;
}

// ── Ponte postMessage (iframes → bus local) ─────────────────────────────────
let bridged = false;
export function installPostMessageBridge() {
    if (bridged || typeof window === "undefined") return;
    bridged = true;
    window.addEventListener("message", (ev) => {
        const msg = ev?.data;
        if (!msg || typeof msg !== "object" || !isShellMessage(msg)) return;
        if (typeof msg.type !== "string") return;
        $(msg.type, msg.detail);
    });
}

// Exposto no window para debug/inline scripts same-origin.
if (typeof window !== "undefined") {
    window.$thinkiac = { $, on, once };
    window.$aurora = window.$thinkiac; // alias legado para apps já instalados
}
