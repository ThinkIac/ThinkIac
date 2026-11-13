// plugins/Express/StudioAPI.js
import express from "express";

import _prisma from '@prisma/internals';
const { getDMMF } = _prisma;

export default function StudioAPI(scriba, tenantId, prismaSchema) {
  const router = express.Router();
  router.use(express.json());

  const tenant = scriba.tenant(tenantId);

  router.get("/meta", async (req, res) => {
    try {
      const dmmf = await getDMMF({ datamodel: prismaSchema });
      const schema = {};

      dmmf.datamodel.models.forEach(model => {
        schema[model.name] = model.fields.map(f => {
          let relationTo = null;
          let relationIsMany = false;

          if (f.relationName) {
            // Campo faz parte de uma relação
            relationTo = f.type;
            relationIsMany = f.isList;
          }

          return {
            name: f.name,
            type: f.type,
            isId: f.isId,
            isList: f.isList,
            isOptional: !f.isRequired,
            relationTo,
            relationIsMany
          };
        });
      });

      res.json(schema);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // 1️⃣ List tenants
  router.get("/tenants", (req, res) => {
    try {
      const tenants = scriba.tenants();
      res.json(tenants);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 2️⃣ List tables/models for a tenant
  router.get("/tenants/:tenantId/tables", (req, res) => {
    try {
      const { tenantId } = req.params;
      const tables = Object.keys(scriba._tenants[tenantId]?.tables || {});
      res.json(tables);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 3️⃣ List records for a table
  router.get("/tenants/:tenantId/tables/:table", (req, res) => {
    try {
      const { tenantId, table } = req.params;
      const tbl = scriba.tenant(tenantId).entity(table);
      const rows = tbl.all().map(r => r.toJSON());
      res.json(rows);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // 4️⃣ CRUD endpoints
  router.get("/tenants/:tenantId/tables/:table/:id", (req, res) => {
    try {
      const { tenantId, table, id } = req.params;
      const rec = scriba.tenant(tenantId).entity(table)[id];
      if (!rec) return res.status(404).json({ error: "Not found" });
      res.json(rec.toJSON());
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post("/tenants/:tenantId/tables/:table", (req, res) => {
    try {
      const { tenantId, table } = req.params;
      const tbl = scriba.tenant(tenantId).entity(table);
      const rec = tbl.push(req.body);
      res.json(rec.toJSON());
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.patch("/tenants/:tenantId/tables/:table/:id", (req, res) => {
    try {
      const { tenantId, table, id } = req.params;
      const rec = scriba.tenant(tenantId).entity(table)[id];
      if (!rec) return res.status(404).json({ error: "Not found" });
      for (const [k, v] of Object.entries(req.body)) rec[k] = v;
      res.json(rec.toJSON());
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete("/tenants/:tenantId/tables/:table/:id", (req, res) => {
    try {
      const { tenantId, table, id } = req.params;
      const ok = scriba.tenant(tenantId).entity(table).delete(id);
      res.json({ ok });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // 5️⃣ Relations (1:N e N:N)
  router.get("/tenants/:tenantId/tables/:table/:id/:relation", (req, res) => {
    try {
      const { tenantId, table, id, relation } = req.params;
      const tbl = scriba.tenant(tenantId).entity(table);
      const rec = tbl[id];
      if (!rec) return res.status(404).json({ error: "Not found" });

      const related = rec[relation]; // Proxy já resolve relações 1:N e N:N
      res.json(related.map(r => r.toJSON()));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}
