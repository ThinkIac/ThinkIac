import { evaluateGovernanceAction, getGovernancePolicy, listGovernanceDecisions, listGovernancePolicies, listPendingConfirmations, resolveGovernanceConfirmation, setGovernancePolicy } from './tools.js'
import { getConfirmationSettings, saveConfirmationSettings } from '../agent/core/session_settings.js'
import { assertSurface } from '../ui-schema/index.js'
import { getDefaultPolicy, setDefaultPolicy } from './lib/policy.js'

const SYSTEM_SURFACE = Object.freeze({
  version: 1,
  kind: 'governance-defaults',
  eyebrow: 'Agent runtime',
  title: 'Governance',
  description: 'Set the default policy for new sessions and how approval questions are written.',
  forms: {
    defaults: { fields: [
      { name: 'mode', component: 'select' }, { name: 'preset', component: 'select' },
      { name: 'prompt', component: 'textarea' }, { name: 'generateWithAI', component: 'toggle' },
      { name: 'model', component: 'select' },
    ] },
  },
  actions: { 'governance.save-defaults': { intent: 'write' } },
})

function systemState() {
  return { policy: getDefaultPolicy(), confirmation: getConfirmationSettings() }
}

export function routerEvaluate(req) { /** @register_router evaluate @method POST */ return evaluateGovernanceAction(req.body) }
export function routerResolve(req) { /** @register_router confirmations/resolve @method POST */ return resolveGovernanceConfirmation(req.body) }
export function routerPending(req) { /** @register_router confirmations/pending @method GET */ return listPendingConfirmations(req.query) }
export function routerDecisions(req) { /** @register_router decisions @method GET */ return listGovernanceDecisions(req.query) }
export function routerPolicyGet(req) { /** @register_router policy @method GET */ return req.query?.sessionId ? getGovernancePolicy(req.query) : listGovernancePolicies() }
export function routerPolicySet(req) { /** @register_router policy @method POST */ return setGovernancePolicy(req.body) }
export function routerConfirmationSettings() { /** @register_router confirmations/settings @method GET */ return { status: 200, data: getConfirmationSettings() } }
export function routerConfirmationSettingsSet(req) { /** @register_router confirmations/settings @method POST */
  try {
    return { status: 200, data: saveConfirmationSettings(req.body ?? {}), notice: 'Preferências de confirmação atualizadas.' }
  } catch (error) {
    return { status: 400, error: error.message }
  }
}

export function systemView() {
  /** @register_router system/view @method GET */
  return { status: 200, surface: assertSurface(SYSTEM_SURFACE), state: systemState() }
}

export function systemAction(req) {
  /** @register_router system/action @method POST */
  if (String(req.body?.action || '') !== 'governance.save-defaults') {
    return { status: 404, mensagem: 'Ação de System não permitida.' }
  }
  try {
    const values = req.body?.values && typeof req.body.values === 'object' ? req.body.values : {}
    setDefaultPolicy({ mode: values.mode, preset: values.preset, prompt: values.prompt })
    saveConfirmationSettings({ generateWithAI: values.generateWithAI === true, model: values.model || null })
    return { status: 200, state: systemState(), notice: 'Governance defaults updated.' }
  } catch (error) {
    return { status: 400, mensagem: error.message }
  }
}
