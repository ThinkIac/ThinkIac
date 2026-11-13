import path from 'path';

const TEXT_EXTENSION = /\.(js|ts|jsx|tsx|py|json|md|yaml|yml|xml|html|css|scss|sh|env|toml|rs|go|java|c|cpp|h|txt|csv)$/i;
const IMAGE_MIME_BY_EXTENSION = new Map([
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'], ['.webp', 'image/webp'], ['.bmp', 'image/bmp'],
  ['.ico', 'image/x-icon'], ['.avif', 'image/avif'], ['.svg', 'image/svg+xml'],
]);
const CHECKED_RASTER_MIMES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/x-icon', 'image/avif', 'image/svg+xml',
]);

export class UploadValidationError extends Error {
  constructor(message, status = 415) {
    super(message);
    this.status = status;
  }
}

export function sanitizeUploadName(value) {
  const basename = path.posix.basename(String(value || '').replace(/\\/g, '/'));
  const cleaned = basename.normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"/\\|?*]/g, '_').trim().slice(0, 200);
  return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : 'upload';
}

function imageMime(buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]))) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (/^GIF8[79]a$/.test(buffer.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer.subarray(0, 2).toString('ascii') === 'BM') return 'image/bmp';
  if (buffer.length >= 4 && buffer.readUInt32BE(0) === 0x00000100) return 'image/x-icon';
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    for (let offset = 8; offset + 4 <= Math.min(buffer.length, 64); offset += 4) {
      if (/^(avif|avis)$/.test(buffer.subarray(offset, offset + 4).toString('ascii'))) return 'image/avif';
    }
  }
  return null;
}

function utf8(buffer) {
  try {
    const value = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return value.includes('\0') ? null : value;
  } catch { return null; }
}

export function validateUpload(file) {
  if (!Buffer.isBuffer(file?.buffer)) throw new UploadValidationError('Conteúdo do arquivo inválido', 400);

  const name = sanitizeUploadName(file.originalname);
  const rawExtension = path.extname(name).toLowerCase();
  const extension = /^\.[a-z0-9]{1,10}$/.test(rawExtension) ? rawExtension : '';
  const rawMime = String(file.mimetype || '').split(';', 1)[0].trim().toLowerCase();
  let declared = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(rawMime)
    ? rawMime : 'application/octet-stream';
  if (declared === 'image/jpg') declared = 'image/jpeg';
  if (declared === 'image/vnd.microsoft.icon') declared = 'image/x-icon';
  const expectedImage = IMAGE_MIME_BY_EXTENSION.get(extension);
  const textContent = utf8(file.buffer);
  const actualImage = imageMime(file.buffer)
    || ((expectedImage === 'image/svg+xml' || declared === 'image/svg+xml')
      && textContent !== null && /<svg(?:\s|>)/i.test(textContent.slice(0, 4096))
      ? 'image/svg+xml' : null);
  if ((!rawMime || declared === 'application/octet-stream') && actualImage) declared = actualImage;

  if (declared.startsWith('image/') || expectedImage) {
    const expected = expectedImage || declared;
    const rasterMustMatch = CHECKED_RASTER_MIMES.has(expected);
    if ((expectedImage && declared !== expectedImage) || (rasterMustMatch && actualImage !== expected)) {
      throw new UploadValidationError('Tipo MIME incompatível com o conteúdo ou extensão');
    }
    return { name, extension, mimetype: declared, isImage: true, isText: false, textContent: null };
  }

  const declaredText = declared.startsWith('text/');
  const extensionText = TEXT_EXTENSION.test(name);
  if ((declaredText || extensionText) && (textContent === null || actualImage)) {
    throw new UploadValidationError('Tipo de arquivo não permitido ou incompatível com o conteúdo');
  }
  if (!declaredText && !extensionText) {
    return { name, extension, mimetype: declared, isImage: false, isText: false, textContent: null };
  }
  return {
    name,
    extension,
    mimetype: declared === 'application/octet-stream' ? 'text/plain' : declared,
    isImage: false,
    isText: true,
    textContent,
  };
}
