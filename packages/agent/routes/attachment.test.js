import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getAttachment, inspectAttachment, validateAttachment } from './attachment.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
let fixtureDir;

test.beforeEach(async () => {
  await mkdir(path.join(projectRoot, 'uploads'), { recursive: true });
  fixtureDir = await mkdtemp(path.join(projectRoot, 'uploads', 'attachment-test-'));
});

test.afterEach(async () => {
  await rm(fixtureDir, { recursive: true, force: true });
});

test('valida arquivo local permitido sem copiar seu conteúdo', async () => {
  const file = path.join(fixtureDir, 'nota.md');
  await writeFile(file, '# local');

  const result = await validateAttachment({ body: { path: file } });

  assert.equal(result.status, 200);
  assert.equal(result.data.path, file);
  assert.equal(result.data.name, 'nota.md');
  assert.equal(result.data.mimetype, 'text/markdown');
  assert.equal(result.data.isText, true);
  assert.equal(result.data.source, 'local-path');
});

test('aceita referência parcial a partir da raiz do projeto', async () => {
  const file = path.join(fixtureDir, 'parcial.txt');
  await writeFile(file, 'referência parcial');
  const partial = file.slice(projectRoot.length);

  const result = await validateAttachment({ body: { path: partial } });

  assert.equal(result.status, 200);
  assert.equal(result.data.path, file);
  assert.equal(result.data.name, 'parcial.txt');
});

test('entrega somente o anexo validado com cabeçalhos seguros', async () => {
  const file = path.join(fixtureDir, 'relatório.txt');
  await writeFile(file, 'conteúdo local');

  const result = await getAttachment({ query: { path: file } });

  assert.equal(result.status, 200);
  assert.equal(result.body.toString(), 'conteúdo local');
  assert.equal(result.headers['Content-Type'], 'text/plain');
  assert.equal(result.headers['Content-Length'], String(Buffer.byteLength('conteúdo local')));
  assert.equal(result.headers['X-Content-Type-Options'], 'nosniff');
  assert.match(result.headers['Content-Disposition'], /^inline; filename=/);
});

test('não tenta abrir anexo sem caminho e recusa anexos grandes', async () => {
  assert.equal((await getAttachment({ query: {} })).status, 400);

  const large = path.join(fixtureDir, 'grande.txt');
  await writeFile(large, Buffer.alloc(25 * 1024 * 1024 + 1));
  const result = await getAttachment({ query: { path: large } });

  assert.equal(result.status, 413);
  assert.match(result.data.error, /grande demais/);
});

test('rejeita caminho inexistente, diretório e arquivo fora das raízes', async () => {
  const directory = path.join(fixtureDir, 'pasta');
  await mkdir(directory);

  assert.equal((await inspectAttachment(path.join(fixtureDir, 'ausente.txt'))).status, 404);
  assert.equal((await inspectAttachment(directory)).status, 400);

  const outside = path.join(await mkdtemp(path.join(tmpdir(), 'attachment-outside-')), 'fora.txt');
  await writeFile(outside, 'fora');
  try {
    assert.equal((await inspectAttachment(outside)).status, 403);
  } finally {
    await rm(path.dirname(outside), { recursive: true, force: true });
  }
});

test('rejeita symlink que escapa da raiz e caminhos sensíveis', async () => {
  const outsideDir = await mkdtemp(path.join(tmpdir(), 'attachment-link-outside-'));
  const outside = path.join(outsideDir, 'fora.txt');
  const link = path.join(fixtureDir, 'escape.txt');
  await writeFile(outside, 'fora');
  await symlink(outside, link);
  await writeFile(path.join(fixtureDir, '.env'), 'SECRET=nao-expor');

  try {
    assert.equal((await inspectAttachment(link)).status, 403);
    assert.equal((await inspectAttachment(path.join(fixtureDir, '.env'))).status, 403);
  } finally {
    await rm(outsideDir, { recursive: true, force: true });
  }
});
