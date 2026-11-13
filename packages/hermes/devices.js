// hermes/devices.js — registro de devices e fila de entrega.
//
// Puro e sem I/O de rede: recebe o caminho do arquivo e devolve um store.
// Toda a política de pareamento, expiração e enfileiramento vive aqui para
// poder ser testada sem subir o runtime nem abrir socket.

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { randomBytes, timingSafeEqual } from 'crypto';

// Um device parado por mais de 30 dias deixa de existir: o token some junto,
// então um aparelho trocado/formatado não fica com acesso vitalício ao stream.
export const DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Mensagens que chegaram com o device offline esperam por até 24h. Passado
// isso, entregar deixa de ser útil e vira ruído ("sua build terminou" 3 dias
// depois não é notificação, é lixo).
export const OUTBOX_TTL_MS = 24 * 60 * 60 * 1000;

// Teto por device. Um device que passa semanas offline não pode fazer o
// arquivo crescer sem limite; ao estourar, as mais antigas caem primeiro.
export const OUTBOX_MAX = 200;
const PUSH_TOKEN_MAX = 4096;
const PUSH_PROVIDERS = new Set(['fcm', 'apns']);

/** appId gerado no device: 32 chars do alfabeto que o cliente usa. */
const APP_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

export function isValidAppId(appId) {
  return typeof appId === 'string' && APP_ID_RE.test(appId);
}

export function generateToken() {
  return randomBytes(32).toString('base64url');
}

/**
 * Comparação em tempo constante. `timingSafeEqual` exige buffers do mesmo
 * tamanho, então o comprimento é conferido antes — o comprimento do token é
 * fixo e público, não é ele que precisa ser escondido.
 */
export function tokenMatches(expected, given) {
  if (typeof expected !== 'string' || typeof given !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function pruneDevices(devices, now = Date.now()) {
  return (Array.isArray(devices) ? devices : []).filter(d =>
    d && isValidAppId(d.appId) && Number.isFinite(d.lastSeenAt) && now - d.lastSeenAt < DEVICE_TTL_MS,
  );
}

export function pruneOutbox(outbox, now = Date.now()) {
  const fresh = (Array.isArray(outbox) ? outbox : []).filter(m =>
    m && Number.isFinite(m.sentAt) && now - m.sentAt < OUTBOX_TTL_MS,
  );
  // Mantém as mais NOVAS ao estourar o teto: uma fila cheia de mensagens
  // velhas não deve impedir a chegada da mensagem de agora.
  return fresh.slice(-OUTBOX_MAX);
}

export function createDeviceStore(file) {
  function read() {
    try {
      if (!existsSync(file)) return [];
      return pruneDevices(JSON.parse(readFileSync(file, 'utf8')));
    } catch {
      return [];
    }
  }

  function write(devices) {
    writeFileSync(file, JSON.stringify(pruneDevices(devices), null, 2), 'utf8');
  }

  function find(devices, appId) {
    return devices.find(d => d.appId === appId) || null;
  }

  function publicDevice(device) {
    const { token, outbox, push, ...rest } = device;
    return {
      ...rest,
      notificationsEnabled: device.notificationsEnabled !== false,
      pushConfigured: Boolean(push?.token),
      queued: (outbox || []).length,
    };
  }

  return {
    list() {
      // Nunca devolve o token: esta lista alimenta a UI de "meus aparelhos".
      return read().map(publicDevice);
    },

    /**
     * Pareamento TOFU (trust on first use): o primeiro registro de um appId
     * cria o device e cunha o token. Um registro posterior para o mesmo appId
     * só é aceito apresentando o token vigente — senão qualquer um que
     * descobrisse o appId sequestraria o stream pedindo um token novo.
     */
    register({ appId, name, token: given } = {}, now = Date.now()) {
      if (!isValidAppId(appId)) throw new Error('appId inválido');

      const devices = read();
      const existing = find(devices, appId);

      if (existing) {
        if (!tokenMatches(existing.token, given)) {
          const err = new Error('Device já registrado — apresente o token vigente para renovar');
          err.status = 409;
          throw err;
        }
        existing.name = String(name || existing.name || 'device').slice(0, 80);
        existing.lastSeenAt = now;
        write(devices);
        return { appId, token: existing.token, name: existing.name, created: false };
      }

      const device = {
        appId,
        token: generateToken(),
        name: String(name || 'device').slice(0, 80),
        createdAt: now,
        lastSeenAt: now,
        notificationsEnabled: true,
        outbox: [],
      };
      devices.push(device);
      write(devices);
      return { appId, token: device.token, name: device.name, created: true };
    },

    /** Valida o par (appId, token) da handshake do socket. */
    authenticate(appId, token, now = Date.now()) {
      const devices = read();
      const device = find(devices, appId);
      if (!device || !tokenMatches(device.token, token)) return null;
      device.lastSeenAt = now;
      write(devices);
      const { token: _t, outbox, ...safe } = device;
      return safe;
    },

    remove(appId) {
      const devices = read();
      const next = devices.filter(d => d.appId !== appId);
      if (next.length === devices.length) return false;
      write(next);
      return true;
    },

    /**
     * Preferência por aparelho. O token de push é segredo operacional: ele é
     * persistido para o futuro transportador FCM/APNs, mas nunca sai na lista
     * de diagnóstico nem em qualquer endpoint de leitura.
     */
    updateNotifications(appId, { enabled, push } = {}, now = Date.now()) {
      const devices = read();
      const device = find(devices, appId);
      if (!device) return null;

      if (enabled != null) device.notificationsEnabled = Boolean(enabled);
      if (push != null) {
        const provider = String(push.provider || '').toLowerCase();
        const token = String(push.token || '').trim();
        if (!PUSH_PROVIDERS.has(provider)) throw new Error('Provider de push inválido');
        if (!token || token.length > PUSH_TOKEN_MAX) throw new Error('Token de push inválido');
        device.push = { provider, token, updatedAt: now };
      }
      device.lastSeenAt = now;
      write(devices);
      return publicDevice(device);
    },

    recordDelivery(appId, delivery, now = Date.now()) {
      const devices = read();
      const device = find(devices, appId);
      if (!device) return null;
      device.lastDelivery = { ...delivery, at: now };
      write(devices);
      return publicDevice(device);
    },

    /**
     * Guarda uma mensagem que não pôde ser entregue agora. Diferente do ntfy
     * (onde o cliente assina com `since=<agora>` e perde tudo que passou com
     * o socket caído), aqui o que chegou offline espera o device voltar.
     */
    enqueue(appId, message, now = Date.now()) {
      const devices = read();
      const device = find(devices, appId);
      if (!device) return false;
      device.outbox = pruneOutbox([...(device.outbox || []), message], now);
      write(devices);
      return true;
    },

    /** Devolve e limpa a fila — chamado quando o device autentica. */
    drain(appId, now = Date.now()) {
      const devices = read();
      const device = find(devices, appId);
      if (!device) return [];
      const pending = pruneOutbox(device.outbox || [], now);
      device.outbox = [];
      device.lastSeenAt = now;
      write(devices);
      return pending;
    },

    /** Marca a entrega confirmada pelo device e devolve o RTT em ms. */
    ack(appId, messageId, now = Date.now()) {
      const devices = read();
      const device = find(devices, appId);
      if (!device) return null;
      device.lastSeenAt = now;
      const sentAt = device.lastDelivery?.id === messageId
        ? Number(device.lastDelivery.at)
        : NaN;
      device.lastAck = {
        id: messageId,
        at: now,
        latencyMs: Number.isFinite(sentAt) ? Math.max(0, now - sentAt) : null,
      };
      write(devices);
      return device.lastAck;
    },
  };
}
