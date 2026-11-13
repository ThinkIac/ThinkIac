import type { EventContractDefinition } from './package-contract';

interface RegisteredEventContract extends EventContractDefinition {
  owner: string;
}

export class EventSchemaValidationError extends TypeError {
  readonly code = 'EVENT_SCHEMA_INVALID';
  constructor(readonly event: string, readonly detail: string) {
    super(`Event ${event} payload is invalid: ${detail}`);
    this.name = 'EventSchemaValidationError';
  }
}

function valueType(value: any): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function validateValue(value: any, schema: any, path = '$'): string | null {
  if (!schema || typeof schema !== 'object') return `${path} schema is not an object`;
  if (Array.isArray(schema.enum) && !schema.enum.some((item: any) => Object.is(item, value))) return `${path} is not in enum`;
  if (schema.type && valueType(value) !== schema.type) return `${path} must be ${schema.type}, got ${valueType(value)}`;
  if (schema.type === 'object') {
    for (const key of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) return `${path}.${key} is required`;
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        const error = validateValue(value[key], child, `${path}.${key}`);
        if (error) return error;
      }
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties ?? {}));
      const extra = Object.keys(value).find(key => !allowed.has(key));
      if (extra) return `${path}.${extra} is not allowed`;
    }
  }
  if (schema.type === 'array' && schema.items) {
    for (let index = 0; index < value.length; index++) {
      const error = validateValue(value[index], schema.items, `${path}[${index}]`);
      if (error) return error;
    }
  }
  return null;
}

export class EventContractRegistry {
  private contracts = new Map<string, RegisteredEventContract>();

  replaceOwner(owner: string, definitions: Record<string, EventContractDefinition>): void {
    const next = new Map(this.contracts);
    for (const [event, contract] of next) if (contract.owner === owner) next.delete(event);
    for (const [event, definition] of Object.entries(definitions)) {
      const existing = next.get(event);
      if (existing && existing.owner !== owner) throw new Error(`Event contract ${event} is already owned by ${existing.owner}`);
      next.set(event, Object.freeze({ ...definition, owner }));
    }
    this.contracts = next;
  }

  removeOwner(owner: string): void {
    for (const [event, contract] of this.contracts) if (contract.owner === owner) this.contracts.delete(event);
  }

  get(event: string): Readonly<RegisteredEventContract> | null {
    return this.contracts.get(event) ?? null;
  }

  validate(event: string, payload: any): void {
    const contract = this.contracts.get(event);
    if (!contract) return;
    const error = validateValue(payload, contract.payloadSchema);
    if (error) throw new EventSchemaValidationError(event, error);
  }
}
