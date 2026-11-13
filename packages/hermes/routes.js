// hermes/routes.js — o socket do aparelho e o pareamento por HTTP.

import {
  store,
  handleFrame,
  releaseSocket,
  connectedDevices,
  respondFromDevice,
  emitFromDevice,
  CHANNEL,
} from './index.js';
import { parseDeviceFrame } from './message.js';

export async function router_link(ws, context, msg) {
  /**
   * @register_router link
   * @stream
   * @direction bidirectional
   * @channel hermes:link
   */
  if (!msg) return;

  // Um socket só precisa registrar a limpeza uma vez; sem isto o aparelho
  // continuaria "conectado" no mapa depois de perder a rede, e as mensagens
  // iriam para um socket morto em vez de irem para a fila.
  if (!ws._hermesBound) {
    ws._hermesBound = true;
    ws.on('close', () => releaseSocket(ws));
  }

  try {
    await handleFrame(ws, msg);
  } catch (err) {
    console.warn(`[hermes] frame: ${err.message}`);
    try {
      ws.send(JSON.stringify({ channel: CHANNEL, type: 'error', error: 'falha ao processar frame' }));
    } catch { /* socket já foi */ }
  }
}

// ── Pareamento ──────────────────────────────────────────────────────────

export function routerRegisterDevice(req, res) {
  /**
   * @register_router devices @method POST
   */
  const { appId, name, token } = req.body || {};

  try {
    const result = store.register({ appId, name, token });
    res.status(result.created ? 201 : 200);
    return result;
  } catch (err) {
    res.status(err.status || 400);
    return { error: err.message };
  }
}

export function routerListDevices() {
  /**
   * @register_router devices @method GET
   */
  const online = new Set(connectedDevices());
  return store.list().map(d => ({ ...d, online: online.has(d.appId) }));
}

export function routerRemoveDevice(req, res) {
  /**
   * @register_router devices/:appId @method DELETE
   */
  const appId = req.params?.appId;
  if (!store.remove(appId)) {
    res.status(404);
    return { error: 'Device não encontrado' };
  }
  return { success: true, appId };
}

export function routerUpdateDeviceNotifications(req, res) {
  /**
   * @register_router devices/:appId/notifications @method PUT
   */
  if (!autenticar(req, res)) return { error: 'credenciais inválidas' };

  try {
    const { enabled, push } = req.body || {};
    const device = store.updateNotifications(req.params.appId, { enabled, push });
    if (!device) {
      res.status(404);
      return { error: 'Device não encontrado' };
    }
    return { success: true, device };
  } catch (err) {
    res.status(400);
    return { error: err.message };
  }
}

// ── Ações do aparelho por HTTP ──────────────────────────────────────────
//
// Mesmo efeito dos frames do socket. Existe porque o isolate que trata o
// toque numa ação de notificação no Android não enxerga o socket aberto pelo
// foreground service — e porque responder precisa funcionar mesmo com a
// conexão caída.

/** Autentica o par (appId, token) do corpo; devolve null e já responde o erro. */
function autenticar(req, res) {
  const appId = req.params?.appId;
  const token = req.body?.token;
  const device = store.authenticate(appId, token);
  if (!device) {
    res.status(401);
    return null;
  }
  return device;
}

export async function routerDeviceRespond(req, res) {
  /**
   * @register_router devices/:appId/respond @method POST
   */
  if (!autenticar(req, res)) return { error: 'credenciais inválidas' };

  const parsed = parseDeviceFrame({ action: 'respond', ...(req.body || {}) });
  if (!parsed.ok) {
    res.status(400);
    return { error: parsed.error };
  }

  return respondFromDevice(req.params.appId, parsed.frame);
}

export async function routerDeviceEvent(req, res) {
  /**
   * @register_router devices/:appId/events @method POST
   */
  if (!autenticar(req, res)) return { error: 'credenciais inválidas' };

  const parsed = parseDeviceFrame({ action: 'event', ...(req.body || {}) });
  if (!parsed.ok) {
    res.status(400);
    return { error: parsed.error };
  }

  return emitFromDevice(req.params.appId, parsed.frame.event, parsed.frame.payload);
}

export function routerHealth() {
  /**
   * @register_router health @method GET
   */
  const devices = store.list();
  return {
    channel: CHANNEL,
    paired: devices.length,
    online: connectedDevices().length,
    queued: devices.reduce((sum, d) => sum + (d.queued || 0), 0),
  };
}
