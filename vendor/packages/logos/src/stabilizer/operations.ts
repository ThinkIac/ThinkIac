// Compatibility facade. Implementation belongs to the optional stabilizer module.
import { stabilizationLibrary, lazyStabilizationClass } from '../kernel/stabilization-compat';
import type * as Contract from './contracts/operations';
export const packageOperation: typeof Contract.packageOperation = (...args: any[]) => stabilizationLibrary('operations').packageOperation(...args);
