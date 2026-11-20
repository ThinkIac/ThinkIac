import { describe, it, expect } from 'vitest';
import express from 'express';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { HttpPerformance, measurePhase, setPerformanceRoute } from '../src/kernel/http-performance';

describe('HTTP performance', () => {
  it('records finish once, groups by template, and retains no request secrets', async () => {
    const metrics = new HttpPerformance();
    const app = express();
    app.use(metrics.middleware);
    app.get('/records/:id', async (req, res) => {
      setPerformanceRoute(req, '/records/:id');
      await measurePhase(req, 'handler', async () => res.json({ ok: true }));
    });
    const server = app.listen(0, '127.0.0.1');
    try {
      await once(server, 'listening');
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const first = await fetch(`${base}/records/private-id?token=secret`);
      expect(await first.json()).toEqual({ ok: true });
      const second = await fetch(`${base}/records/another`);
      expect(await second.json()).toEqual({ ok: true });
      expect(first.headers.get('x-request-id')).toBeTruthy();
      const snapshot = metrics.snapshot();
      expect(snapshot.routes).toHaveLength(1);
      expect(snapshot.routes[0].count).toBe(2);
      expect(snapshot.routes[0].route).toBe('GET /records/:id');
      expect(JSON.stringify(snapshot)).not.toMatch(/private-id|secret|another/);
    } finally {
      metrics.close();
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
    }
  });
});
