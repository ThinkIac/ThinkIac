export function resolveSlot(apps, slotName) {
  const winners = new Map()
  for (const app of Array.isArray(apps) ? apps : []) {
    for (const contribution of Array.isArray(app?.slots) ? app.slots : []) {
      if (contribution.slot !== slotName || !contribution.id) continue
      const previous = winners.get(contribution.id)
      winners.set(contribution.id, previous
        ? { ...contribution, overrides: previous.packageName }
        : contribution)
    }
  }
  return [...winners.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}
