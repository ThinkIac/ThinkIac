'use strict';

// Declarações de descoberta vivem no manifesto do pacote, junto dos papéis.
// Não são uma segunda fonte de autorização: apontam para a mesma permission
// canônica que a rota ou a tool deve validar ao executar a operação.
const PERMISSION_RE = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*){1,}$/;
const VIEW_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
const TOOL_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

function requiredDiscoveryPermission(manifest, kind, name) {
  const packageName = String(manifest?.name || '');
  const validName = kind === 'views' ? VIEW_RE.test(String(name || '')) : TOOL_RE.test(String(name || ''));
  const candidate = manifest?.manifest?.access?.[kind]?.[name];
  if (!validName || typeof candidate !== 'string') return null;
  const permission = candidate.trim();
  // Um pacote não pode usar o seu manifesto para esconder um recurso atrás de
  // uma permission pertencente a outro pacote.
  return PERMISSION_RE.test(permission) && permission.startsWith(`${packageName}.`)
    ? permission
    : null;
}

function requiredViewPermission(manifest, viewName) {
  return requiredDiscoveryPermission(manifest, 'views', viewName);
}

function requiredToolPermission(manifest, toolName) {
  return requiredDiscoveryPermission(manifest, 'tools', toolName);
}

module.exports = { requiredDiscoveryPermission, requiredViewPermission, requiredToolPermission };
