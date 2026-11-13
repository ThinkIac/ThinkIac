import { api } from '../api.js'

const frames = new Map()

export async function bootstrapBackgroundViews() {
  let apps
  try { apps = await api('/apps/list', 'GET', null, 'shell') } catch { return }
  if (!Array.isArray(apps) || typeof document === 'undefined') return
  for (const app of apps) {
    if (!app?.background || !app.url || frames.has(app.url)) continue
    const frame = document.createElement('iframe')
    frame.src = app.url
    frame.title = `${app.name || app.packageName || 'Package'} background service`
    frame.hidden = true
    frame.setAttribute('aria-hidden', 'true')
    document.body.appendChild(frame)
    frames.set(app.url, frame)
  }
}

export function publishBackgroundContext(detail) {
  for (const frame of frames.values()) {
    frame.contentWindow?.postMessage({ source: 'aurora', type: 'shell:context', detail }, '*')
  }
}

export function disposeBackgroundViews() {
  for (const frame of frames.values()) frame.remove()
  frames.clear()
}
