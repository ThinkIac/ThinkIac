import { openSync, closeSync, fstatSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const version = s => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join(':')




export class BagReadCache {
  constructor({ maxBytes = 8 * 1024 * 1024, maxEntryBytes = 1024 * 1024 } = {}) {
    this.maxBytes = maxBytes
    this.maxEntryBytes = maxEntryBytes
    this.entries = new Map()
    this.bytes = 0
  }

  drop(key) {
    const old = this.entries.get(key)
    if (old) this.bytes -= old.bytes
    this.entries.delete(key)
  }

  read(path, scope) {
    if (!scope) throw new Error('BAG_READ_SCOPE_REQUIRED')
    const key = JSON.stringify([scope, path])
    let fd
    try {
      fd = openSync(path, 'r')
      const before = fstatSync(fd, { bigint: true })
      if (!before.isFile()) throw new Error('BAG_READ_NOT_REGULAR_FILE')
      const raw = readFileSync(fd)
      const after = fstatSync(fd, { bigint: true })
      const stable = version(before) === version(after) && BigInt(raw.length) === after.size
      const digest = hash(raw)
      const old = this.entries.get(key)
      const reused = stable && old?.hash === digest
      const content = reused ? old.content : raw.toString('utf8')
      this.drop(key)
      if (stable && raw.length <= this.maxEntryBytes && raw.length <= this.maxBytes) {
        while (this.bytes + raw.length > this.maxBytes || this.entries.size >= 256) this.drop(this.entries.keys().next().value)
        this.entries.set(key, { hash: digest, content, bytes: raw.length })
        this.bytes += raw.length
      }
      return { content, readVersion: { hash: digest, representation: 'raw_bytes', bytes: raw.length,
        stable, reused: Boolean(reused), invalidated: Boolean(old && (!stable || old.hash !== digest)) } }
    } catch (error) {
      this.drop(key)
      throw error
    } finally { if (fd !== undefined) closeSync(fd) }
  }
}

export const bagReadCache = new BagReadCache()
