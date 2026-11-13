// Scriba.js
import Database from "better-sqlite3";
import pluralize from "pluralize";
import chokidar from "chokidar";

import TableProxy from "./TableProxy.js";
import { loadPrismaModels } from "./parser/Prisma.js";
import RecordProxy from "./RecordProxy.js";
import { DocumentStore } from './documents.js';

const { singular } = pluralize;

class TenantProxy {
  constructor(scriba, tenantId) {
    this._scriba = scriba;
    this._tenantId = tenantId;
  }
  entity(name) {
    return this._scriba.entity(name, this._tenantId);
  }
}

function mapPrismaToSQLite(type, enums) {
  if (enums && enums[type]) return "TEXT";
  switch (type) {
    case "Int": return "INTEGER";
    case "Float": return "REAL";
    case "Boolean": return "INTEGER";
    case "DateTime": return "TEXT";
    case "Json": return "TEXT";
    case "String":
    default: return "TEXT";
  }
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function uniqueIndexName(modelName, fields) {
  const encode = value => {
    const safe = String(value).replace(/[^A-Za-z0-9_]/g, '_');
    return `${safe.length}_${safe}`;
  };
  return `uq_${[modelName, ...fields].map(encode).join('_')}`;
}

class Scriba {
  constructor(tenantPaths = []) {
    this._tenants = {};
    this._schemaReloads = new Map();
    tenantPaths.forEach(({ id, path, schema }) => {
      this.addTenant({ id, path, schema });
    });

    // Injeta globals automágicos
    this._injectGlobals();
  }

  // === Adicionar tenant em runtime ===
  addTenant({ id, path, schema, databaseFactory, watchSchema = true }) {
    if (this._tenants[id]) throw new Error(`Tenant ${id} já existe`);

    const db = databaseFactory ? databaseFactory(path, id) : new Database(path);
    this._tenants[id] = { db, tables: {}, schemaPath: schema };

    if (schema) {
      this.loadSchema(id, schema);
      if (watchSchema) this._watchSchema(id, schema);
    }

    console.log(`[${id}] Tenant adicionado com sucesso!`);
  }

  tenant(id) {
    if (!this._tenants[id]) throw Error(`Tenant ${id} não encontrado`);
    return new TenantProxy(this, id);
  }

  _watchSchema(tenantId, schemaPath) {
    const watcher = chokidar.watch(schemaPath, { ignoreInitial: true, ignored: (path, stats) => {
        if (stats && stats.isFile() && !path.endsWith('.prisma')) {
          return true; 
        }
        return false;
      } });
    watcher.on("change", () => {
      console.log(`[${tenantId}] Schema alterado! Reloading...`);
      this.reloadTenantSchema(tenantId, schemaPath).catch(error => {
        console.error(`[${tenantId}] Schema reload failed: ${error.message}`);
      });
    });
    this._tenants[tenantId].schemaWatcher = watcher;
  }

  /**
   * Reaplica um schema sem substituir a conexão do tenant. Recargas do mesmo
   * tenant são serializadas e a transação SQLite evita uma estrutura parcial.
   */
  reloadTenantSchema(tenantId, schemaPath) {
    const previous = this._schemaReloads.get(tenantId) || Promise.resolve();
    const reload = previous.catch(() => undefined).then(() => {
      const tenant = this._tenants[tenantId];
      if (!tenant) throw new Error(`Tenant ${tenantId} não encontrado`);
      const previousTables = tenant.tables;
      try {
        // Rebuild the runtime catalog from the candidate schema. SQLite remains
        // additive, but removed fragments must stop exposing stale models and
        // fields through the tenant proxy.
        tenant.tables = {};
        const apply = tenant.db.transaction(() => this.loadSchema(tenantId, schemaPath));
        apply();
        tenant.schemaPath = schemaPath;
        return { tenantId, schemaPath, models: Object.keys(tenant.tables) };
      } catch (error) {
        tenant.tables = previousTables;
        throw error;
      }
    });
    this._schemaReloads.set(tenantId, reload);
    reload.finally(() => {
      if (this._schemaReloads.get(tenantId) === reload) this._schemaReloads.delete(tenantId);
    }).catch(() => undefined);
    return reload;
  }

  loadSchema(tenantId, schemaPath) {
    const t = this._tenants[tenantId];
    if (!t) throw new Error(`Tenant ${tenantId} não encontrado`);

    const { models, enums } = loadPrismaModels(schemaPath);

    for (const [modelName, def] of Object.entries(models)) {
      const hasId = def.fields.some(f => f.isId || f.name === "id");
      if (!hasId) {
        def.fields.unshift({
          name: "id",
          type: "String",
          isList: false,
          isOptional: false,
          isId: true,
          default: "uuid()",
          rawAttributes: [],
          relation: null
        });
      } else {
        for (const f of def.fields) {
          if (f.name === "id" && !f.isId) f.isId = true;
        }
      }

      // Auditoria
      const defaultAuditFields = [
        { name: 'createdAt', type: 'DateTime', isList: false, isOptional: false, isRequired: true, rawAttributes: [] },
        { name: 'updatedAt', type: 'DateTime', isList: false, isOptional: false, isRequired: true, rawAttributes: [] },
        { name: 'deletedAt', type: 'DateTime', isList: false, isOptional: true, isNullable: true, rawAttributes: [] },
      ];
      for (const dField of defaultAuditFields) {
        const exists = def.fields.some(f => f.name === dField.name);
        if (!exists) def.fields.push(dField);
      }
    }

    // Cria tabelas SQLite
    for (const [modelName, def] of Object.entries(models)) {
      const fields = def.fields;
      const columnsSQL = fields.map(f => {
        const colType = mapPrismaToSQLite(f.type, enums);
        let colDef = `\"${f.name}\" ${colType}`;
        if (f.isId && f.type === "Int") colDef += " PRIMARY KEY";
        else if (f.isId && f.type === "String") colDef += " UNIQUE";

        if (enums && enums[f.type]) {
          const allowed = enums[f.type].map(v => `'${v.replace("'", "''")}'`).join(",");
          colDef += ` CHECK (${f.name} IN (${allowed}))`;
        }
        if (!f.isOptional && f.name !== 'deletedAt') colDef += " NOT NULL";
        return colDef;
      }).join(", ");

      t.db.prepare(`CREATE TABLE IF NOT EXISTS \"${modelName}\" (${columnsSQL})`).run();

      // Adiciona colunas faltantes
      const existing = t.db.prepare(`PRAGMA table_info(\"${modelName}\")`).all().map(c => c.name);
      for (const f of fields) {
        if (!existing.includes(f.name)) {
          const colType = mapPrismaToSQLite(f.type, enums);
          let colDef = `\"${f.name}\" ${colType}`;
          if (!f.isOptional && f.name !== 'deletedAt') colDef += " NOT NULL DEFAULT ''";
          t.db.prepare(`ALTER TABLE \"${modelName}\" ADD COLUMN ${colDef}`).run();
        }
      }

      this._createUniqueIndexes(t.db, modelName, def);

      // Cria TableProxy
      t.tables[modelName.toLowerCase()] = new TableProxy(t.db, modelName, def.fields, this, tenantId);
    }

    // Detecta relações
    for (const [modelName, def] of Object.entries(models)) {
      const table = t.tables[modelName.toLowerCase()];
      for (const f of def.fields) {
        if (f.name.endsWith("Id") && f.name !== "id") {
          const parentTableName = f.name.slice(0, -2).toLowerCase();
          const parentTable = t.tables[parentTableName] || t.tables[parentTableName + "s"];
          if (parentTable) {
            parentTable._relations = parentTable._relations || {};
            const relName = singular(table._modelName.toLowerCase());
            parentTable._relations[relName] = { table: table._modelName.toLowerCase(), field: f.name };
            table._parentField = f.name;
          }
        }
      }
    }

    console.log(`[${tenantId}] Schema loaded: models=${Object.keys(models).join(", ")}, enums=${Object.keys(enums).join(", ")}`);
  }

  /**
   * Enforces Prisma @unique and @@unique through SQLite indexes. All Scriba
   * models have soft deletion, so a deleted record intentionally stops
   * reserving its unique values.
   */
  _createUniqueIndexes(db, modelName, def) {
    const seen = new Set();
    for (const constraint of def.uniqueConstraints || []) {
      const fields = constraint.fields || [];
      if (!fields.length || fields.some(field => !def.fields.some(item => item.name === field))) continue;

      const signature = fields.join('\u0000');
      if (seen.has(signature)) continue;
      seen.add(signature);

      const indexName = uniqueIndexName(modelName, fields);
      const columns = fields.map(quoteIdentifier).join(', ');
      const activeOnly = def.fields.some(field => field.name === 'deletedAt');
      const where = activeOnly ? ` WHERE ${quoteIdentifier('deletedAt')} IS NULL` : '';
      try {
        db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS ${quoteIdentifier(indexName)} ON ${quoteIdentifier(modelName)} (${columns})${where}`).run();
      } catch (error) {
        if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          throw new Error(`Cannot enforce unique constraint ${modelName}(${fields.join(', ')}): active duplicate records exist. Resolve duplicates before applying this schema.`);
        }
        throw error;
      }
    }
  }

  /** Returns active duplicate groups before a schema migration is applied. */
  inspectUniqueConflicts(tenantId, modelName, fields) {
    const tenant = this._tenants[tenantId];
    if (!tenant) throw new Error(`Tenant ${tenantId} not found`);
    if (!Array.isArray(fields) || !fields.length) throw new Error('At least one unique field is required');
    const columns = fields.map(quoteIdentifier).join(', ');
    const active = tenant.db.prepare(`PRAGMA table_info(${quoteIdentifier(modelName)})`).all().some(column => column.name === 'deletedAt');
    const where = active ? ` WHERE ${quoteIdentifier('deletedAt')} IS NULL` : '';
    return tenant.db.prepare(`SELECT ${columns}, COUNT(*) AS count FROM ${quoteIdentifier(modelName)}${where} GROUP BY ${columns} HAVING COUNT(*) > 1`).all();
  }

  entity(name, tenantId) {
    const tenant = this._tenants[tenantId];
    if (!tenant) console.log(tenantId) // throw Error(`Tenant ${tenantId} não encontrado`);
    return tenant.tables[name.toLowerCase()];
  }

  // Optional document API. Reuses the tenant's existing connection (including
  // databaseFactory/private databases) and never invokes Prisma provisioning.
  documents(tenantId) {
    const tenant = this._tenants[tenantId];
    if (!tenant) throw new Error(`Tenant ${tenantId} não encontrado`);
    if (!tenant.documents) tenant.documents = new DocumentStore(tenant.db);
    return tenant.documents;
  }

  tenants() {
    return Object.keys(this._tenants);
  }

  // =========================================
  // INJEÇÃO GLOBAL AUTOMÁTICA, COMPATÍVEL
  _injectGlobals() {
    for (const tenantId of Object.keys(this._tenants)) {
      if (globalThis[tenantId]) continue; // não sobrescreve se já existe

      const tenantProxy = new Proxy({}, {
        get: (target, entityName) => {
          if (!entityName) return undefined;
          const table = this.entity(entityName, tenantId);
          if (!table) return undefined;

          // Proxy da entidade
          return new Proxy(table, {
            get(entTarget, prop) {
              if (prop === "query") return entTarget.query.bind(entTarget);
              if (prop === "push") return entTarget.push.bind(entTarget);

              // Se prop for numérico -> retorna RecordProxy
              if (!isNaN(prop)) {
                const row = entTarget.query({ id: prop }).pop() || {};
                return new RecordProxy(entTarget, row);
              }

              return entTarget[prop];
            }
          });
        }
      });

      globalThis[tenantId] = tenantProxy;
    }
  }
}

export default Scriba;
