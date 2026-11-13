// hermes/message.js — contrato de mensagem do link runtime ↔ device.
//
// Por que isto não se parece com o ntfy: o protocolo ntfy só devolve ao
// cliente title/message/tags/click/id, então todo metadado precisava viajar
// codificado dentro de `tags` (`notify_id:<id>`, `hold:<seg>`, `ui:confirm`).
// O canal aqui é nosso, então o metadado é campo de verdade — `display` e
// `interaction` são objetos, não convenções de string que cada cliente
// precisa reimplementar e manter em sincronia.

import { randomUUID } from 'crypto';

export const MAX_TITLE = 240;
export const MAX_MESSAGE = 4000;
export const MAX_CLICK = 2048;

// Espelha o padrão do app (main.dart): quanto tempo a notificação principal
// mostra o texto recebido antes de voltar a rotacionar as frases genéricas.
export const DEFAULT_HOLD_SEC = 60;

const INTERACTIONS = ['confirm', 'prompt'];

// O device só pode disparar eventos no seu próprio namespace. Sem isto, um
// aparelho pareado poderia emitir `auth:check` ou `reload:*` e mexer no
// runtime inteiro a partir de um celular perdido no bolso de alguém.
export const DEVICE_EVENT_NS = 'device:';

function clamp(value, max, fallback = '') {
  const text = value == null ? fallback : String(value);
  return text.slice(0, max);
}

/**
 * `display` decide como o aparelho mostra a mensagem:
 *  - discrete  → notificação própria, deduplicada por `key` (mensagens novas
 *                com a mesma key atualizam a mesma notificação);
 *  - principal → só atualiza por `holdSec` o texto da notificação persistente
 *                do foreground service, sem criar notificação nova.
 * São mutuamente exclusivos: uma mensagem é uma coisa ou a outra.
 */
export function normaliseDisplay({ discreteId, hold } = {}) {
  if (discreteId != null && String(discreteId).trim()) {
    return { mode: 'discrete', key: String(discreteId).slice(0, 128) };
  }
  const sec = Number(hold);
  return {
    mode: 'principal',
    holdSec: Number.isFinite(sec) && sec > 0 ? Math.min(Math.floor(sec), 3600) : DEFAULT_HOLD_SEC,
  };
}

export function normaliseInteraction(interaction) {
  if (!interaction) return null;
  const type = typeof interaction === 'string' ? interaction : interaction.type;
  return INTERACTIONS.includes(type) ? { type } : null;
}

/** Monta a mensagem que vai no socket. `id` é o que o device usa pra dar ack. */
export function normaliseMessage(input = {}, now = Date.now()) {
  const message = clamp(input.message ?? input.body, MAX_MESSAGE);
  if (!message.trim()) throw new Error('Campo "message" é obrigatório');

  const display = normaliseDisplay(input);
  const interaction = normaliseInteraction(input.interaction);

  return {
    type: 'notify',
    // `id` identifica a entrega/interação; `display.key` identifica somente o
    // cartão Android que será atualizado. Separar os dois impede que uma
    // resposta antiga seja reaproveitada depois que o cartão mudou de turno.
    id: input.id ? String(input.id).slice(0, 128) : randomUUID(),
    sentAt: now,
    title: clamp(input.title, MAX_TITLE, 'ThinkIac'),
    message,
    click: input.click ? clamp(input.click, MAX_CLICK) : null,
    priority: Number(input.priority) || 3,
    tags: Array.isArray(input.tags)
      ? input.tags.map(String).slice(0, 16)
      : String(input.tags || '').split(',').map(t => t.trim()).filter(Boolean).slice(0, 16),
    display,
    // Uma pergunta que some sozinha perde a resposta — por isso interação e
    // prazo de tela não convivem.
    interaction,
    context: input.context && typeof input.context === 'object'
      ? { ...input.context }
      : null,
  };
}

/**
 * Valida um frame vindo do device. Devolve `{ ok, frame }` ou `{ ok:false,
 * error }` — nada aqui confia no cliente, é a borda do sistema.
 */
export function parseDeviceFrame(raw = {}) {
  const action = String(raw.action || '').trim();
  if (!action) return { ok: false, error: 'frame sem "action"' };

  switch (action) {
    case 'auth': {
      const appId = String(raw.appId || '').trim();
      const token = String(raw.token || '').trim();
      if (!appId || !token) return { ok: false, error: 'auth exige appId e token' };
      return { ok: true, frame: { action, appId, token } };
    }

    case 'ack': {
      const id = String(raw.id || '').trim();
      if (!id) return { ok: false, error: 'ack exige id' };
      return { ok: true, frame: { action, id } };
    }

    case 'ping':
      return { ok: true, frame: { action } };

    case 'respond': {
      const id = String(raw.id || '').trim();
      const response = String(raw.response || '').trim();
      if (!id) return { ok: false, error: 'respond exige id' };
      if (!['confirm', 'cancel', 'submit'].includes(response)) {
        return { ok: false, error: `resposta "${response}" inválida` };
      }
      const value = response === 'submit' ? clamp(raw.value, MAX_MESSAGE) : null;
      if (response === 'submit' && !value.trim()) {
        return { ok: false, error: 'submit exige value' };
      }
      return { ok: true, frame: { action, id, response, value } };
    }

    case 'event': {
      const event = String(raw.event || '').trim();
      if (!event.startsWith(DEVICE_EVENT_NS)) {
        return { ok: false, error: `device só emite eventos "${DEVICE_EVENT_NS}*"` };
      }
      const payload = (raw.payload && typeof raw.payload === 'object') ? raw.payload : {};
      return { ok: true, frame: { action, event, payload } };
    }

    default:
      return { ok: false, error: `ação "${action}" desconhecida` };
  }
}
