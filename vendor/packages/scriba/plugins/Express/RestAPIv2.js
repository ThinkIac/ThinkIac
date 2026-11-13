import express from "express";

export default function ExpressRestAPIv2(scriba, tenantId) {
  const router = express.Router();
  router.use(express.json());

  const tenant = scriba.tenant(tenantId);

  function paginate(array, page = 1, pageSize = 10) {
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    return {
      page,
      pageSize,
      total: array.length,
      next: end < array.length ? page + 1 : null,
      data: array.slice(start, end)
    };
  }

  router.get("/v2/", (req, res) => {
    try {
      const names = Object.keys(scriba._tenants[tenantId].tables);
      res.json({ models: names });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/v2/:entity", (req, res) => {
    try {
      const { entity } = req.params;
      const { page, pageSize } = req.query;
      const table = tenant.entity(entity);
      const rows = table.all().map(r => r.toJSON());
      res.json(paginate(rows, Number(page) || 1, Number(pageSize) || 10));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get("/v2/:entity/:id", (req, res) => {
    try {
      const { entity, id } = req.params;
      const rec = tenant.entity(entity)[id];
      if (!rec) return res.status(404).json({ error: "Not found" });
      res.json(rec.toJSON());
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post("/v2/:entity", (req, res) => {
    try {
      const { entity } = req.params;
      const rec = tenant.entity(entity).push(req.body);
      res.json(rec.toJSON());
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.patch("/v2/:entity/:id", (req, res) => {
    try {
      const { entity, id } = req.params;
      const rec = tenant.entity(entity)[id];
      if (!rec) return res.status(404).json({ error: "Not found" });
      Object.assign(rec, req.body);
      res.json(rec.toJSON());
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete("/v2/:entity/:id", (req, res) => {
    try {
      const { entity, id } = req.params;
      const ok = tenant.entity(entity).delete(id);
      res.json({ ok });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get("/v2/:entity/:id/:relation", (req, res) => {
    try {
      const { entity, id, relation } = req.params;
      const rec = tenant.entity(entity)[id];
      if (!rec) return res.status(404).json({ error: "Not found" });
      const related = rec[relation];
      res.json(Array.isArray(related) ? related.map(r => r.toJSON()) : []);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post("/v2/:entity/:id/:relation", (req, res) => {
    try {
      const { entity, id, relation } = req.params;
      const rec = tenant.entity(entity)[id];
      if (!rec) return res.status(404).json({ error: "Not found" });
      const relTable = rec._relations && rec._relations[relation] ? tenant.entity(rec._relations[relation].table) : null;
      if (!relTable) return res.status(404).json({ error: "Relation not found" });
      const body = Object.assign({}, req.body);
      if (rec._relations[relation].field) body[rec._relations[relation].field] = rec.id;
      const created = relTable.push(body);
      res.json(created.toJSON());
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}