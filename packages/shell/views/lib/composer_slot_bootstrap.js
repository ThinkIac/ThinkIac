// Descoberta declarativa do slot acima do composer. Igual a menu/inputbar:
// pacote declara manifest.composerSlot e o Harness só aceita metadados seguros.
import { writable } from 'svelte/store'
import { api } from '../api.js'

export const composerContributors = writable([])

export async function bootstrapComposerSlots() {
  const apps = await api('/apps/list', 'GET', null, 'shell')
  if (!Array.isArray(apps)) return
  composerContributors.set(apps.flatMap((app) => {
    const slot = app?.composerSlot
    if (!slot?.id) return []
    return [{ id: `pkg:${slot.id}`, packageName: app.packageName, label: slot.label || app.name || slot.id, order: Number(slot.order) || 0, kind: slot.kind || 'activity' }]
  }).sort((a, b) => a.order - b.order))
}
