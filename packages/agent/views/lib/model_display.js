

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() ? value : null;
}

export function shortModelLabel(option) {
  return nonEmpty(option?.name)
    || nonEmpty(option?.label)
    || nonEmpty(option?.model)
    || nonEmpty(option?.id)
    || 'Auto';
}

export function fullModelLabel(option) {
  const base = shortModelLabel(option);
  const free = [option?.model, option?.id, option?.name, option?.label]
    .some((value) => /:free(?:@[^\s]+)?$/i.test(String(value || '')));
  
  if (!free || /\(free\)$/i.test(base)) return base;
  return `${base.replace(/:free$/i, '')} (Free)`;
}

export function visibleModelOptions(options) {
  return (options || []).filter((option) => option.id === 'auto'
    || !/batch/i.test(`${option.model || ''} ${option.name || ''} ${option.id} ${option.label || ''}`));
}
