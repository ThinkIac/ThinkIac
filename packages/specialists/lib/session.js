// specialists/lib/session.js — especialista fixado por sessão.
//
// Mesma regra do propósito (aurora/core/session_purpose.js): a sessão que
// escolhe um especialista vai por ele INTEIRA, até escolher `none`/limpar.
// Mora em disco, não num Map — reiniciar o runtime não pode devolver a sessão
// pro comportamento sem especialista silenciosamente.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getSpecialistById } from './catalog.js'

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')
const FILE = join(DATA_DIR, 'session_specialists.json')

let cache = null
let ephemeral = false

function load() {
  if (cache) return cache
  try { cache = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {} } catch { cache = {} }
  return cache
}

function persist() {
  if (ephemeral) return
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(FILE, JSON.stringify(cache ?? {}, null, 2), 'utf8')
  } catch { /* preferência de UI nunca derruba o turno */ }
}

/** Apenas para testes: mantém tudo em memória. */
export function setSpecialistStoreForTest(next) {
  cache = next || {}
  ephemeral = true
}

/** @returns {string|null} id fixado, ou null quando a sessão está sem especialista. */
export function getSessionSpecialistId(sessionId) {
  if (!sessionId) return null
  const value = load()[sessionId]
  return typeof value === 'string' && value ? value : null
}

/** `none`, string vazia ou null limpam o override. */
export function setSessionSpecialistId(sessionId, specialistId) {
  if (!sessionId) throw new Error('sessionId é obrigatório')
  const value = specialistId && specialistId !== 'none' ? String(specialistId) : null
  const store = load()
  if (value) store[sessionId] = value
  else delete store[sessionId]
  persist()
  return value
}

export function clearSessionSpecialistId(sessionId) {
  return setSessionSpecialistId(sessionId, null)
}

export function listSessionSpecialistOverrides() {
  return { ...load() }
}

/**
 * Especialista ATIVO e já resolvido para a sessão, ou null.
 *
 * Se o id fixado não resolve mais (especialista apagado), a sessão é
 * auto-curada de volta pra `none` em vez de manter um ponteiro morto — sem
 * isso o loop do agente ficaria silenciosamente sem prompt/tools a cada turno.
 */
export function resolveSessionSpecialist(sessionId) {
  const id = getSessionSpecialistId(sessionId)
  if (!id) return null
  const resolved = getSpecialistById(id)
  if (!resolved) {
    clearSessionSpecialistId(sessionId)
    return null
  }
  return resolved
}
