import { assertSurface } from '../../ui-schema/index.js'
import { getSessionSettings, saveSessionSettings } from '../core/session_settings.js'

const SYSTEM_SURFACE = Object.freeze({
  version: 1,
  kind: 'session-preferences',
  eyebrow: 'Agent runtime',
  title: 'Sessões',
  description: 'Defina como novas conversas recebem identificação, modelo e título.',
  forms: {
    preferences: { fields: [
      { name: 'idPrefix', component: 'input' },
      { name: 'defaultModel', component: 'select' },
      { name: 'enabled', component: 'toggle' },
      { name: 'model', component: 'select' },
      { name: 'every', component: 'input' },
    ] },
  },
  actions: { 'sessions.save-preferences': { intent: 'write' } },
})

export function systemView() {
  /** @register_router system/view @method GET */
  return { status: 200, surface: assertSurface(SYSTEM_SURFACE), state: getSessionSettings() }
}

export function systemAction(req) {
  /** @register_router system/action @method POST */
  if (String(req.body?.action || '') !== 'sessions.save-preferences') {
    return { status: 404, mensagem: 'Ação de System não permitida.' }
  }
  try {
    const values = req.body?.values && typeof req.body.values === 'object' ? req.body.values : {}
    return { status: 200, state: saveSessionSettings(values), notice: 'Preferências de sessões atualizadas.' }
  } catch (error) {
    return { status: 400, mensagem: error.message }
  }
}
