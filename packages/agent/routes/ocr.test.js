import assert from 'node:assert/strict';
import test from 'node:test';

import { canRunOcr, recognizeImageText } from './ocr.js';

test('reconhece somente formatos raster suportados pelo OCR', () => {
  assert.equal(canRunOcr('image/png'), true);
  assert.equal(canRunOcr('image/jpeg'), true);
  assert.equal(canRunOcr('image/svg+xml'), false);
  assert.equal(canRunOcr('application/pdf'), false);
});

test('normaliza a saída do Tesseract e envia idioma e modo configurados', async () => {
  let call;
  const result = await recognizeImageText('/tmp/photo.png', {
    language: 'por+eng',
    exec: async (...args) => {
      call = args;
      return { stdout: '  Olá  \r\n\r\n mundo  \n' };
    },
  });

  assert.deepEqual(result, { text: 'Olá\n\n mundo', status: 'complete' });
  assert.deepEqual(call[1], ['/tmp/photo.png', 'stdout', '-l', 'por+eng', '--psm', '3']);
});

test('não propaga erro do processo de OCR', async () => {
  const result = await recognizeImageText('/tmp/photo.png', {
    exec: async () => { throw new Error('tesseract indisponível'); },
  });

  assert.deepEqual(result, { text: '', status: 'unavailable' });
});
