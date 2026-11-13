// hermes — barramento do Lógos aberto para os aparelhos pareados.
//
// NÃO substitui o ntfy. Notificação push continua indo pelo ntfy, que já
// funciona e é o caminho testado em produção; mexer nisso derrubaria a via
// que avisa o usuário. O que este pacote abre é o barramento em si: o app
// passa a emitir evento no bus do runtime e a receber evento de volta —
// as duas direções que faltavam.
//
// Transporte: o WebSocket que o Lógos já tem no kernel (o mesmo de chat e
// HMR), autenticado por aparelho.
//
// A entrega de notificação (`device:notify`) existe aqui e é usável, mas
// nada a dispara automaticamente: não há ponte a partir de `ntfy:notify`,
// justamente para o aparelho não receber a mesma coisa duas vezes.
//
// Ver AGENT.md para o contrato de mensagem e o protocolo do socket.

import { resolve, dirname } from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { dispatchEvent } from 'logos';
import { createDeviceStore } from './devices.js';
import { normaliseMessage, parseDeviceFrame } from './message.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const CHANNEL = 'hermes:link';

// O caminho é configurável para os testes conseguirem exercitar o link contra
// um arquivo temporário em vez do registro real de aparelhos.
export const store = createDeviceStore(
  process.env.HERMES_DEVICES_FILE || resolve(__dirname, 'devices.json'),
);

// `dispatchEvent` só existe de verdade com o runtime de pé. Fora dele (teste,
// script solto) a falha não pode derrubar o tratamento do frame — o aparelho
// perderia o socket por causa de um evento que ninguém estava ouvindo.
async function safeDispatch(event, payload) {
  try {
    await dispatchEvent(event, payload);
  } catch (err) {
    console.warn(`[hermes] ${event}: ${err.message}`);
  }
}

// ── Sockets autenticados ────────────────────────────────────────────────
//
// A entrega NÃO usa `pushToSession` do hub: o hub chaveia pela query
// `?session=` da URL, que é escolhida pelo cliente e não prova nada. Quem
// conectasse com o appId de outro receberia os pushes dele sem nunca
// autenticar. Só entra neste mapa o socket que apresentou (appId, token).
const links = new Map(); // appId → Set<ws>

// RPC efêmero para a bridge Android que mora no app Flutter. O Cloud nunca
// recebe IP, porta ou credenciais ADB: envia um pedido pelo socket já
// autenticado do aparelho e espera a resposta correlacionada.
const androidRequests = new Map(); // requestId → { appId, resolve, timer }
const mobileLlmRequests = new Map(); // requestId → { appId, resolve, reject, timer }
const ANDROID_REQUEST_TIMEOUT_MS = 35_000;
const ANDROID_ACTIONS = new Set([
  'status', 'activate', 'stop', 'capabilities', 'screenshot', 'foreground', 'packages',
  'battery', 'identity', 'ui-tree', 'screen-state', 'prepare', 'tap',
  'swipe', 'key', 'text', 'open-app', 'app-info',
]);
// Operações de alto nível publicadas pelo APK. Não são comandos ADB: o
// aparelho valida esta lista e executa somente APIs Android/Intents próprios.
const ANDROID_TOOL_OPERATIONS = new Set([
  'device.status', 'app.foreground', 'apps.list', 'audio.get', 'connectivity.get',
  'alarms.list', 'calendar.summary', 'contacts.find', 'location.once',
  'flashlight.set', 'volume.set', 'ringer.set', 'app.open', 'link.open',
  'settings.open', 'maps.open', 'alarm.confirm', 'reminder.confirm',
  'calendar.confirm', 'note.confirm', 'message.confirm', 'email.confirm', 'call.confirm',
  'share.confirm', 'brightness.set', 'orientation.lock.set', 'dnd.set', 'setting.restore', 'catalog.get',
]);

function bind(appId, ws) {
  if (!links.has(appId)) links.set(appId, new Set());
  links.get(appId).add(ws);
  ws._hermesAppId = appId;
}

function unbind(ws) {
  const appId = ws?._hermesAppId;
  if (!appId) return;
  const set = links.get(appId);
  if (!set) return;
  set.delete(ws);
  if (!set.size) links.delete(appId);
}

export function connectedDevices() {
  return [...links.keys()];
}

function sendTo(appId, payload) {
  const set = links.get(appId);
  if (!set) return 0;
  const raw = JSON.stringify({ channel: CHANNEL, ...payload });
  let sent = 0;
  for (const ws of set) {
    if (ws.readyState !== 1) continue;
    try { ws.send(raw); sent++; } catch { /* morto; o close limpa */ }
  }
  return sent;
}

// ── Entrega ─────────────────────────────────────────────────────────────

/**
 * Entrega uma notificação aos devices. Sem `appId`, vai para todos os
 * pareados. O que não pôde ser entregue agora fica na fila do device e sai
 * quando ele reconecta — o ntfy perdia isso, porque o app assinava com
 * `since=<agora>` e tudo que passou com o socket caído sumia.
 */
export function deliver(input = {}) {
  const message = normaliseMessage(input);
  const requested = input.appId
    ? [String(input.appId)]
    : store.list().map(d => d.appId);
  const enabled = new Map(store.list().map(d => [d.appId, d.notificationsEnabled !== false]));
  const targets = requested.filter(appId => enabled.get(appId));

  if (!targets.length) {
    return {
      success: false,
      delivered: 0,
      queued: 0,
      reason: requested.length ? 'nenhum device com notificações ativas' : 'nenhum device pareado',
    };
  }

  let delivered = 0;
  let queued = 0;
  for (const appId of targets) {
    if (sendTo(appId, message) > 0) {
      delivered++;
      store.recordDelivery(appId, { id: message.id, status: 'sent' });
    } else if (store.enqueue(appId, message)) {
      queued++;
      store.recordDelivery(appId, { id: message.id, status: 'queued' });
    }
  }

  return { success: true, id: message.id, delivered, queued, targets: targets.length };
}

// ── Hooks de barramento ─────────────────────────────────────────────────

export async function onDeviceNotify(payload) {
  /**
   * @register_hook device:notify
   * @description Entrega uma notificação aos aparelhos pareados pelo link do runtime (sem ntfy). Campos de metadado são campos de verdade, não tags codificadas.
   * @param {object} payload - Dados da notificação
   * @param {string} payload.message - Corpo da mensagem (obrigatório)
   * @param {string?} payload.title - Título (padrão: "ThinkIac")
   * @param {string?} payload.click - URL de deep-link ao tocar na notificação
   * @param {string?} payload.appId - Device alvo. Omitido, vai para todos os pareados.
   * @param {string?} payload.discreteId - Notificação própria, deduplicada por este id (reenviar atualiza a mesma).
   * @param {number?} payload.hold - Sem discreteId: segundos que a notificação persistente mostra este texto.
   * @param {string?} payload.interaction - "confirm" ou "prompt": o aparelho pergunta e a resposta volta no evento `device:response`.
   */
  try {
    deliver(payload || {});
  } catch (err) {
    console.warn(`[hermes] device:notify: ${err.message}`);
  }
  return payload;
}

/**
 * Encaminha um evento do barramento para os aparelhos. É a direção
 * runtime → app do canal; a oposta é o frame `event` que o aparelho manda.
 *
 * Diferente de uma notificação, isto não aparece na tela: é dado para o app
 * reagir. Notificação continua sendo assunto do ntfy.
 */
export function emitToDevice({ event, payload = {}, appId } = {}) {
  if (!event) throw new Error('Campo "event" é obrigatório');

  const targets = appId ? [String(appId)] : connectedDevices();
  let delivered = 0;
  for (const alvo of targets) {
    if (sendTo(alvo, { type: 'event', event: String(event), payload })) delivered++;
  }
  // Evento de barramento não vai para a fila: ao contrário de uma
  // notificação, ele descreve algo de agora — entregar meia hora depois
  // confundiria o app em vez de ajudar.
  return { success: true, event, delivered };
}

function clearAndroidRequest(requestId) {
  const pending = androidRequests.get(requestId);
  if (!pending) return null;
  clearTimeout(pending.timer);
  androidRequests.delete(requestId);
  return pending;
}

/** Executa uma ação ADB permitida no app Flutter pareado, sem abrir ADB na rede. */
export function requestAndroidBridge({ appId, action, params = {}, timeoutMs } = {}) {
  const target = String(appId || '').trim();
  const operation = String(action || '').trim();
  if (!target) throw new Error('Campo "appId" é obrigatório');
  if (!ANDROID_ACTIONS.has(operation)) throw new Error('Ação Android não permitida');
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new Error('"params" deve ser um objeto');
  }
  const requestId = randomUUID();
  const wait = Math.min(Math.max(Number(timeoutMs) || ANDROID_REQUEST_TIMEOUT_MS, 1_000), ANDROID_REQUEST_TIMEOUT_MS);
  return new Promise((resolveRequest, reject) => {
    const timer = setTimeout(() => {
      if (clearAndroidRequest(requestId)) reject(new Error('O app Flutter não respondeu à ação Android a tempo'));
    }, wait);
    androidRequests.set(requestId, {
      appId: target,
      timer,
      resolve: resolveRequest,
    });
    const delivered = sendTo(target, {
      type: 'event',
      event: 'android:bridge.request',
      payload: { requestId, action: operation, params },
    });
    if (!delivered) {
      clearAndroidRequest(requestId);
      reject(new Error('O app Flutter solicitado não está conectado ao Cloud'));
    }
  });
}

/** Executa uma capability tipada do APK pelo mesmo link autenticado. */
export function requestAndroidTools({ appId, operation, params = {}, timeoutMs } = {}) {
  const target = String(appId || '').trim();
  const toolOperation = String(operation || '').trim();
  if (!target) throw new Error('Campo "appId" é obrigatório');
  if (!ANDROID_TOOL_OPERATIONS.has(toolOperation)) throw new Error('Tool Android não permitida');
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('"params" deve ser um objeto');
  const requestId = randomUUID();
  const wait = Math.min(Math.max(Number(timeoutMs) || ANDROID_REQUEST_TIMEOUT_MS, 1_000), ANDROID_REQUEST_TIMEOUT_MS);
  return new Promise((resolveRequest, reject) => {
    const timer = setTimeout(() => {
      if (clearAndroidRequest(requestId)) reject(new Error('O APK não respondeu à tool Android a tempo'));
    }, wait);
    androidRequests.set(requestId, { appId: target, timer, resolve: resolveRequest, kind: 'tools' });
    if (!sendTo(target, { type: 'event', event: 'android:tools.request', payload: { requestId, operation: toolOperation, params } })) {
      clearAndroidRequest(requestId);
      reject(new Error('O APK solicitado não está conectado ao Cloud'));
    }
  });
}

function resolveAndroidRequest(appId, payload, kind = 'bridge') {
  const requestId = String(payload?.requestId || '');
  const pending = androidRequests.get(requestId);
  if (!pending || pending.appId !== appId || pending.kind && pending.kind !== kind) return false;
  clearAndroidRequest(requestId);
  pending.resolve({
    success: payload.ok === true,
    action: payload.action || payload.operation || null,
    result: payload.result ?? null,
    error: payload.ok === true ? null : String(payload.error || 'A bridge Android recusou a ação'),
  });
  return true;
}

// Inferência fica no aparelho: o Cloud só encaminha um corpo OpenAI já
// sanitizado pelo Agent. Não há URL loopback, token local ou peso exposto.
export function requestMobileLlm({ appId, action = 'chat', payload = {}, timeoutMs = 120_000 } = {}) {
  const target = String(appId || '').trim()
  if (!target) throw new Error('Campo "appId" é obrigatório')
  if (!['models', 'chat'].includes(action)) throw new Error('Ação LLM móvel não permitida')
  const requestId = randomUUID()
  const wait = Math.min(Math.max(Number(timeoutMs) || 120_000, 1_000), 120_000)
  return new Promise((resolveRequest, reject) => {
    const timer = setTimeout(() => {
      if (mobileLlmRequests.delete(requestId)) reject(new Error('O aparelho não respondeu à inferência local a tempo'))
    }, wait)
    mobileLlmRequests.set(requestId, { appId: target, resolve: resolveRequest, reject, timer })
    if (!sendTo(target, { type: 'event', event: 'mobile:llm.request', payload: { requestId, action, payload } })) {
      clearTimeout(timer); mobileLlmRequests.delete(requestId)
      reject(new Error('O aparelho solicitado não está conectado ao Cloud'))
    }
  })
}

function resolveMobileLlmRequest(appId, payload) {
  const requestId = String(payload?.requestId || '')
  const pending = mobileLlmRequests.get(requestId)
  if (!pending || pending.appId !== appId) return false
  clearTimeout(pending.timer); mobileLlmRequests.delete(requestId)
  if (payload.ok === true) pending.resolve(payload.result)
  else pending.reject(new Error(String(payload.error || 'O aparelho recusou a inferência local')))
  return true
}

export async function listMobileLlmModels() {
  const devices = connectedDevices()
  const results = await Promise.all(devices.map(async appId => {
    try { return { appId, models: (await requestMobileLlm({ appId, action: 'models', timeoutMs: 8_000 }))?.data ?? [] } }
    catch { return { appId, models: [] } }
  }))
  return results.filter(item => item.models.length)
}

export async function onDeviceEmit(payload) {
  /**
   * @register_hook device:emit
   * @description Encaminha um evento do barramento para os aparelhos conectados (dado para o app reagir, não notificação na tela).
   * @param {object} payload - Dados
   * @param {string} payload.event - Nome do evento a entregar
   * @param {object?} payload.payload - Corpo do evento
   * @param {string?} payload.appId - Aparelho alvo. Omitido, vai para todos os conectados.
   */
  try {
    emitToDevice(payload || {});
  } catch (err) {
    console.warn(`[hermes] device:emit: ${err.message}`);
  }
  return payload;
}

// ── Frames vindos do aparelho ───────────────────────────────────────────

/**
 * Trata um frame do device. Exportada separada do handler de socket para ser
 * testável sem abrir conexão: recebe um `ws` qualquer com `send`/`readyState`.
 */
export async function handleFrame(ws, raw) {
  const parsed = parseDeviceFrame(raw || {});
  if (!parsed.ok) {
    ws.send(JSON.stringify({ channel: CHANNEL, type: 'error', error: parsed.error }));
    return { ok: false, error: parsed.error };
  }

  const frame = parsed.frame;

  if (frame.action === 'auth') {
    const device = store.authenticate(frame.appId, frame.token);
    if (!device) {
      ws.send(JSON.stringify({ channel: CHANNEL, type: 'auth', ok: false }));
      return { ok: false, error: 'credenciais inválidas' };
    }
    bind(frame.appId, ws);
    ws.send(JSON.stringify({ channel: CHANNEL, type: 'auth', ok: true, appId: frame.appId }));

    // Descarrega o que chegou enquanto o aparelho estava fora.
    const pending = store.drain(frame.appId);
    for (const message of pending) sendTo(frame.appId, message);
    return { ok: true, authed: true, flushed: pending.length };
  }

  // Daqui pra baixo, só socket autenticado.
  const appId = ws._hermesAppId;
  if (!appId) {
    ws.send(JSON.stringify({ channel: CHANNEL, type: 'error', error: 'socket não autenticado' }));
    return { ok: false, error: 'socket não autenticado' };
  }

  switch (frame.action) {
    case 'ping':
      ws.send(JSON.stringify({ channel: CHANNEL, type: 'pong', at: Date.now() }));
      return { ok: true };

    case 'ack': {
      const ack = store.ack(appId, frame.id);
      return { ok: true, ack };
    }

    case 'respond': {
      await respondFromDevice(appId, frame);
      ws.send(JSON.stringify({ channel: CHANNEL, type: 'responded', id: frame.id }));
      return { ok: true };
    }

    case 'event': {
      await emitFromDevice(appId, frame.event, frame.payload);
      return { ok: true };
    }

    default:
      return { ok: false, error: `ação "${frame.action}" sem tratamento` };
  }
}

export function releaseSocket(ws) {
  unbind(ws);
}

// ── Ações do aparelho, independentes do socket ──────────────────────────
//
// O toque numa ação de notificação no Android roda em OUTRO isolate, que não
// enxerga o socket aberto pelo foreground service. Por isso a ação é
// expressa aqui e alcançável tanto pelo frame do socket quanto por HTTP: o
// aparelho responde de onde conseguir, inclusive com a conexão caída.

/** A resposta sai no barramento; quem fez a pergunta escuta e decide. */
export async function respondFromDevice(appId, { id, response, value } = {}) {
  await safeDispatch('device:response', { appId, id, action: response, value: value ?? null });
  return { success: true, id };
}

export async function emitFromDevice(appId, event, payload = {}) {
  if (event === 'device:android.bridge.result') resolveAndroidRequest(appId, payload);
  if (event === 'device:android.tools.result') resolveAndroidRequest(appId, payload, 'tools');
  if (event === 'device:mobile.llm.result') resolveMobileLlmRequest(appId, payload);
  await safeDispatch(event, { ...payload, appId });
  return { success: true, event };
}

// ── Tools ───────────────────────────────────────────────────────────────

export function listDevices() {
  /**
   * @register_tool listDevices
   * @description Lista aparelhos pareados com diagnóstico de notificação por device: online, fila, preferência, última entrega e push configurado. Nunca expõe tokens.
   */
  const online = new Set(connectedDevices());
  return store.list().map(d => ({ ...d, online: online.has(d.appId) }));
}

export function notifyDevice(input) {
  /**
   * @register_tool notifyDevice
   * @description Envia uma notificação para os aparelhos pareados pelo link nativo do runtime (sem depender de ntfy.sh).
   * @param {object} input - Dados da notificação
   * @param {string} input.message - Corpo da mensagem (obrigatório)
   * @param {string?} input.title - Título (padrão: "ThinkIac")
   * @param {string?} input.click - URL de deep-link ao tocar na notificação
   * @param {string?} input.appId - Aparelho alvo. Omitido, envia para todos.
   * @param {string?} input.discreteId - Notificação própria deduplicada por este id
   * @param {number?} input.hold - Segundos que a notificação persistente mostra o texto (quando não há discreteId)
   * @param {string?} input.interaction - "confirm" ou "prompt" para pedir resposta (chega em `device:response`)
   */
  return deliver(input || {});
}

export function unpairDevice(input) {
  /**
   * @register_tool unpairDevice
   * @description Remove o pareamento de um aparelho: o token deixa de valer e ele para de receber o stream.
   * @param {object} input - Dados
   * @param {string} input.appId - appId do aparelho
   */
  const appId = input?.appId;
  if (!appId) throw new Error('Campo "appId" é obrigatório');
  const set = links.get(appId);
  if (set) {
    for (const ws of set) { try { ws.close(); } catch { /* já fechado */ } }
    links.delete(appId);
  }
  return { success: store.remove(appId), appId };
}

export async function android_cloud_bridge(input = {}) {
  /** @register_tool android_cloud_bridge
   * @description Executa uma ação Android permitida pelo app Flutter pareado e conectado ao Cloud. A ponte sai do aparelho por WebSocket autenticado; nunca expõe ADB, IP local ou credenciais.
   * @param {string} appId - ID do app Flutter pareado, obtido em listDevices
   * @param {string} action - status, activate, stop, capabilities, foreground, packages, battery, identity, ui-tree, screen-state, prepare, tap, swipe, key, text, open-app ou app-info
   * @param {object?} params - Parâmetros estritos aceitos pela ação Android
   */
  return requestAndroidBridge(input);
}
