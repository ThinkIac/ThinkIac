'use strict';

import crypto from 'crypto';

import { KeyRole } from './keys';

export const DELEGATION_PREFIX = 'logos-delegated-v1.';

export interface DelegatedIdentity { machine: string; actor: string; role: KeyRole; exp: number; }

/** Validates the compact identity issued by Git Cloud for a single SSH session. */
export function verifyDelegatedCredential(username: string, publicKey: string, expectedMachine = '', now = () => Date.now()): DelegatedIdentity | null {
  if (!publicKey || !username.startsWith(DELEGATION_PREFIX)) return null;
  const parts = username.slice(DELEGATION_PREFIX.length).split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    const [payload, signature] = parts;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    if (claims?.v !== 1 || typeof claims.machine !== 'string' || typeof claims.actor !== 'string' || !['main', 'branch', 'read'].includes(claims.role) || !Number.isInteger(claims.exp)) return null;
    if (claims.exp <= Math.floor(now() / 1000) || (expectedMachine && claims.machine !== expectedMachine)) return null;
    const valid = crypto.verify(null, Buffer.from(`thinkiac:git-delegation:v1:${payload}`), publicKey, Buffer.from(signature, 'base64url'));
    return valid ? { machine: claims.machine, actor: claims.actor, role: claims.role, exp: claims.exp } : null;
  } catch { return null; }
}

