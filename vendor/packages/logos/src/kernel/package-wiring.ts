import type { Container } from './container';
import { normalizePackageContract, type EffectivePackageContract } from './package-contract';
import { registerHooks, registerTools } from './scan';
import { getIsolatedRunner } from '../core/isolated/bridge';

export interface PackageWiringValidation {
  contract: EffectivePackageContract;
  tools: number;
  hooks: number;
}

function validateToolSchema(tool: any): void {
  const schema = tool?.parameters;
  if (!schema || schema.type !== 'object' || !schema.properties || typeof schema.properties !== 'object') {
    throw new TypeError(`Tool ${tool?.name ?? '<unknown>'} must expose an object JSON schema`);
  }
  if (schema.required !== undefined && !Array.isArray(schema.required)) {
    throw new TypeError(`Tool ${tool?.name ?? '<unknown>'} schema.required must be an array`);
  }
}

/** Validates declared and discovered capabilities before package wiring. */
export async function validatePackageWiring(container: Container, pkg: any): Promise<PackageWiringValidation> {
  const contract = normalizePackageContract(pkg);
  const principal = { kind: 'package' as const, id: pkg.folder };
  const runner = getIsolatedRunner(container, pkg.folder);
  const surfaces = runner?.surfaces;
  if (pkg.isolated === true && !surfaces) throw new Error(`Isolated package ${pkg.folder} has no running runner`);
  const tools = surfaces ? surfaces.tools.map(tool => ({ ...tool, call: (args: any, context: any) => runner!.invoke(tool.id, [args], context) })) : await registerTools(pkg.folder);
  const hooks = surfaces ? surfaces.hooks.map(hook => ({ ...hook, call: (payload: any, context: any) => runner!.invoke(hook.id, [payload], context) })) : await registerHooks(pkg.folder);

  for (const tool of tools) {
    validateToolSchema(tool);
    container.authority.enforce({
      principal, surface: 'tools', operation: 'provide', resource: `${pkg.folder}.${tool.name}`,
    });
  }
  for (const hook of hooks) {
    container.authority.enforce({
      principal, surface: 'events', operation: 'transform', resource: hook.event,
    });
  }
  return { contract, tools: tools.length, hooks: hooks.length };
}
