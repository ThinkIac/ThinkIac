// Compatibility facade. Implementation belongs to the optional stabilizer module.
import { stabilizationLibrary, lazyStabilizationClass } from '../kernel/stabilization-compat';
import type * as Contract from './contracts/health';
export type { HealthStatus, PackageHealth, MonitorConfig } from './contracts/health';
export type HealthMonitor = Contract.HealthMonitor;
export const HealthMonitor: typeof Contract.HealthMonitor = lazyStabilizationClass('health', 'HealthMonitor');
export const normalizeMonitor: typeof Contract.normalizeMonitor = (...args: any[]) => stabilizationLibrary('health').normalizeMonitor(...args);
export const normalizeHealth: typeof Contract.normalizeHealth = (...args: any[]) => stabilizationLibrary('health').normalizeHealth(...args);
