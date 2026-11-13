import { randomUUID } from 'crypto';
import { monitorEventLoopDelay, performance } from 'perf_hooks';

const timing = Symbol('logos.httpTiming');
const MAX_ROUTES = 512;
const MAX_SAMPLES = 256;
type Sample = { total: number; phases: Record<string, number>; status: number; aborted: boolean };

/** Bounded, in-memory observations. No URLs, request bodies or identities are retained. */
export class HttpPerformance {
  private routes = new Map<string, { count: number; errors: number; aborted: number; samples: Sample[]; cursor: number }>();
  private delay = monitorEventLoopDelay({ resolution: 20 });
  private started = Date.now();
  constructor() { this.delay.enable(); }
  close() { this.delay.disable(); }
  middleware = (req: any, res: any, next: any) => {
    const state = { start: performance.now(), phases: {} as Record<string, number>, route: '' };
    req[timing] = state;
    res.setHeader('X-Request-Id', randomUUID());
    const writeHead = res.writeHead;
    res.writeHead = function (...args: any[]) {
      if (!('headers' in state.phases)) state.phases.headers = performance.now() - state.start;
      return writeHead.apply(this, args);
    };
    let finished = false;
    const record = (aborted: boolean) => {
      if (finished) return;
      finished = true;
      const template = state.route || (typeof req.route?.path === 'string' ? req.route.path : '<unmatched>');
      let key = `${req.method} ${template}`;
      if (!this.routes.has(key) && this.routes.size >= MAX_ROUTES) key = '<overflow>';
      let entry = this.routes.get(key);
      if (!entry) { entry = { count: 0, errors: 0, aborted: 0, samples: [], cursor: 0 }; this.routes.set(key, entry); }
      entry.count++; entry.errors += Number(res.statusCode >= 500); entry.aborted += Number(aborted);
      entry.samples[entry.cursor++ % MAX_SAMPLES] = { total: performance.now() - state.start, phases: state.phases, status: res.statusCode, aborted };
    };
    res.once('finish', () => record(false));
    res.once('close', () => record(!res.writableFinished));
    next();
  };
  snapshot() {
    const percentile = (values: number[], p: number) => {
      const sorted = values.sort((a, b) => a - b);
      return sorted.length ? Math.round(sorted[Math.ceil(sorted.length * p) - 1] * 100) / 100 : 0;
    };
    return {
      since: new Date(this.started).toISOString(), sampleWindow: MAX_SAMPLES,
      memory: process.memoryUsage(), cpu: process.cpuUsage(),
      eventLoop: { p95Ms: this.delay.percentile(95) / 1e6, p99Ms: this.delay.percentile(99) / 1e6 },
      routes: [...this.routes].map(([route, entry]) => ({
        route, count: entry.count, errors: entry.errors, aborted: entry.aborted,
        p50Ms: percentile(entry.samples.map(s => s.total), .5),
        p95Ms: percentile(entry.samples.map(s => s.total), .95),
        p99Ms: percentile(entry.samples.map(s => s.total), .99),
        phases: Object.fromEntries([...new Set(entry.samples.flatMap(s => Object.keys(s.phases)))].map(name =>
          [name, { p95Ms: percentile(entry.samples.filter(s => name in s.phases).map(s => s.phases[name]), .95) }])),
      })),
    };
  }
}

export function setPerformanceRoute(req: any, route: string) { if (req?.[timing]) req[timing].route = route; }
export function recordPhase(req: any, name: string, start: number) {
  const state = req?.[timing];
  if (state) state.phases[name] = (state.phases[name] || 0) + performance.now() - start;
}
export async function measurePhase<T>(req: any, name: string, fn: () => T | Promise<T>): Promise<T> {
  const start = performance.now();
  try { return await fn(); } finally { recordPhase(req, name, start); }
}
