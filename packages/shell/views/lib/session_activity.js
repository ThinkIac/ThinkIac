// Estado efêmero das conversas. Os dois widgets consomem os mesmos mapas
// mantidos pelo Shell: não existe uma segunda fonte de verdade no histórico.
export function isSessionWorking(sessionId, loadingMap = {}) {
  return Boolean(loadingMap?.[sessionId]);
}

export function hasSessionUpdate(sessionId, unreadMap = {}) {
  return Boolean(unreadMap?.[sessionId]);
}

export function hasSessionActivity(sessionId, loadingMap = {}, unreadMap = {}) {
  return isSessionWorking(sessionId, loadingMap)
    || hasSessionUpdate(sessionId, unreadMap);
}
