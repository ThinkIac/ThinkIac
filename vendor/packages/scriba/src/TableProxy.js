import RecordProxy from "./RecordProxy.js";
import { randomUUID } from "crypto";

class TableProxy {
	constructor(db, modelName, fields, scriba, tenantId) {
		this._db = db;
		this._modelName = modelName;
		this._fields = fields;
		this._records = {};
		this._relations = {};
		this._nnRelations = {};
		this._scriba = scriba;
		this._tenantId = tenantId;
		this._stmtCache = {};
		this._hooks = {
			beforeCreate: [],
			afterCreate: [],
			beforeUpdate: [],
			afterUpdate: [],
			beforeDelete: [],
			afterDelete: []
		};

		return new Proxy(this, {
			get: (t, p) => {
				if (typeof p === "symbol") return t[p];
				if (p in t) return t[p];

				const key = String(p);
				if (t._records[key]) return t._records[key];

				let sql = `SELECT * FROM "${t._modelName}" WHERE id = ?`;
				if (t._hasSoftDelete()) sql += ` AND deletedAt IS NULL`;
				const row = t._db.prepare(sql).get(key);
				if (row) {
					const rec = new RecordProxy(t, row);
					t._records[row.id] = rec;
					return rec;
				}
				return undefined;
			},
			deleteProperty: (t, p) => {
				return t.delete(p);
			}
		});
	}

	addHook(type, callback) {
		if (!this._hooks[type]) throw new Error(`Tipo de hook inválido: ${type}`);
		this._hooks[type].push(callback);
	}

	_hasSoftDelete() {
		return this._fields.some(f => f.name === "deletedAt");
	}

	_normalizeValue(fieldName, value) {
		const field = this._fields.find(f => f.name === fieldName);
		if (!field) return value;
		if (value == null) return null;
		if (field.type === "DateTime" && value === "") return "";
		switch (field.type) {
			case "Int": return Number.isFinite(Number(value)) ? Number(value) : null;
			case "Float": return parseFloat(value);
			case "Boolean": return value ? 1 : 0;
			case "DateTime": {
				const date = new Date(value);
				if (isNaN(date.getTime())) throw new Error(`Invalid Date value for ${fieldName}: ${value}`);
				return date.toISOString();
			}
			case "Json": return JSON.stringify(value);
			case "String":
			default:
				return String(value);
		}
	}

	/**
	 * better-sqlite3 só aceita number, string, bigint, buffer e null como bind.
	 * Boolean e DateTime são tipos legítimos do schema (viram INTEGER e TEXT no
	 * SQLite), então o WHERE precisa convertê-los do mesmo jeito que o INSERT
	 * converte — senão `query({ completed: true })` estoura em vez de filtrar.
	 */
	_bindValue(fieldName, value) {
		if (value === undefined || value === null) return null;
		if (typeof value === "boolean") return value ? 1 : 0;
		if (value instanceof Date) {
			if (isNaN(value.getTime())) throw new Error(`Invalid Date value for ${fieldName}: ${value}`);
			return value.toISOString();
		}
		if (typeof value === "number" || typeof value === "string" || typeof value === "bigint") return value;
		if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) return value;
		if (value instanceof Uint8Array) return value;

		// Objeto/array só faz sentido contra coluna Json, que guarda o texto serializado.
		const field = this._fields.find(f => f.name === fieldName);
		if (field && field.type === "Json") return JSON.stringify(value);
		return String(value);
	}

	_applyRules(recordOrData, isUpdate = false) {
		const tenant = this._scriba.tenant(this._tenantId);
		const table = tenant.entity(this._modelName);
		if (table.rules && Array.isArray(table.rules)) {
			for (const rule of table.rules) {
				const res = rule(recordOrData, isUpdate, recordOrData.id);
				if (res === false) throw new Error(`Validation rule failed on ${this._modelName}`);
			}
		}
	}

	async _updateDB(record, updates) {
		this._applyRules(record, true);

		let data = { ...updates };
		for (const hook of this._hooks.beforeUpdate) {
			try {
				const res = await hook(record, data);
				if (res && typeof res === "object") data = res;
				if (res === false) return false;
			} catch (e) { console.error(`beforeUpdate Hook falhou: ${e.message}`); return false; }
		}

		const finalUpdates = data;
		const finalUpdateKeys = Object.keys(finalUpdates).filter(k => k !== "id");
		if (finalUpdateKeys.length === 0) return true;

		const setClauses = finalUpdateKeys.map(k => `"${k}" = ?`).join(", ");
		const values = finalUpdateKeys.map(k => finalUpdates[k]);
		values.push(record.id);

		const info = this._db.prepare(`UPDATE "${this._modelName}" SET ${setClauses} WHERE id = ?`).run(...values);

		if (info.changes > 0) {
			for (const hook of this._hooks.afterUpdate) {
				try { await hook(record, finalUpdates); } catch (e) { console.error(`afterUpdate Hook falhou: ${e.message}`); }
			}
		}
		return info.changes > 0;
	}

	// ── Query ──────────────────────────────────────────────────────────────────
	//
	// Supported condition operators:
	//   field: value         → field = value  (exact match)
	//   field: { $gt: v }    → field > v
	//   field: { $gte: v }   → field >= v
	//   field: { $lt: v }    → field < v
	//   field: { $lte: v }   → field <= v
	//   field: { $ne: v }    → field != v
	//   field: { $in: [..] } → field IN (...)
	//   field: { $like: v }  → field LIKE v   (use % wildcards in value)
	//   field: { $null: true/false } → field IS NULL / IS NOT NULL
	//
	// Options:
	//   sort: 'field ASC' | 'field DESC'
	//   limit: number
	//   offset: number
	//   includeDeleted: boolean  (soft-delete tables only)

	query(conditions = {}, options = {}) {
		let sql = `SELECT * FROM "${this._modelName}"`;
		const params = [];
		const whereClauses = [];

		if (this._hasSoftDelete() && !options.includeDeleted) {
			whereClauses.push("deletedAt IS NULL");
		}

		for (const [k, val] of Object.entries(conditions)) {
			if (k === "includeDeleted") continue;
			// Date é `typeof object`, mas é um valor escalar — tratar como operador
			// transformaria `{ endedAt: new Date() }` num WHERE vazio.
			if (typeof val === "object" && val !== null && !(val instanceof Date)) {
				if ("$gt"   in val) { params.push(this._bindValue(k, val.$gt));  whereClauses.push(`"${k}" > ?`);   }
				if ("$gte"  in val) { params.push(this._bindValue(k, val.$gte)); whereClauses.push(`"${k}" >= ?`);  }
				if ("$lt"   in val) { params.push(this._bindValue(k, val.$lt));  whereClauses.push(`"${k}" < ?`);   }
				if ("$lte"  in val) { params.push(this._bindValue(k, val.$lte)); whereClauses.push(`"${k}" <= ?`);  }
				if ("$ne"   in val) { params.push(this._bindValue(k, val.$ne));  whereClauses.push(`"${k}" != ?`);  }
				if ("$like" in val) { params.push(this._bindValue(k, val.$like)); whereClauses.push(`"${k}" LIKE ?`); }
				if ("$in"   in val) {
					if (!Array.isArray(val.$in) || val.$in.length === 0) {
						whereClauses.push("1 = 0"); // empty $in → no results
					} else {
						const placeholders = val.$in.map(() => "?").join(", ");
						params.push(...val.$in.map(item => this._bindValue(k, item)));
						whereClauses.push(`"${k}" IN (${placeholders})`);
					}
				}
				if ("$null" in val) {
					whereClauses.push(val.$null ? `"${k}" IS NULL` : `"${k}" IS NOT NULL`);
				}
			} else {
				params.push(this._bindValue(k, val));
				whereClauses.push(`"${k}" = ?`);
			}
		}

		if (whereClauses.length) sql += ` WHERE ${whereClauses.join(" AND ")}`;
		if (options.sort) {
			const [sortField, sortDir] = options.sort.trim().split(/\s+/);
			sql += ` ORDER BY "${sortField}" ${/^desc$/i.test(sortDir) ? "DESC" : "ASC"}`;
		}
		if (options.limit)  sql += ` LIMIT ${options.limit}`;
		if (options.offset) sql += ` OFFSET ${options.offset}`;

		const rows = this._db.prepare(sql).all(...params);
		return rows.map(r => {
			if (!this._records[r.id]) this._records[r.id] = new RecordProxy(this, r);
			return this._records[r.id];
		});
	}

	// ── Convenience finders ────────────────────────────────────────────────────

	/** Returns the record with the given id, or undefined if not found. */
	findById(id) {
		const key = String(id);
		if (this._records[key]) return this._records[key];

		let sql = `SELECT * FROM "${this._modelName}" WHERE id = ?`;
		if (this._hasSoftDelete()) sql += ` AND deletedAt IS NULL`;
		const row = this._db.prepare(sql).get(key);
		if (!row) return undefined;

		const rec = new RecordProxy(this, row);
		this._records[row.id] = rec;
		return rec;
	}

	/** Returns the first record matching conditions, or undefined. */
	findOne(conditions = {}, options = {}) {
		const results = this.query(conditions, { ...options, limit: 1 });
		return results[0];
	}

	/** Returns the total number of records matching conditions. */
	count(conditions = {}) {
		let sql = `SELECT COUNT(*) as n FROM "${this._modelName}"`;
		const params = [];
		const whereClauses = [];

		if (this._hasSoftDelete()) whereClauses.push("deletedAt IS NULL");

		for (const [k, val] of Object.entries(conditions)) {
			if (typeof val === "object" && val !== null && !(val instanceof Date)) {
				if ("$in" in val) {
					if (!Array.isArray(val.$in) || val.$in.length === 0) {
						whereClauses.push("1 = 0");
					} else {
						params.push(...val.$in.map(item => this._bindValue(k, item)));
						whereClauses.push(`"${k}" IN (${val.$in.map(() => "?").join(", ")})`);
					}
				} else if ("$null" in val) {
					whereClauses.push(val.$null ? `"${k}" IS NULL` : `"${k}" IS NOT NULL`);
				} else if ("$gt" in val) { params.push(this._bindValue(k, val.$gt)); whereClauses.push(`"${k}" > ?`); }
				else if ("$lt" in val)   { params.push(this._bindValue(k, val.$lt)); whereClauses.push(`"${k}" < ?`); }
			} else {
				params.push(this._bindValue(k, val));
				whereClauses.push(`"${k}" = ?`);
			}
		}

		if (whereClauses.length) sql += ` WHERE ${whereClauses.join(" AND ")}`;
		const row = this._db.prepare(sql).get(...params);
		return row?.n ?? 0;
	}

	// ── upsert ─────────────────────────────────────────────────────────────────
	//
	// Finds the first record matching `where`. If found, updates it with `data`.
	// If not found, creates a new record merging `where` + `data`.
	//
	// Returns the record (always, never null).

	async upsert(where = {}, data = {}) {
		const existing = this.findOne(where);
		if (existing) {
			for (const [k, v] of Object.entries(data)) {
				existing[k] = v;
			}
			return existing;
		}
		return this.push({ ...where, ...data });
	}

	// ── all ────────────────────────────────────────────────────────────────────

	all(includeDeleted = false) {
		let sql = `SELECT * FROM "${this._modelName}"`;
		if (this._hasSoftDelete() && !includeDeleted) sql += ` WHERE deletedAt IS NULL`;
		const rows = this._db.prepare(sql).all();
		return rows.map(r => {
			if (!this._records[r.id]) this._records[r.id] = new RecordProxy(this, r);
			return this._records[r.id];
		});
	}

	// ── delete ─────────────────────────────────────────────────────────────────

	async delete(id) {
		const idStr = String(id);

		for (const hook of this._hooks.beforeDelete) {
			try {
				const res = await hook(idStr);
				if (res === false) return false;
			} catch (e) { console.error(`beforeDelete Hook falhou: ${e.message}`); return false; }
		}

		let info;
		if (this._hasSoftDelete()) {
			const now = new Date().toISOString();
			info = this._db.prepare(`UPDATE "${this._modelName}" SET deletedAt = ? WHERE id = ?`).run(now, idStr);
		} else {
			info = this._db.prepare(`DELETE FROM "${this._modelName}" WHERE id = ?`).run(idStr);
		}
		delete this._records[idStr];

		const success = info.changes > 0;
		if (success) {
			for (const hook of this._hooks.afterDelete) {
				try { await hook(idStr); } catch (e) { console.error(`afterDelete Hook falhou: ${e.message}`); }
			}
		}
		return success;
	}

	// ── push ───────────────────────────────────────────────────────────────────

	async push(data = {}) {
		this._applyRules(data, false);

		const idField = this._fields.find(f => f.isId);
		const nowISO = new Date().toISOString();

		// Run beforeCreate hooks — they can mutate data or abort (return false)
		let mutableData = { ...data };
		for (const hook of this._hooks.beforeCreate) {
			try {
				const res = await hook(mutableData);
				if (res === false) return null;
				if (res && typeof res === "object") mutableData = res;
			} catch (e) { console.error(`beforeCreate Hook falhou: ${e.message}`); return null; }
		}

		const validated = {};
		for (const field of this._fields) {
			let v = mutableData[field.name];
			const isAuditField = field.name === "createdAt" || field.name === "updatedAt";
			if (isAuditField) {
				v = v ?? nowISO;
			} else if (v === undefined || v === null) {
				if (!field.isId && !field.isOptional && field.name !== "deletedAt") {
					v = field.type === "Int" || field.type === "Float" || field.type === "Boolean" ? 0 : "";
				} else {
					v = null;
				}
			}
			if (field.isId && (v === null || v === undefined)) {
				v = field.type === "String" ? randomUUID() : null;
			}
			validated[field.name] = this._normalizeValue(field.name, v);
		}

		const keys = Object.keys(validated);
		const vals = keys.map(k => validated[k]);
		const fieldsStr = keys.map(k => `"${k}"`).join(", ");
		const placeholders = keys.map(() => "?").join(", ");

		const stmt = this._db.prepare(`INSERT INTO "${this._modelName}" (${fieldsStr}) VALUES (${placeholders})`);
		const info = stmt.run(...vals);

		let newId = validated.id ?? (idField?.type === "Int" ? info.lastInsertRowid : validated.id);
		validated.id = newId;

		const rec = new RecordProxy(this, validated);
		this._records[String(newId)] = rec;

		for (const hook of this._hooks.afterCreate) {
			try { await hook(rec); } catch (e) { console.error(`afterCreate Hook falhou: ${e.message}`); }
		}

		return rec;
	}

	// ── legacy array-style helpers ─────────────────────────────────────────────

	find(predicate) { return Object.values(this._records).find(predicate); }
	filter(predicate) { return Object.values(this._records).filter(predicate); }
}

export default TableProxy;