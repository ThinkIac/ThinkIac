export interface ResourceIdentity {
  readonly package: string;
  readonly kind: string;
  readonly name: string;
}

export interface ResourceReference {
  readonly package?: string;
  readonly kind?: string;
  readonly name: string;
}

export class ResourceResolutionError extends Error {
  constructor(
    readonly code: 'RESOURCE_COLLISION' | 'RESOURCE_AMBIGUOUS' | 'RESOURCE_NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'ResourceResolutionError';
  }
}

export function formatResourceIdentity(identity: ResourceIdentity): string {
  return `${identity.package}::${identity.kind}:${identity.name}`;
}
