import type { Container } from './container';
import { normalizePackageContract, type EffectivePackageContract } from './package-contract';
import { externalModulePath } from './external-modules';
import { modulePrimitives } from './module-primitives';

export interface PackageWiringValidation {
  contract: EffectivePackageContract;
  tools: number;
  hooks: number;
}


/** Compatibility preflight for callers of the previous public API. */
export async function validatePackageWiring(container: Container, pkg: any): Promise<PackageWiringValidation> {
 return require(externalModulePath('runtime-compat')).validatePackageWiring(container, modulePrimitives(), pkg);
}

/** Kernel-only validation. Capability modules own resource interpretation. */
export async function validatePackageContract(container: Container, pkg: any): Promise<PackageWiringValidation> {
  const contract = normalizePackageContract(pkg);
  const result = { contract, tools: 0, hooks: 0 };
  await container.bus.emitStrict('logos:package:validating', { pkg, result });
  return result;
}
