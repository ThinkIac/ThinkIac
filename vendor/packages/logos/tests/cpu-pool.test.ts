import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CpuQueueFullError, CpuTaskTimeoutError, CpuWorkerPool } from '../src/kernel/cpu-pool';

const roots: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'logos-cpu-')); roots.push(root);
  const file = path.join(root, 'tasks.mjs');
  fs.writeFileSync(file, `
    export function fibonacci(n) { return n < 2 ? n : fibonacci(n - 1) + fibonacci(n - 2); }
    export async function wait(ms, value) { await new Promise(resolve => setTimeout(resolve, ms)); return value; }
  `);
  return file;
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('CPU worker pool', () => {
  it('executes modules off-thread and reports bounded metrics', async () => {
    const pool = new CpuWorkerPool({ size: 2, maxQueue: 2 });
    try {
      await expect(pool.run(fixture(), [10], { exportName: 'fibonacci' })).resolves.toBe(55);
      expect(pool.snapshot()).toMatchObject({ size: 2, submitted: 1, completed: 1, running: 0, queued: 0 });
    } finally { await pool.close(); }
  });

  it('rejects overload instead of accumulating unbounded promises', async () => {
    const pool = new CpuWorkerPool({ size: 1, maxQueue: 1 }); const file = fixture();
    try {
      const running = pool.run(file, [100, 'one'], { exportName: 'wait' });
      const queued = pool.run(file, [100, 'two'], { exportName: 'wait' });
      await expect(pool.run(file, [1, 'three'], { exportName: 'wait' })).rejects.toBeInstanceOf(CpuQueueFullError);
      await expect(Promise.all([running, queued])).resolves.toEqual(['one', 'two']);
    } finally { await pool.close(); }
  });

  it('terminates timed-out work and replaces the worker', async () => {
    const pool = new CpuWorkerPool({ size: 1, maxQueue: 1, taskTimeoutMs: 20 }); const file = fixture();
    try {
      await expect(pool.run(file, [100, 'late'], { exportName: 'wait' })).rejects.toBeInstanceOf(CpuTaskTimeoutError);
      await expect(pool.run(file, [1, 'next'], { exportName: 'wait', timeoutMs: 500 })).resolves.toBe('next');
      expect(pool.snapshot().timedOut).toBe(1);
    } finally { await pool.close(); }
  });
});
