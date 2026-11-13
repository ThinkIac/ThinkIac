import { readFile, realpath, stat } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));


const projectRoot = path.resolve(__dirname, '../../..');




function allowedRoots() {
  const extra = (process.env.AGENT_ATTACHMENT_ROOTS || '')
    .split(':')
    .map((p) => p.trim())
    .filter(Boolean);
  return [path.join(projectRoot, 'uploads'), projectRoot, ...extra].map((p) =>
    path.resolve(p),
  );
}

const BLOCKED = /(^|\/)(\.git|node_modules|secrets)(\/|$)|(^|\/)\.env/i;

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
};

function mimeFor(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function isAllowedPath(root, candidate) {
  return candidate === root || candidate.startsWith(root + path.sep);
}

/**
 * Resolve a local attachment once, before either previewing it or adding it to
 * a chat. Keeping this independent from the HTTP handler makes the same
 * containment checks available to the paste flow and to future callers.
 */
export async function inspectAttachment(raw) {
  if (!raw || typeof raw !== 'string' || !path.isAbsolute(raw)) {
    return { status: 400, error: 'Informe um caminho absoluto de arquivo' };
  }

  let resolved;
  try {
    
    
    
    
    const hostPath = path.resolve(raw);
    const projectPath = path.resolve(projectRoot, `.${raw}`);
    
    try {
      resolved = await realpath(hostPath);
    } catch {
      resolved = await realpath(projectPath);
    }
  } catch {
    return { status: 404, error: 'Arquivo não encontrado' };
  }

  const inRoot = allowedRoots().some((root) => isAllowedPath(root, resolved));
  if (!inRoot || BLOCKED.test(resolved)) {
    return { status: 403, error: 'Caminho não permitido' };
  }

  const info = await stat(resolved).catch(() => null);
  if (!info?.isFile()) {
    return { status: 400, error: 'O caminho não aponta para um arquivo' };
  }

  const mimetype = mimeFor(resolved);
  return {
    status: 200,
    data: {
      name: path.basename(resolved),
      path: resolved,
      mimetype,
      size: info.size,
      isImage: mimetype.startsWith('image/'),
      isText: mimetype.startsWith('text/') || mimetype === 'application/json',
      source: 'local-path',
    },
  };
}

export async function validateAttachment(req) {
  /**
   * @register_router attachment/validate
   * @method POST
   * @description Valida um arquivo local permitido sem copiá-lo ou enviá-lo.
   */
  const result = await inspectAttachment(req.body?.path);
  return result.status === 200
    ? { status: 200, data: result.data }
    : { status: result.status, data: { error: result.error } };
}




export async function getAttachment(req) {
  /**
   * @register_router attachment
   * @method GET
   */
  const raw = req.query?.path;
  if (!raw || typeof raw !== 'string') {
    return { status: 400, data: { error: 'Parâmetro "path" obrigatório' } };
  }

  const inspected = await inspectAttachment(raw);
  if (inspected.status !== 200) {
    return { status: inspected.status, data: { error: inspected.error } };
  }
  const { path: resolved, mimetype } = inspected.data;
  const info = await stat(resolved);
  
  if (info.size > 25 * 1024 * 1024) {
    return { status: 413, data: { error: 'Arquivo grande demais para exibir' } };
  }

  const body = await readFile(resolved);

  return {
    status: 200,
    headers: {
      'Content-Type': mimetype,
      'Content-Length': String(info.size),
      'Cache-Control': 'private, max-age=3600',
      'Content-Disposition': `inline; filename="${path
        .basename(resolved)
        .replace(/"/g, '')}"`,
      'X-Content-Type-Options': 'nosniff',
    },
    body,
  };
}
