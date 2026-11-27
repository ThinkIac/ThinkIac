import { getSession, saveSessionState } from '../../agent/memory/session.js';
import { createPrivacySession } from './privacy.js';
import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

const defaultsFile = new URL('../maltese.config.json', import.meta.url);

function normalize(value = {}) {
  return { enabled: value.enabled === true, mode: value.mode === 'pseudo' ? 'pseudo' : 'anon' };
}

export function getMalteseDefaults() {
  try {
    return normalize(JSON.parse(readFileSync(defaultsFile, 'utf8')));
  } catch {
    return normalize();
  }
}

export function setMalteseDefaults(patch = {}) {
  const next = normalize({ ...getMalteseDefaults(), ...patch });
  const temporary = new URL(`../maltese.config.${randomUUID()}.tmp`, import.meta.url);
  try {
    writeFileSync(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
    renameSync(temporary, defaultsFile);
  } finally {
    rmSync(temporary, { force: true });
  }
  return next;
}

export function getMalteseSession(sessionId = 'default') {
  return normalize(getSession(sessionId).maltese || getMalteseDefaults());
}

export function setMalteseSession(sessionId, patch = {}) {
  const session = getSession(sessionId);
  const previous = session.maltese;
  session.maltese = normalize({ ...getMalteseSession(sessionId), ...patch });
  try {
    if (saveSessionState(sessionId) === false) throw new Error('Sessão indisponível para gravação.');
  } catch (error) {
    session.maltese = previous;
    throw error;
  }
  return session.maltese;
}

export function privacyForSession(sessionId) {
  const settings = getMalteseSession(sessionId);
  return settings.enabled ? createPrivacySession(settings) : null;
}
