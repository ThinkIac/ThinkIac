/**
 * Contrato deliberadamente pequeno: uma surface é dados, nunca código. O
 * browser só conhece componentes e ações compilados no renderer.
 */
export const SURFACE_VERSION = 1;
export const COMPONENTS = new Set([
  'page', 'tabs', 'section', 'card', 'form', 'field', 'select', 'textarea',
  'button', 'notice', 'stat', 'list', 'confirm', 'extra',
]);

const text = (value, fallback = '') => typeof value === 'string' ? value : fallback;

export function validateSurface(surface) {
  if (!surface || typeof surface !== 'object') return { valid: false, error: 'A surface precisa ser um objeto.' };
  if (surface.version !== SURFACE_VERSION) return { valid: false, error: 'Versão de surface incompatível.' };
  if (!/^[a-z][a-z0-9-]*$/.test(text(surface.kind))) return { valid: false, error: 'Tipo de surface inválido.' };
  if (!surface.actions || typeof surface.actions !== 'object') return { valid: false, error: 'Ações declaradas são obrigatórias.' };
  for (const [id, action] of Object.entries(surface.actions)) {
    if (!/^[a-z][a-z0-9.:-]*$/.test(id) || !action || typeof action !== 'object') {
      return { valid: false, error: 'Ação inválida.' };
    }
    if (!['read', 'write', 'destructive'].includes(action.intent)) {
      return { valid: false, error: 'Intenção de ação inválida.' };
    }
  }
  if (surface.forms !== undefined && (!surface.forms || typeof surface.forms !== 'object')) {
    return { valid: false, error: 'Formulários inválidos.' };
  }
  for (const form of Object.values(surface.forms || {})) {
    if (!form || !Array.isArray(form.fields)) return { valid: false, error: 'Campos de formulário inválidos.' };
    for (const field of form.fields) {
      if (!field || !/^[A-Za-z][A-Za-z0-9_]*$/.test(text(field.name)) || !['input', 'select', 'textarea', 'toggle'].includes(field.component)) {
        return { valid: false, error: 'Campo não permitido.' };
      }
    }
  }
  if (surface.extra !== undefined) {
    if (!surface.extra || typeof surface.extra !== 'object' || !['github-credentials'].includes(surface.extra.kind)) {
      return { valid: false, error: 'Extra de surface não permitido.' };
    }
    if (!surface.extra.actions || typeof surface.extra.actions !== 'object') return { valid: false, error: 'Ações de extra são obrigatórias.' };
    for (const [key, id] of Object.entries(surface.extra.actions)) {
      if (!/^[a-z][a-z0-9-]*$/.test(key) || typeof id !== 'string' || !surface.actions[id]) return { valid: false, error: 'Ação de extra não declarada.' };
    }
  }
  return { valid: true };
}

export function assertSurface(surface) {
  const result = validateSurface(surface);
  if (!result.valid) throw new Error(result.error);
  return surface;
}
