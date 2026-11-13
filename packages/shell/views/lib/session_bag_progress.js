function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function hasBagSteps(bag) {
  const total = finiteNumber(bag?.totalSteps)
  return total !== null && total > 0
}

export function bagProgress(bag) {
  if (!bag) return 0

  const explicit = finiteNumber(bag.progress)
  if (explicit !== null) return clampPercent(explicit)

  const total = finiteNumber(bag.totalSteps)
  const done = finiteNumber(bag.doneSteps)
  if (total === null || total <= 0 || done === null) return 0

  return clampPercent((done / total) * 100)
}

export function bagStatus(status) {
  switch (status) {
    case 'in_progress': return { key: 'active', label: 'active' }
    case 'done': return { key: 'complete', label: 'complete' }
    case 'paused': return { key: 'paused', label: 'paused' }
    case 'failed': return { key: 'failed', label: 'failed' }
    default: return { key: 'idle', label: 'idle' }
  }
}
