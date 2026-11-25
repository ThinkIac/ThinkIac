// Compatibility facade. Implementation belongs to the optional stabilizer module.
import { stabilizationLibrary, lazyStabilizationClass } from '../kernel/stabilization-compat';
import type * as Contract from './contracts/index';
export type Stabilizer = Contract.Stabilizer;
export const Stabilizer: typeof Contract.Stabilizer = lazyStabilizationClass('index', 'Stabilizer');
export const findLocalPrismaBinary: typeof Contract.findLocalPrismaBinary = (...args: any[]) => stabilizationLibrary('index').findLocalPrismaBinary(...args);
