

import { randomUUID } from 'node:crypto'
import { broadcastMessage } from '../host/agent_host.js'

const activities = new Map()
const TERMINAL = new Set(['success', 'error', 'cancelled'])
export const TERMINAL_TTL_MS = 8_000
const expiryTimers = new Map()

function publish(activity) {
  try { broadcastMessage({ type: 'bus:event', event: 'agent:activity', detail: activity }) } catch {}
}

function clean(activity) {
  const { result, error, ...safe } = activity
  return { ...safe, resultPreview: result ? String(result).replace(/\s+/g, ' ').slice(0, 180) : null, error: error ?? null }
}

export function openActivity(input = {}) {
  if (!input.ownerSessionId || !input.title) throw new Error('Activity exige ownerSessionId e title.')
  const now = new Date().toISOString()
  const activity = {
    id: input.id || `activity:${randomUUID()}`,
    contributor: input.contributor || 'agent',
    kind: input.kind || 'process',
    ownerSessionId: input.ownerSessionId,
    targetSessionId: input.targetSessionId || null,
    groupId: input.groupId || null,
    title: String(input.title).slice(0, 120),
    summary: input.summary ? String(input.summary).slice(0, 180) : null,
    state: input.state || 'running',
    progress: input.progress || null,
    attention: input.attention || 'passive',
    capabilities: Array.isArray(input.capabilities) ? input.capabilities : ['open'],
    createdAt: now,
    updatedAt: now,
  }
  activities.set(activity.id, activity)
  publish(clean(activity))
  return clean(activity)
}

export function updateActivity(id, patch = {}) {
  const current = activities.get(id)
  if (!current) return null
  const next = { ...current, ...patch, id: current.id, ownerSessionId: current.ownerSessionId, updatedAt: new Date().toISOString() }
  if (TERMINAL.has(next.state)) next.finishedAt ||= next.updatedAt
  activities.set(id, next)
  publish(clean(next))
  clearTimeout(expiryTimers.get(id))
  expiryTimers.delete(id)
  if (TERMINAL.has(next.state)) {
    const timer = setTimeout(() => {
      const latest = activities.get(id)
      if (!latest || !TERMINAL.has(latest.state)) return
      activities.delete(id)
      expiryTimers.delete(id)
      publish({ ...clean(latest), removed: true })
    }, TERMINAL_TTL_MS)
    timer.unref?.()
    expiryTimers.set(id, timer)
  }
  return clean(next)
}

export function listActivities(sessionId) {
  const now = Date.now()
  for (const [id, item] of activities) {
    if (TERMINAL.has(item.state) && now - Date.parse(item.finishedAt || item.updatedAt) > TERMINAL_TTL_MS) activities.delete(id)
  }
  return [...activities.values()]
    .filter((item) => item.ownerSessionId === sessionId || item.observerSessionIds?.includes(sessionId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(clean)
}
