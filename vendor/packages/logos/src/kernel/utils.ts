// kernel/utils.ts — small shared helpers (single source of truth for things
// that were duplicated across v1: toEnvSegment, workspace resolution, etc.)

'use strict';

import fs from 'fs';
import path from 'path';

export function toEnvSegment(str: string): string {
  return String(str).toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

/** Directories the scanner and watchers must never descend into. */
export const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.logos', '.svelte-cache',
  '.snapshots', '.database', 'dist',
  // Runtime-owned state is not package source. Keeping these names out of the
  // scanner, stabilizer watcher and checkpoints prevents live data (including
  // terminal homes and uploaded JavaScript) from being treated as code.
  'data', 'uploads', 'profiles', 'secrets', 'generated',
  'backups', 'snapshots', 'sessions', 'shared-cache',
]);

export function resolveWorkspace(explicit?: string): string {
  if (explicit) {
    return path.isAbsolute(explicit) ? explicit : path.resolve(process.cwd(), explicit);
  }
  if (process.env.PACKAGES_PATH) return process.env.PACKAGES_PATH;
  return path.join(process.cwd(), 'packages');
}

export function safeReadJson(file: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function copyDir(src: string, dest: string, skip: Set<string> = IGNORE_DIRS): void {
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to, skip);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

export function removeDirContents(dir: string, skip: Set<string> = IGNORE_DIRS): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    fs.rmSync(path.join(dir, entry.name), { recursive: true, force: true });
  }
}

/**
 * Onde uma rota declarada por um pacote é montada no app.
 *
 * O normal é `/<pacote>/<path>`: o prefixo dá a cada pacote um espaço de nomes
 * próprio e torna impossível um pacote roubar a rota de outro sem querer.
 *
 * A exceção é o caminho que já começa com `/`, montado literalmente na raiz.
 * Existe para protocolo com caminho FIXO por especificação, que não aceita
 * prefixo alheio: `/v2/...` da Docker Registry API, `/.well-known/...`,
 * `/robots.txt`. Sem isso, servir um protocolo desses exige um proxy reescrevendo
 * caminho na frente do runtime — infraestrutura extra para algo que é só uma
 * string.
 *
 * O preço é explícito: na raiz não há espaço de nomes, então dois pacotes podem
 * disputar o mesmo caminho e quem montar primeiro ganha. Por isso é opt-in e
 * visível na própria declaração da rota, nunca inferido.
 */
export function routeMountPath(pkgFolder: string, routePath: string): string {
  return routePath.startsWith('/') ? routePath : `/${pkgFolder}/${routePath}`;
}
