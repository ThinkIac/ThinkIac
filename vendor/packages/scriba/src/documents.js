// JSON documents use a private, versioned schema on an existing Scriba SQLite
// connection. Authorization belongs to the host before entering this layer.
import { createHash } from 'node:crypto';

const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const fail = code => { throw new Error(code); };
const DAY = 86400000;

export function cloneDocument(value, { maxDepth = 64, maxBytes = 1048576 } = {}) {
  const seen = new Set();
  let nodes = 0;
  function visit(item, depth) {
    if (++nodes > 100000 || depth > maxDepth) fail('INVALID_JSON_LIMIT');
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (!item || typeof item !== 'object' || seen.has(item)) fail('INVALID_JSON');
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) fail('INVALID_JSON_CLASS');
    seen.add(item);
    const result = Array.isArray(item) ? [] : {};
    for (const key of Reflect.ownKeys(item)) {
      if (Array.isArray(item) && key === 'length') continue;
      if (typeof key !== 'string' || forbidden.has(key)) fail('INVALID_JSON_KEY');
      if (Array.isArray(item) && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= item.length)) fail('INVALID_JSON_ARRAY');
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor.enumerable || !('value' in descriptor)) fail('INVALID_JSON_DESCRIPTOR');
      result[key] = visit(descriptor.value, depth + 1);
    }
    if (Array.isArray(item) && Object.keys(item).length !== item.length) fail('INVALID_JSON_SPARSE_ARRAY');
    seen.delete(item);
    return result;
  }
  const result = visit(value, 0);
  if (Buffer.byteLength(JSON.stringify(result)) > maxBytes) fail('INVALID_JSON_SIZE');
  return result;
}

function documentKey(key) {
  if (!Array.isArray(key) || key.length !== 4 || key.some(part => typeof part !== 'string' || !part || part.length > 512)) fail('INVALID_ADDRESS');
  return JSON.stringify(key);
}
function overlap(a, b) { return a.slice(0, Math.min(a.length, b.length)).every((part, i) => part === b[i]); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function applyDocumentPatches(value, patches, limits) {
  let result = value === null ? null : cloneDocument(value, limits);
  if (!Array.isArray(patches) || !patches.length || patches.length > 256) fail('INVALID_PATCHES');
  for (const patch of patches) {
    if (!patch || !['set','delete'].includes(patch.op) || !Array.isArray(patch.path) || patch.path.length > 64 ||
      patch.path.some(part => typeof part !== 'string' || forbidden.has(part) || part.length > 512)) fail('INVALID_PATH');
    if (!patch.path.length) {
      if (patch.op !== 'set') fail('INVALID_ROOT_DELETE');
      result = cloneDocument(patch.value, limits);
      continue;
    }
    let parent = result;
    for (const part of patch.path.slice(0,-1)) {
      if (Array.isArray(parent)) fail('ATOMIC_ARRAY');
      if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent, part)) fail('MISSING_PARENT');
      parent = parent[part];
    }
    if (Array.isArray(parent)) fail('ATOMIC_ARRAY');
    if (!parent || typeof parent !== 'object') fail('MISSING_PARENT');
    const last = patch.path.at(-1);
    if (patch.op === 'delete') delete parent[last];
    else parent[last] = cloneDocument(patch.value, limits);
  }
  if (!result || typeof result !== 'object' || Array.isArray(result)) fail('INVALID_JSON_ROOT');
  return cloneDocument(result, limits);
}

export class DocumentStore {
  constructor(db, { now = Date.now, dedupMs = DAY, ...limits } = {}) {
    this.db = db;
    this.now = now;
    this.dedupMs = dedupMs;
    this.limits = limits;
    this.draining = false;
    db.transaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS scriba_document_migrations (version INTEGER PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS scriba_documents (
          address TEXT PRIMARY KEY, value TEXT NOT NULL, version INTEGER NOT NULL,
          schema_version INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS scriba_document_operations (
          address TEXT NOT NULL, operation_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
          version INTEGER NOT NULL, paths TEXT NOT NULL, result TEXT NOT NULL, accepted_at INTEGER NOT NULL,
          PRIMARY KEY(address, operation_id));
        CREATE INDEX IF NOT EXISTS scriba_document_versions ON scriba_document_operations(address, version);
        CREATE TABLE IF NOT EXISTS scriba_document_history (
          address TEXT NOT NULL, version INTEGER NOT NULL, paths TEXT NOT NULL,
          PRIMARY KEY(address, version));
        CREATE TABLE IF NOT EXISTS scriba_document_outbox (
          id INTEGER PRIMARY KEY AUTOINCREMENT, address TEXT NOT NULL, version INTEGER NOT NULL, event TEXT NOT NULL);
        INSERT OR IGNORE INTO scriba_document_migrations(version) VALUES (1);`);
      if (db.prepare('SELECT MAX(version) AS version FROM scriba_document_migrations').get().version !== 1) fail('DOCUMENT_SCHEMA_TOO_NEW');
    })();
  }

  get(key) {
    const row = this.db.prepare('SELECT * FROM scriba_documents WHERE address=?').get(documentKey(key));
    return row ? { value:JSON.parse(row.value), version:row.version, schemaVersion:row.schema_version, updatedAt:row.updated_at } : null;
  }

  commit(key, input, { schemaVersion = 1, validate = () => {} } = {}) {
    const address = documentKey(key);
    const request = cloneDocument(input, this.limits);
    const { operationId, issuedAt, baseVersion, patches, author } = request;
    if (typeof operationId !== 'string' || !operationId || operationId.length > 128 ||
      !Number.isSafeInteger(baseVersion) || baseVersion < 0 || !Number.isSafeInteger(issuedAt) ||
      typeof author !== 'string' || !author || author.length > 512 || !Number.isSafeInteger(schemaVersion) || schemaVersion < 1) fail('INVALID_OPERATION');
    const fingerprint = createHash('sha256').update(canonical({ ...request, schemaVersion })).digest('hex');
    return this.db.transaction(() => {
      const duplicate = this.db.prepare('SELECT fingerprint,result FROM scriba_document_operations WHERE address=? AND operation_id=?').get(address, operationId);
      if (duplicate) {
        if (duplicate.fingerprint !== fingerprint) fail('OPERATION_ID_REUSED');
        return JSON.parse(duplicate.result);
      }
      const now = this.now();
      if (issuedAt > now + 60000 || issuedAt < now - this.dedupMs) fail('OPERATION_EXPIRED');
      const current = this.get(key);
      const version = current?.version ?? 0;
      if (current && current.schemaVersion !== schemaVersion) fail('SCHEMA_MIGRATION_REQUIRED');
      if (baseVersion > version || (!current && baseVersion !== 0)) fail('INVALID_VERSION');
      if (!Array.isArray(patches) || !patches.length || patches.length > 256) fail('INVALID_PATCHES');
      for (const patch of patches) {
        if (!patch || !['set','delete'].includes(patch.op) || !Array.isArray(patch.path) || patch.path.length > 64 ||
          patch.path.some(part => typeof part !== 'string' || forbidden.has(part) || part.length > 512)) fail('INVALID_PATH');
      }
      if (baseVersion < version) {
        if (patches.some(patch => !patch.path.length)) fail('CONFLICT');
        const history = this.db.prepare('SELECT version,paths FROM scriba_document_history WHERE address=? AND version>? ORDER BY version').all(address, baseVersion);
        if (history.length !== version - baseVersion || history[0]?.version !== baseVersion + 1) fail('RESYNC_REQUIRED');
        if (history.some(row => JSON.parse(row.paths).some(previous => patches.some(patch => overlap(previous,patch.path))))) fail('CONFLICT');
      }
      const value = applyDocumentPatches(current?.value ?? null, patches, this.limits);
      const validation = validate(cloneDocument(value, this.limits));
      if (validation === false) fail('SCHEMA_INVALID');
      if (validation?.then) fail('ASYNC_VALIDATION_UNSUPPORTED');
      const result = {value, version:version+1, schemaVersion, updatedAt:now};
      const paths = patches.map(p=>p.path);
      this.db.prepare(`INSERT INTO scriba_documents(address,value,version,schema_version,updated_at) VALUES(?,?,?,?,?)
        ON CONFLICT(address) DO UPDATE SET value=excluded.value,version=excluded.version,schema_version=excluded.schema_version,updated_at=excluded.updated_at`)
        .run(address,JSON.stringify(value),result.version,schemaVersion,now);
      this.db.prepare('INSERT INTO scriba_document_operations VALUES(?,?,?,?,?,?,?)')
        .run(address,operationId,fingerprint,result.version,JSON.stringify(paths),JSON.stringify(result),now);
      this.db.prepare('INSERT INTO scriba_document_history VALUES(?,?,?)').run(address,result.version,JSON.stringify(paths));
      const event = {key,version:result.version,operationId,author,paths,
        correlationId:request.correlationId ?? operationId,causationId:request.causationId ?? null};
      this.db.prepare('INSERT INTO scriba_document_outbox(address,version,event) VALUES(?,?,?)')
        .run(address,result.version,JSON.stringify(event));
      return result;
    }).immediate();
  }

  async drain(deliver, { limit = 100 } = {}) {
    if (this.draining) return;
    this.draining = true;
    try {
      const rows = this.db.prepare('SELECT id,event FROM scriba_document_outbox ORDER BY id LIMIT ?').all(limit);
      for (const row of rows) {
        await deliver(JSON.parse(row.event));
        this.db.prepare('DELETE FROM scriba_document_outbox WHERE id=?').run(row.id);
      }
    } finally { this.draining = false; }
  }

  compact({ history = 128 } = {}) {
    if (!Number.isSafeInteger(history) || history < 1) fail('INVALID_HISTORY_LIMIT');
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM scriba_document_history WHERE version <=
        (SELECT version - ? FROM scriba_documents WHERE address=scriba_document_history.address)`).run(history);
      this.db.prepare(`DELETE FROM scriba_document_operations WHERE accepted_at < ? AND NOT EXISTS
        (SELECT 1 FROM scriba_document_outbox o WHERE o.address=scriba_document_operations.address AND o.version=scriba_document_operations.version)`)
        .run(this.now()-this.dedupMs-60000);
    }).immediate();
  }
}
