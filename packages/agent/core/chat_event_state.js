import { randomUUID } from 'crypto'

export const MAX_BUFFER_SIZE = 500

function lastCommitIndex(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].event === 'commit') return i
  }
  return -1
}

export function createChatEventState({ createEpoch = randomUUID, maxSize = MAX_BUFFER_SIZE } = {}) {
  const cycles = new Map()

  function begin(sessionId) {
    const cycle = { epoch: createEpoch(), seq: 0, events: [], terminal: false }
    cycles.set(sessionId, cycle)
    return cycle.epoch
  }

  function current(sessionId) {
    return cycles.get(sessionId) || null
  }

  function push(sessionId, event, data) {
    const cycle = current(sessionId) || (begin(sessionId), current(sessionId))
    if (cycle.terminal) return null
    const item = { event, data, id: ++cycle.seq, epoch: cycle.epoch }
    cycle.events.push(item)
    if (event === 'done' || event === 'error' || event === 'timeout') cycle.terminal = true

    if (cycle.events.length > maxSize) {
      const excess = cycle.events.length - maxSize
      const commitIndex = lastCommitIndex(cycle.events)
      const cut = commitIndex >= 0 ? Math.min(excess, commitIndex + 1) : 0
      if (cut > 0) cycle.events.splice(0, cut)
    }
    return item
  }

  function replay(sessionId, cursor = {}) {
    const cycle = current(sessionId)
    if (!cycle) return { epoch: null, events: [], cursorMismatch: Boolean(cursor?.epoch) }
    const sameEpoch = cursor?.epoch === cycle.epoch
    if (sameEpoch && cursor.seq != null) {
      return {
        epoch: cycle.epoch,
        events: cycle.events.filter(item => item.id > Number(cursor.seq)),
        cursorMismatch: false,
      }
    }
    const commitIndex = lastCommitIndex(cycle.events)
    return {
      epoch: cycle.epoch,
      events: commitIndex >= 0 ? cycle.events.slice(commitIndex + 1) : cycle.events.slice(),
      cursorMismatch: Boolean(cursor?.epoch && cursor.epoch !== cycle.epoch),
    }
  }

  function remove(sessionId, epoch = null) {
    const cycle = current(sessionId)
    if (cycle && (!epoch || cycle.epoch === epoch)) cycles.delete(sessionId)
  }

  return { begin, current, push, replay, remove }
}
