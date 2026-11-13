

import { writable } from 'svelte/store'
import { api } from '../api.js'

export const composerContributors = writable([])

export async function bootstrapComposerSlots() {
  const apps = await api('/apps/list', 'GET', null, 'aura-system')
  if (!Array.isArray(apps)) return
  composerContributors.set(apps.flatMap((app) => {
    const slot = app?.composerSlot
    if (!slot?.id) return []
    return [{ id: `pkg:${slot.id}`, packageName: app.packageName, label: slot.label || app.name || slot.id, order: Number(slot.order) || 0, kind: slot.kind || 'activity' }]
  }).sort((a, b) => a.order - b.order))
}
