import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { HttpPerformance, measurePhase, setPerformanceRoute } from '../src/kernel/http-performance';

describe('HTTP performance', () => {
  it('records finish once, groups by template, and retains no request secrets', async () => {
    const metrics = new HttpPerformance();
    try {
      const app = express(); app.use(metrics.middleware);
      app.get('/records/:id', async (req, res) => {
        setPerformanceRoute(req, '/records/:id');
        await measurePhase(req, 'handler', async () => res.json({ ok: true }));
      });
      const first = await request(app).get('/records/private-id?token=secret');
      await request(app).get('/records/another');
      expect(first.headers['x-request-id']).toBeTruthy();
      const snapshot = metrics.snapshot();
      expect(snapshot.routes).toHaveLength(1);
      expect(snapshot.routes[0].count).toBe(2);
      expect(snapshot.routes[0].route).toBe('GET /records/:id');
      expect(JSON.stringify(snapshot)).not.toMatch(/private-id|secret|another/);
    } finally { metrics.close(); }
  });
});
