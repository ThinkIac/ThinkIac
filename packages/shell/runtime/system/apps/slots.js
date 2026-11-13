'use strict';

const SLOT_NAME = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/;
const CONTRIBUTION_ID = /^[a-z0-9][a-z0-9-]*$/;
const STATUS_ALIGNMENTS = new Set(['left', 'center', 'right']);
const STATUS_ACTIONS = new Set(['tab', 'modal', 'event']);

function normalizeManifestSlots(slots, packageName) {
  if (!slots || typeof slots !== 'object' || Array.isArray(slots)) return [];
  return Object.entries(slots).flatMap(([slot, raw]) => {
    const entries = Array.isArray(raw) ? raw : [raw];
    if (!SLOT_NAME.test(slot)) return [];
    return entries.flatMap((entry) => {
      if (!entry || typeof entry !== 'object' || !CONTRIBUTION_ID.test(String(entry.id || ''))) return [];
      return [{
        slot,
        id: String(entry.id),
        packageName,
        view: entry.view === false ? false : String(entry.view || 'Index'),
        label: entry.label ? String(entry.label) : String(entry.id),
        order: Number.isFinite(Number(entry.order)) ? Number(entry.order) : 0,
        contract: Number.isInteger(Number(entry.contract)) ? Number(entry.contract) : 1,
        ...(entry.href ? { href: String(entry.href) } : {}),
        ...(entry.accountsHref ? { accountsHref: String(entry.accountsHref) } : {}),
        ...(entry.permission ? { permission: String(entry.permission) } : {}),
        // Metadados visuais opcionais. O host decide quais campos entende.
        ...(entry.icon ? { icon: String(entry.icon) } : {}),
        ...(entry.iconDark ? { iconDark: String(entry.iconDark) } : {}),
        ...(entry.tooltip ? { tooltip: String(entry.tooltip).slice(0, 160) } : {}),
        ...(entry.badge != null ? { badge: String(entry.badge).slice(0, 12) } : {}),
        ...(STATUS_ALIGNMENTS.has(entry.align) ? { align: entry.align } : {}),
        // O destino é opt-in. Sem `action`, o comportamento histórico é abrir
        // a view em uma aba do Shell.
        ...(STATUS_ACTIONS.has(entry.action) ? { action: entry.action } : {}),
        ...(typeof entry.event === 'string' && entry.event.length <= 160
          ? { event: entry.event } : {}),
        ...(entry.detail != null && ['string', 'number', 'boolean', 'object'].includes(typeof entry.detail)
          ? { detail: entry.detail } : {}),
      }];
    });
  });
}

function resolveSlot(contributions, slot) {
  const winners = new Map();
  for (const contribution of contributions || []) {
    if (contribution?.slot !== slot || !contribution.id) continue;
    const previous = winners.get(contribution.id);
    winners.set(contribution.id, previous
      ? { ...contribution, overrides: previous.packageName }
      : contribution);
  }
  return [...winners.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

module.exports = { normalizeManifestSlots, resolveSlot };
