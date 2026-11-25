// Compatibility facade. Resource semantics belong to module-annotations.
import { annotatedCompatibility } from './annotations-compat';
import type * as Contract from './contracts/manifest';
export type { PackageManifest } from './contracts/manifest';
export const generateManifest: typeof Contract.generateManifest = (...args: any[]) => annotatedCompatibility('manifest').generateManifest(...args);
export const writeManifest: typeof Contract.writeManifest = (...args: any[]) => annotatedCompatibility('manifest').writeManifest(...args);
