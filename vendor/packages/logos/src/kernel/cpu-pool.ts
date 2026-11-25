// Compatibility facade. Thread resources belong to module-workers.
import { lazyCapabilityClass } from './lazy-capability';
import type * as Contract from './contracts/cpu-pool';
export type { CpuPoolOptions, CpuTaskOptions } from './contracts/cpu-pool';
export type CpuWorkerPool = Contract.CpuWorkerPool;
export const CpuWorkerPool: typeof Contract.CpuWorkerPool = lazyCapabilityClass('workers', 'pool.cjs', 'CpuWorkerPool');
export type CpuQueueFullError = Contract.CpuQueueFullError;
export const CpuQueueFullError: typeof Contract.CpuQueueFullError = lazyCapabilityClass('workers', 'pool.cjs', 'CpuQueueFullError');
export type CpuTaskTimeoutError = Contract.CpuTaskTimeoutError;
export const CpuTaskTimeoutError: typeof Contract.CpuTaskTimeoutError = lazyCapabilityClass('workers', 'pool.cjs', 'CpuTaskTimeoutError');
