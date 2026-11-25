// Compatibility facade. Implementation belongs to the optional stabilizer module.
import { stabilizationLibrary, lazyStabilizationClass } from '../kernel/stabilization-compat';
import type * as Contract from './contracts/isolation';
export type { PackageIsolation, RebootImpact, RebootVerdict, StopResult } from './contracts/isolation';
export const packageIsolation: typeof Contract.packageIsolation = (...args: any[]) => stabilizationLibrary('isolation').packageIsolation(...args);
export const isCritical: typeof Contract.isCritical = (...args: any[]) => stabilizationLibrary('isolation').isCritical(...args);
export const criticalPackages: typeof Contract.criticalPackages = (...args: any[]) => stabilizationLibrary('isolation').criticalPackages(...args);
export const rebootImpact: typeof Contract.rebootImpact = (...args: any[]) => stabilizationLibrary('isolation').rebootImpact(...args);
export const requestReboot: typeof Contract.requestReboot = (...args: any[]) => stabilizationLibrary('isolation').requestReboot(...args);
export const stopPackage: typeof Contract.stopPackage = (...args: any[]) => stabilizationLibrary('isolation').stopPackage(...args);
export const stopPackageUnlocked: typeof Contract.stopPackageUnlocked = (...args: any[]) => stabilizationLibrary('isolation').stopPackageUnlocked(...args);
export const startPackage: typeof Contract.startPackage = (...args: any[]) => stabilizationLibrary('isolation').startPackage(...args);
export const recoverIsolatedPackage: typeof Contract.recoverIsolatedPackage = (...args: any[]) => stabilizationLibrary('isolation').recoverIsolatedPackage(...args);
