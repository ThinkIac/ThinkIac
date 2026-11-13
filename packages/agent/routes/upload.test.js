import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { uploadFile } from './upload.js';

let uploadDir;

test.beforeEach(async () => {
  uploadDir = await mkdtemp(path.join(tmpdir(), 'agent-upload-'));
});

test.afterEach(async () => {
  await rm(uploadDir, { recursive: true, force: true });
});

function request(originalname, mimetype, buffer) {
  return { file: { originalname, mimetype, buffer, size: buffer.length }, body: { sessionId: 'fixture' } };
}

async function upload(req, randomUUID = () => 'server-id') {
  return uploadFile(req, { uploadDir, randomUUID, dispatchEvent: null });
}

async function uploadWithOcr(req, recognizeImageText, randomUUID = () => 'server-id') {
  return uploadFile(req, {
    uploadDir,
    randomUUID,
    dispatchEvent: null,
    recognizeImageText,
  });
}

test('nome com traversal vira apenas metadado seguro e o arquivo recebe nome do servidor', async () => {
  const result = await upload(request('../../outside.md', 'text/markdown', Buffer.from('# seguro')));

  assert.equal(result.status, 200);
  assert.equal(result.data.name, 'outside.md');
  assert.equal(result.data.filename, 'server-id.md');
  assert.equal(result.data.path, path.join(uploadDir, 'server-id.md'));
  assert.equal(await readFile(result.data.path, 'utf8'), '# seguro');
});

test('nome absoluto POSIX ou Windows nunca escolhe o caminho de destino', async () => {
  const posix = await upload(request('/etc/passwd.txt', 'text/plain', Buffer.from('a')), () => 'one');
  const windows = await upload(request('C:\\temp\\notes.txt', 'text/plain', Buffer.from('b')), () => 'two');

  assert.equal(posix.data.name, 'passwd.txt');
  assert.equal(windows.data.name, 'notes.txt');
  assert.deepEqual((await readdir(uploadDir)).sort(), ['one.txt', 'two.txt']);
});

test('colisão não sobrescreve arquivo e tenta outro identificador', async () => {
  await writeFile(path.join(uploadDir, 'same.md'), 'conteúdo anterior');
  const ids = ['same', 'different'];
  const result = await upload(
    request('same.md', 'text/markdown', Buffer.from('conteúdo novo')),
    () => ids.shift(),
  );

  assert.equal(result.status, 200);
  assert.equal(result.data.filename, 'different.md');
  assert.equal(await readFile(path.join(uploadDir, 'same.md'), 'utf8'), 'conteúdo anterior');
  assert.equal(await readFile(path.join(uploadDir, 'different.md'), 'utf8'), 'conteúdo novo');
});

test('rejeita MIME de imagem incompatível sem persistir bytes', async () => {
  const result = await upload(request('fake.png', 'image/png', Buffer.from('<script>não é png</script>')));

  assert.equal(result.status, 415);
  assert.match(result.data.error, /MIME incompatível/);
  assert.deepEqual(await readdir(uploadDir), []);
});

test('preserva upload legítimo de texto e normaliza MIME genérico por extensão', async () => {
  const result = await upload(request('config.json', 'application/octet-stream', Buffer.from('{"ok":true}')));

  assert.equal(result.status, 200);
  assert.equal(result.data.mimetype, 'text/plain');
  assert.equal(result.data.isText, true);
  assert.equal(result.data.textContent, '{"ok":true}');
  assert.equal(result.data.sessionId, 'fixture');
});

test('preserva MIME válido de texto e extensão segura fora da lista de código', async () => {
  const json = await upload(request('dados.json', 'application/json', Buffer.from('{"ok":true}')), () => 'json');
  const log = await upload(request('execucao.log', 'text/plain', Buffer.from('ok')), () => 'log');

  assert.equal(json.data.mimetype, 'application/json');
  assert.equal(json.data.isText, true);
  assert.equal(log.data.filename, 'log.log');
  assert.equal(log.data.mimetype, 'text/plain');
});

test('preserva imagem PNG legítima e sua extensão para reabertura', async () => {
  const bytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]),
    Buffer.from('fixture'),
  ]);
  const result = await upload(request('foto.png', 'image/png', bytes));

  assert.equal(result.status, 200);
  assert.equal(result.data.filename, 'server-id.png');
  assert.equal(result.data.mimetype, 'image/png');
  assert.equal(result.data.isImage, true);
  assert.match(result.data.base64, /^data:image\/png;base64,/);
});

test('executa OCR automaticamente em imagem e mantém o resultado no anexo', async () => {
  const bytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]), Buffer.from('fixture'),
  ]);
  const calls = [];
  const result = await uploadWithOcr(
    request('placa.png', 'image/png', bytes),
    async (filePath) => {
      calls.push(filePath);
      return { text: 'Entrada principal', status: 'complete' };
    },
  );

  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(result.data.ocrText, 'Entrada principal');
  assert.equal(result.data.ocrStatus, 'complete');
});

test('falha do OCR não rejeita o upload da imagem', async () => {
  const bytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]), Buffer.from('fixture'),
  ]);
  const result = await uploadWithOcr(
    request('placa.png', 'image/png', bytes),
    async () => ({ text: '', status: 'unavailable' }),
  );

  assert.equal(result.status, 200);
  assert.equal(result.data.ocrText, null);
  assert.equal(result.data.ocrStatus, 'unavailable');
});

test('infere PNG comprovado quando o navegador envia MIME genérico', async () => {
  const bytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]), Buffer.from('fixture'),
  ]);
  const result = await upload(request('clipboard.png', 'application/octet-stream', bytes));

  assert.equal(result.status, 200);
  assert.equal(result.data.mimetype, 'image/png');
  assert.equal(result.data.isImage, true);
});

test('preserva binário genérico, PDF e imagem desconhecida do contrato aberto', async () => {
  const binary = await upload(request('arquivo.zip', 'application/zip', Buffer.from([0, 1, 2])), () => 'zip');
  const pdf = await upload(request('relatorio.pdf', 'application/pdf', Buffer.from('%PDF-1.7')), () => 'pdf');
  const unknownImage = await upload(request('captura.heic', 'image/heic', Buffer.from('heic fixture')), () => 'heic');

  assert.deepEqual(
    [binary, pdf, unknownImage].map((result) => [result.status, result.data.isImage, result.data.isText]),
    [[200, false, false], [200, false, false], [200, true, false]],
  );
  assert.deepEqual((await readdir(uploadDir)).sort(), ['heic.heic', 'pdf.pdf', 'zip.zip']);
});

test('aceita imagem sem extensão quando conteúdo e MIME reconhecido conferem', async () => {
  const bytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('jpeg')]);
  const result = await upload(request('clipboard', 'image/jpeg', bytes));

  assert.equal(result.status, 200);
  assert.equal(result.data.filename, 'server-id');
  assert.equal(result.data.isImage, true);
});

test('preserva SVG com prólogo e comentários e AVIF declarado em compatible brands', async () => {
  const svg = await upload(
    request('diagrama.svg', 'image/svg+xml', Buffer.from('<?xml version="1.0"?><!-- desenho --><svg></svg>')),
    () => 'svg',
  );
  const avifBytes = Buffer.concat([
    Buffer.from([0, 0, 0, 24]), Buffer.from('ftyp'), Buffer.from('mif1'),
    Buffer.from([0, 0, 0, 0]), Buffer.from('mif1'), Buffer.from('avif'),
  ]);
  const avif = await upload(request('foto.avif', 'image/avif', avifBytes), () => 'avif');

  assert.equal(svg.status, 200);
  assert.equal(svg.data.filename, 'svg.svg');
  assert.equal(avif.status, 200);
  assert.equal(avif.data.filename, 'avif.avif');
});

test('não confunde snippets SVG dentro de HTML ou Markdown com imagem', async () => {
  const html = await upload(
    request('exemplo.html', 'text/html', Buffer.from('<main><svg viewBox="0 0 1 1"></svg></main>')),
    () => 'html',
  );
  const markdown = await upload(
    request('guia.md', 'text/markdown', Buffer.from('Exemplo: `<svg></svg>`')),
    () => 'markdown',
  );

  assert.equal(html.status, 200);
  assert.equal(html.data.isText, true);
  assert.equal(markdown.status, 200);
  assert.equal(markdown.data.isText, true);
});
