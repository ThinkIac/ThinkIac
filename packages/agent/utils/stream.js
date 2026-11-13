import { pushToHostSession } from '../host/agent_host.js'

let _osCtx = null
async function _loadOsCtx() {
  if (_osCtx) return _osCtx
  try {
    const mod = await import('logos')
    _osCtx = { setOsContext: mod.setOsContext, getOsContext: mod.getOsContext }
  } catch { _osCtx = {} }
  return _osCtx
}

export function uiStream(ws, context, msg) {
  /**
   * @register_router ui/stream
   * @stream
   * @direction bidirectional
   * @channel ui.dom
   */

  const rawUrl = context?.url ?? context?.req?.url ?? '';
  const qIndex = rawUrl.indexOf('?');
  const params = qIndex !== -1 ? new URLSearchParams(rawUrl.slice(qIndex + 1)) : new URLSearchParams();

  const sessionId =
    params.get('session') ??
    context?.sessionId ??
    context?.query?.session ??
    context?.params?.session ??
    'default';

  if (!msg) return;

  switch (msg.type) {
    case 'dom_snapshot': {
      const { elements = [], focusedApp = null, openApps = [], viewport = {} } = msg.payload ?? {};
      const auraLabels = elements.filter(e => e.auraLabel).map(e => e.auraLabel);
      _loadOsCtx().then(({ setOsContext }) => {
        if (setOsContext) setOsContext(sessionId, {
          domSnapshot: elements,
          focusedApp,
          openApps,
          auraLabels,
          viewport,
          updatedAt: Date.now(),
        })
      }).catch(() => {})
      break;
    }

    case 'app_focus': {
      _loadOsCtx().then(({ setOsContext, getOsContext }) => {
        if (setOsContext && getOsContext) {
          const ctx = getOsContext(sessionId) ?? {}
          setOsContext(sessionId, {
            ...ctx,
            focusedApp: msg.payload?.appId ?? null,
            openApps:   msg.payload?.openApps ?? ctx.openApps ?? [],
            updatedAt: Date.now(),
          })
        }
      }).catch(() => {})
      break;
    }

    case 'action_result': {
      ws.send(JSON.stringify({ type: 'request_snapshot' }));
      break;
    }

    case 'interaction_answer': {
      ws.emit('interaction_answer', msg.payload);
      break;
    }
  }
}

export function pushStep(sessionId, step) {
  return pushToHostSession(sessionId, { type: 'automation_step', step });
}

export function pushChatToken(sessionId, token) {
  return pushToHostSession(sessionId, { type: 'chat_token', token });
}

export function pushAgentStatus(sessionId, status, message) {
  return pushToHostSession(sessionId, { type: 'agent_status', status, message });
}
