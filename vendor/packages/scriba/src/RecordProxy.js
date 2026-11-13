// RecordProxy.js
class RecordProxy {
	constructor(table, row) {
		this._table = table;
		this._subscribers = [];
		this._cache = {};
		// assign raw values
		Object.assign(this, row);

		return new Proxy(this, {
			get: (t, p) => {
				if (typeof p === "symbol") return t[p];
				if (p === "toJSON") return () => this._toJSON();
				if (p === "subscribe") return this.subscribe.bind(this);

				if (p.startsWith && p.startsWith("_")) return t[p];

				// cache
				if (t._cache[p] !== undefined) return t._cache[p];

				// 1:N relations on parent table
				if (t._table._relations && t._table._relations[p]) {
					const rel = t._table._relations[p];
					// rel.table is child model name in lowercase or exact
					const relTable = t._table._scriba.tenant(t._table._tenantId).entity(rel.table);
					// prefer SQL query for current data (not only cache)
					const rows = relTable.query({ [rel.field]: t.id });
					t._cache[p] = rows;
					return rows;
				}

				// === N:N RELATION MANAGER === (Completo)
				if (t._table._nnRelations && t._table._nnRelations[p]) {
					const nn = t._table._nnRelations[p];
					const joinTable = t._table._scriba.tenant(t._table._tenantId).entity(nn.joinTable); 
					const relatedTable = t._table._scriba.tenant(t._table._tenantId).entity(nn.relatedTable); 

					const fetchRelatedRecords = () => {
						const links = joinTable.query({ [nn.leftKey]: t.id });
						const relatedIds = links.map(l => l[nn.rightKey]).filter(id => id !== null);
						// Filtra por undefined para ignorar registros relacionados que foram soft-deleted
						return relatedIds.map(id => relatedTable[id]).filter(r => r !== undefined); 
					};

					const relationManager = {
						
						get data() { return fetchRelatedRecords(); },
						
						[Symbol.iterator]: function* () {
								yield* fetchRelatedRecords();
							},

						connect: (relatedId) => {
							const data = {};
							data[nn.leftKey] = t.id;
							data[nn.rightKey] = relatedId;

							// Verifica se o link já existe para evitar erro de UNIQUE constraint
							const existing = joinTable.query({ [nn.leftKey]: t.id, [nn.rightKey]: relatedId });
							if (existing.length > 0) return true;

							const newLink = joinTable.push(data);
							
							delete t._cache[p];
							return newLink !== null;
						},

						disconnect: (relatedId) => {
							const links = joinTable.query({ [nn.leftKey]: t.id, [nn.rightKey]: relatedId, includeDeleted: true });
							
							if (links.length === 0) return true;

							const success = links.every(link => joinTable.delete(link.id)); 
							
							delete t._cache[p];
							return success;
						},
						
						ids: () => {
								const links = joinTable.query({ [nn.leftKey]: t.id });
								return links.map(l => l[nn.rightKey]).filter(id => id !== null);
							}
					};

					t._cache[p] = relationManager;
					return relationManager;
				}
				// ====================================

				// field conversions
				const field = t._table._fields.find(f => f.name === p);
				if (field) {
					const val = t[p];
					if (val == null) return null;
					if (field.type === "Json") {
						try { return JSON.parse(val); } catch (e) { return null; }
					}
					if (field.type === "DateTime") return new Date(val);
					if (field.type === "Boolean") return Boolean(val);
					return val;
				}

				// fallback property
				return t[p];
			},

			set: async (t, p, v) => { // Tornar setter async para hooks
				if (typeof p === "symbol") { t[p] = v; return true; }
				if (p.startsWith && p.startsWith("_")) { t[p] = v; return true; }

				const field = t._table._fields.find(f => f.name === p);
				if (!field) throw new Error(`Campo "${p}" não existe em ${t._table._modelName}`);

				// normalize via table
				const norm = t._table._normalizeValue(p, v);
				
				const updates = {};
				
				// 1. O campo principal sendo alterado
				t[p] = norm;
				updates[p] = norm;
				
				// 2. LÓGICA: Auto-update updatedAt
				if (p !== "updatedAt") {
					const updatedField = t._table._fields.find(f => f.name === "updatedAt");
					if (updatedField) {
						const now = new Date().toISOString();
						t["updatedAt"] = now; // Atualiza o objeto em memória
						updates["updatedAt"] = now; // Adiciona à lista de updates DB
					}
				}

				// Persiste (agora aceita múltiplos campos, otimizando o updatedAt)
				const success = await t._table._updateDB(t, updates);

				// Se o updateDB falhar (por ex., hook beforeUpdate retornou false), não notifica e não invalida o cache.
				if (!success) return false;

				// notify
				t._subscribers.forEach(cb => {
					try { cb(t); } catch (_) {}
				});

				// invalidate cache
				t._cache = {};
				return true;
			}
		});
	}

	subscribe(cb) {
		this._subscribers.push(cb);
		return () => {
			const idx = this._subscribers.indexOf(cb);
			if (idx >= 0) this._subscribers.splice(idx, 1);
		};
	}

	_toJSON() {
		const obj = {};
		for (const f of this._table._fields) {
			obj[f.name] = this[f.name];
		}
		// include id if not in fields explicitly
		if (!obj.id && this.id) obj.id = this.id;
		return obj;
	}
}

export default RecordProxy;