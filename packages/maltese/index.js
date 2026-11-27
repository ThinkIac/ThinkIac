import { assertSurface } from '../ui-schema/index.js';
import { getMalteseSession, setMalteseSession, getMalteseDefaults, setMalteseDefaults } from './lib/session.js';

const sessionAction = 'maltese.save-session';
const defaultsAction = 'maltese.save-defaults';
const SESSION = {
  version: 1,
  kind: 'maltese-session',
  title: 'Privacidade Maltese',
  description: 'Proteja os dados detectados antes de enviar mensagens ao provedor.',
  forms: { settings: { fields: [{ name: 'enabled', component: 'toggle' }, { name: 'mode', component: 'select' }] } },
  submitAction: sessionAction,
  actions: { [sessionAction]: { intent: 'write' } },
};
const DEFAULTS = {
  ...SESSION,
  kind: 'maltese-defaults',
  description: 'O padrão vale para sessões novas e para as que ainda herdam as preferências globais.',
  submitAction: defaultsAction,
  actions: { [defaultsAction]: { intent: 'write' } },
};

const validSessionId = id => typeof id === 'string' && id.length > 0 && !/[/\\\0]/.test(id);

export function systemView(req) {
  /** @register_router system/view
   * @method GET */
  const defaults = req.query?.tab === 'maltese:defaults';
  const id = req.query?.session_id || 'default';
  if (!defaults && !validSessionId(id)) return { status: 400, mensagem: 'Sessão inválida.' };
  return {
    status: 200,
    surface: assertSurface(defaults ? DEFAULTS : SESSION),
    state: defaults ? getMalteseDefaults() : getMalteseSession(id),
  };
}

export function systemAction(req) {
  /** @register_router system/action
   * @method POST */
  const { action, values = {} } = req.body || {};
  if (action !== defaultsAction && action !== sessionAction) {
    return { status: 404, mensagem: 'Ação Maltese não permitida.' };
  }
  if (!values || typeof values !== 'object' || Array.isArray(values)
    || (values.enabled !== undefined && typeof values.enabled !== 'boolean')
    || (values.mode !== undefined && !['anon', 'pseudo'].includes(values.mode))) {
    return { status: 400, mensagem: 'Informe a ativação e o nível de ofuscação.' };
  }
  if (action === defaultsAction) {
    return { status: 200, state: setMalteseDefaults(values), notice: 'Padrão global atualizado.' };
  }
  const id = req.query?.session_id || req.body.session_id || 'default';
  if (!validSessionId(id)) {
    return { status: 400, mensagem: 'Sessão inválida.' };
  }
  return { status: 200, state: setMalteseSession(id, values), notice: 'Privacidade da sessão atualizada.' };
}
