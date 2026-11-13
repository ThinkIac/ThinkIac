// tests/db-datadir.test.ts — onde o banco de cada pacote é gravado.
//
// O que se protege aqui é o dado do usuário. Historicamente o banco ficava em
// <pkg.dir>/.database, dentro do diretório que no container vem da IMAGEM —
// ou seja, na camada gravável, que some em qualquer recriação do container.
// Com LOGOS_DATA_DIR os bancos passam a viver no volume nomeado do tenant.
//
// O caso mais importante é o negativo: SEM a variável, nada pode mudar de
// lugar. Uma instalação existente que passasse a apontar para outro caminho
// perderia o banco de vista, que é exatamente o desastre que a mudança quer
// evitar.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createDb } from './db-module';

const { resolveDatabasePath } = createDb();

const ORIGINAL = process.env.LOGOS_DATA_DIR;
let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'logos-datadir-'));
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.LOGOS_DATA_DIR;
  else process.env.LOGOS_DATA_DIR = ORIGINAL;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('resolveDatabasePath', () => {
  it('sem LOGOS_DATA_DIR mantém o banco dentro do pacote (comportamento legado)', () => {
    delete process.env.LOGOS_DATA_DIR;
    expect(resolveDatabasePath('memory', '/app/packages/memory'))
      .toBe(path.join('/app/packages/memory', '.database'));
  });

  it('com LOGOS_DATA_DIR grava sob o diretório de dados, separado por pacote', () => {
    process.env.LOGOS_DATA_DIR = tmp;
    expect(resolveDatabasePath('memory', '/app/packages/memory'))
      .toBe(path.join(tmp, 'db', 'memory', '.database'));
  });

  it('cria o diretório de destino — o volume nasce vazio', () => {
    process.env.LOGOS_DATA_DIR = tmp;
    resolveDatabasePath('bags', '/app/packages/bags');
    expect(fs.existsSync(path.join(tmp, 'db', 'bags'))).toBe(true);
  });

  it('pacotes diferentes não compartilham banco', () => {
    process.env.LOGOS_DATA_DIR = tmp;
    const a = resolveDatabasePath('memory', '/app/packages/memory');
    const b = resolveDatabasePath('bags', '/app/packages/bags');
    expect(a).not.toBe(b);
  });

  it('o destino não depende do diretório do pacote', () => {
    // Só assim o upgrade de imagem é seguro: o pacote pode mudar de lugar
    // dentro da imagem sem que o banco do usuário fique para trás.
    process.env.LOGOS_DATA_DIR = tmp;
    expect(resolveDatabasePath('memory', '/app/packages/memory'))
      .toBe(resolveDatabasePath('memory', '/outro/caminho/memory'));
  });

  it('LOGOS_DATA_DIR vazio é tratado como ausente', () => {
    process.env.LOGOS_DATA_DIR = '';
    expect(resolveDatabasePath('memory', '/app/packages/memory'))
      .toBe(path.join('/app/packages/memory', '.database'));
  });
});
