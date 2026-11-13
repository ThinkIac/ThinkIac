import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const OCR_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/x-icon',
  'image/avif',
]);

const MAX_OCR_TEXT = 100_000;

export function canRunOcr(mimetype) {
  return OCR_MIMES.has(String(mimetype || '').toLowerCase());
}

function cleanOcrText(value) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim()
    .slice(0, MAX_OCR_TEXT);
}

/**
 * Extrai texto de uma imagem persistida. O OCR é best effort e nunca deve
 * impedir que o usuário envie o anexo para o modelo multimodal.
 */
export async function recognizeImageText(filePath, {
  exec = execFileAsync,
  command = process.env.TESSERACT_BIN || 'tesseract',
  language = process.env.THINKIAC_OCR_LANG || 'por+eng',
  timeout = 20_000,
} = {}) {
  if (!filePath) return { text: '', status: 'skipped' };

  try {
    const result = await exec(command, [filePath, 'stdout', '-l', language, '--psm', '3'], {
      timeout,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    const text = cleanOcrText(result?.stdout);
    return { text, status: text ? 'complete' : 'empty' };
  } catch {
    return { text: '', status: 'unavailable' };
  }
}
