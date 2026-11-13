// scriba-rest.js
import express from "express";

export default function ExpressRestAPI(scriba, tenantId) {
  const router = express.Router();
  router.use(express.json());

  const tenant = scriba.tenant(tenantId);

  // list models (optional)
  router.get("/", (req, res) => {
    try {
      const names = Object.keys(scriba._tenants[tenantId].tables);
      res.json({ models: names });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.get("/:entity", (req, res) => {
    try {
      const { entity } = req.params;
      const table = tenant.entity(entity);
      const rows = table.all();
      res.json(rows.map(r => r.toJSON()));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.get("/:entity/:id", (req, res) => {
    try {
      const { entity, id } = req.params;
      const table = tenant.entity(entity);
      const rec = table[id];
      if (!rec) return res.status(404).json({ error: "Not found" });
      res.json(rec.toJSON());
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.post("/:entity", (req, res) => {
    try {
      const { entity } = req.params;
      const table = tenant.entity(entity);
      const created = table.push(req.body);
      res.json(created.toJSON);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.patch("/:entity/:id", (req, res) => {
    try {
      const { entity, id } = req.params;
      const table = tenant.entity(entity);
      const rec = table[id];
      if (!rec) return res.status(404).json({ error: "Not found" });
      for (const [k, v] of Object.entries(req.body)) rec[k] = v;
      res.json(rec.toJSON);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.delete("/:entity/:id", (req, res) => {
    try {
      const { entity, id } = req.params;
      const table = tenant.entity(entity);
      const ok = table.delete(id);
      res.json({ ok });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // relation GET: parent -> children
  router.get("/:entity/:id/:relation", (req, res) => {
    try {
      const { entity, id, relation } = req.params;
      const table = tenant.entity(entity);
      const rec = table[id];
      if (!rec) return res.status(404).json({ error: "Not found" });
      if (!table._relations || !table._relations[relation]) return res.status(404).json({ error: "Relation not found" });
      const relInfo = table._relations[relation];
      const relTable = tenant.entity(relInfo.table);
      const rows = relTable.query({ [relInfo.field]: rec.id });
      res.json(rows.map(r => r.toJSON()));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // relation POST: create child and set FK
  router.post("/:entity/:id/:relation", (req, res) => {
    try {
      const { entity, id, relation } = req.params;
      const table = tenant.entity(entity);
      const rec = table[id];
      if (!rec) return res.status(404).json({ error: "Not found" });
      if (!table._relations || !table._relations[relation]) return res.status(404).json({ error: "Relation not found" });
      const relInfo = table._relations[relation];
      const relTable = tenant.entity(relInfo.table);
      const body = Object.assign({}, req.body);
      body[relInfo.field] = rec.id;
      const created = relTable.push(body);
      res.json(created.toJSON());
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  return router;
}
