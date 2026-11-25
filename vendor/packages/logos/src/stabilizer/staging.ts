// Compatibility facade. Implementation belongs to the optional stabilizer module.
import { stabilizationLibrary, lazyStabilizationClass } from '../kernel/stabilization-compat';
import type * as Contract from './contracts/staging';
export type { StagingResult } from './contracts/staging';
export const stagePackage: typeof Contract.stagePackage = (...args: any[]) => stabilizationLibrary('staging').stagePackage(...args);
export const stagePackageUnlocked: typeof Contract.stagePackageUnlocked = (...args: any[]) => stabilizationLibrary('staging').stagePackageUnlocked(...args);
