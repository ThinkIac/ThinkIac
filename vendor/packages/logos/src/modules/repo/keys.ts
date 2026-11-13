// modules/repo/keys.ts — who may talk to the auto-repository.
//
// .logos/authorized_keys is an OpenSSH-shaped file. The optional options
// field carries the Lógos role:
//
//   logos-role=main    clone, fetch, push anything (default)
//   logos-role=branch  clone, fetch, push any branch EXCEPT main
//   logos-role=read    clone and fetch only
//
//   logos-role=branch ssh-ed25519 AAAAC3Nz... alice@laptop
//   ssh-ed25519 AAAAC3Nz... ci@builder
//
// The role is enforced twice: `read` never reaches git-receive-pack (ssh.ts),
// and `branch` is stopped at the pre-receive hook, which is the only place
// that knows which refs a push actually carries (git.ts).

'use strict';

import fs from 'fs';

export type KeyRole = 'main' | 'branch' | 'read';

export interface AuthorizedKey {
  type: string;
  /** Raw public key blob, as sent on the wire. */
  blob: Buffer;
  comment: string;
  role: KeyRole;
}

const KEY_TYPE = /^(ssh-|ecdsa-|sk-)/;

function parseRole(options: string): KeyRole {
  const match = /(?:logos-)?role=("?)(main|branch|read)\1/.exec(options);
  return (match?.[2] as KeyRole) ?? 'main';
}

export function parseAuthorizedKeys(content: string): AuthorizedKey[] {
  const keys: AuthorizedKey[] = [];
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const tokens = line.split(/\s+/);
    let role: KeyRole = 'main';
    if (!KEY_TYPE.test(tokens[0])) {
      role = parseRole(tokens.shift() as string);
    }
    const [type, b64, ...rest] = tokens;
    if (!type || !b64 || !KEY_TYPE.test(type)) continue;

    let blob: Buffer;
    try { blob = Buffer.from(b64, 'base64'); } catch { continue; }
    if (!blob.length) continue;

    keys.push({ type, blob, comment: rest.join(' '), role });
  }
  return keys;
}

export function loadAuthorizedKeys(file: string): AuthorizedKey[] {
  if (!fs.existsSync(file)) return [];
  try { return parseAuthorizedKeys(fs.readFileSync(file, 'utf-8')); }
  catch { return []; }
}

export function appendAuthorizedKey(file: string, line: string, role: KeyRole = 'main'): AuthorizedKey | null {
  const parsed = parseAuthorizedKeys(line);
  if (!parsed.length) return null;
  const entry = `logos-role=${role} ${line.trim()}\n`;
  fs.appendFileSync(file, entry, { mode: 0o600 });
  return { ...parsed[0], role };
}

