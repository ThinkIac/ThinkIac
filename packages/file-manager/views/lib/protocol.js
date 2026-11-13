export const FILE_MANAGER_PREVIEW_EVENT = 'file-manager:preview';

export function normalizeFilePreview(input = {}) {
  const path = typeof input.path === 'string' ? input.path.trim() : '';
  if (!path || path.startsWith('/') || path.split('/').includes('..')) return null;
  const name = typeof input.name === 'string' && input.name.trim()
    ? input.name.trim()
    : path.split('/').pop();
  return {
    path,
    name,
    type: typeof input.type === 'string' ? input.type : '',
    title: typeof input.title === 'string' && input.title.trim() ? input.title.trim() : name,
  };
}

export function filePreviewUrl(input) {
  const preview = normalizeFilePreview(input);
  if (!preview) return null;
  const params = new URLSearchParams({ path: preview.path, name: preview.name });
  if (preview.type) params.set('type', preview.type);
  return `/view/file-manager/Preview?${params}`;
}

export function openFilePreview(input, target = typeof window !== 'undefined' ? window.parent : null) {
  const preview = normalizeFilePreview(input);
  if (!preview || !target?.postMessage) return false;
  target.postMessage({ source: 'thinkiac-shell', type: FILE_MANAGER_PREVIEW_EVENT, detail: preview }, '*');
  return true;
}
