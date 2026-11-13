import { writable } from 'svelte/store'
import { api } from '../api.js'

export const nativeMessageActions = Object.freeze([
  { id: 'native:copy', kind: 'copy', label: 'Copiar resposta', roles: ['assistant'], order: 10 },
  { id: 'native:speak', kind: 'audio', native: true, label: 'Ouvir no aparelho', roles: ['assistant'], order: 15 },
  { id: 'native:like', kind: 'like', label: 'Resposta útil', roles: ['assistant'], order: 20 },
  { id: 'native:dislike', kind: 'dislike', label: 'Esta resposta não ajudou', roles: ['assistant'], order: 30 },
])

export function normalizePackageActions(app) {
  const configs = Array.isArray(app?.messageActions) ? app.messageActions : []
  return configs.flatMap((config, index) => {
    const id = String(config?.id ?? '').trim()
    const packageName = String(app?.packageName ?? '').trim()
    if (!id || !packageName || config.kind !== 'audio') return []
    const endpoint = String(config.endpoint ?? 'speak').replace(/^\/+/, '')
    return [{
      id: `pkg:${packageName}:${id}`,
      packageName,
      label: String(config.label || id),
      kind: config.kind,
      endpoint: `/${packageName}/${endpoint}`,
      ...(config.fallbackEndpoint ? {
        fallbackEndpoint: `/${packageName}/${String(config.fallbackEndpoint).replace(/^\/+/, '')}`,
      } : {}),
      ...(config.streaming === true ? { streaming: true } : {}),
      order: Number.isFinite(config.order) ? config.order : 100 + index,
      roles: Array.isArray(config.roles) && config.roles.length ? config.roles : ['assistant'],
    }]
  })
}

export function orderMessageActions(actions) {
  return actions.map((action, index) => ({ action, index }))
    .sort((a, b) => (a.action.order ?? 100) - (b.action.order ?? 100) || a.index - b.index)
    .map(item => item.action)
}

export function listenSessionKey(sessionId) {
  return `agent:message-actions:listen:${String(sessionId || 'default')}`
}

export function shouldAutoSpeak({ listenEnabled = false, respondAudioWithAudio = false, previousInputWasAudio = false, isLatest = false } = {}) {
  return isLatest && (listenEnabled || (respondAudioWithAudio && previousInputWasAudio))
}

export const messageActions = writable(nativeMessageActions)

export async function bootstrapMessageActions() {
  let apps = []
  try { apps = await api('/apps/list', 'GET', null, 'aura-system') }
  catch (error) { console.error('[message-actions] falha ao listar apps:', error) }
  const discovered = (Array.isArray(apps) ? apps : []).flatMap(normalizePackageActions)
  const contributed = (await Promise.all(discovered.map(async action => {
    if (action.kind !== 'audio') return action
    try {
      const status = await api('/status', 'GET', null, action.packageName)
      return status?.ready ? { ...action, respondAudioWithAudio: status.settings?.respondAudioWithAudio === true } : null
    } catch { return null }
  }))).filter(Boolean)
  messageActions.set(orderMessageActions([...nativeMessageActions, ...contributed]))
}
