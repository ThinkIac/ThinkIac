import { remember } from './lib/graph.js';

export async function onPresencePreference(payload) {
  /** @register_hook presence:preference */
  if (payload?.schemaVersion !== 1 || payload.source !== 'explicit_configuration') return payload;
  const { timezone, quietStart, quietEnd } = payload;
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
    if (![quietStart, quietEnd].every(x => Number.isInteger(x) && x >= 0 && x <= 23)) return payload;
    await remember({ content: `Preferência explícita da instalação Presence: silêncio de ${quietStart}h a ${quietEnd}h, timezone ${timezone}.`, entity: 'presence:installation', type: 'preference', sessionId: 'presence:personal', source: 'explicit' });
  } catch { /* memory is optional; local preference remains durable */ }
  return payload;
}
