// Compatibility facade. Implementation belongs to the optional stabilizer module.
import { stabilizationLibrary, lazyStabilizationClass } from '../kernel/stabilization-compat';
import type * as Contract from './contracts/crashguard';
export const bootAttempt: typeof Contract.bootAttempt = (...args: any[]) => stabilizationLibrary('crashguard').bootAttempt(...args);
export const bootStable: typeof Contract.bootStable = (...args: any[]) => stabilizationLibrary('crashguard').bootStable(...args);
