import { metadataResource, jsdocHandler } from './metadata-contracts';
import type { Container } from './container';

/** Small, serializable type algebra. Objects describe required fields; a one-item
 * array describes an array of that element type. Input is a tuple of arguments.
 * No expressions or executable validators are accepted from declaration metadata.
 */
export type ValueType = 'string' | 'number' | 'boolean' | 'null' | 'void' | { [field: string]: ValueType } | ValueType[];
export interface ResourceContract { input: ValueType[]; output: ValueType }
const primitives = new Set(['string', 'number', 'boolean', 'null', 'void']);

export function checkType(type: any, location: string): void {
  if (typeof type === 'string' && primitives.has(type)) return;
  if (Array.isArray(type)) {
    if (type.length !== 1) throw new TypeError(`${location}: array type needs exactly one element type`);
    checkType(type[0], location + '[]'); return;
  }
  if (type && typeof type === 'object' && Object.getPrototypeOf(type) === Object.prototype) {
    for (const [key, child] of Object.entries(type)) checkType(child, `${location}.${key}`);
    return;
  }
  throw new TypeError(`${location}: unsupported type ${JSON.stringify(type)}`);
}

export function assertValue(value: any, type: ValueType, location: string): void {
  if (typeof type === 'string') {
    const valid = type === 'void' ? value === undefined : type === 'null' ? value === null
      : typeof value === type && (type !== 'number' || Number.isFinite(value));
    if (!valid) throw new TypeError(`${location}: expected ${type}`);
    return;
  }
  if (Array.isArray(type)) {
    if (!Array.isArray(value)) throw new TypeError(`${location}: expected array`);
    for (let index = 0; index < value.length; index++) assertValue(value[index], type[0], `${location}[${index}]`);
    return;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${location}: expected object`);
  for (const [key, child] of Object.entries(type)) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) throw new TypeError(`${location}.${key}: missing field`);
    assertValue(value[key], child, `${location}.${key}`);
  }
}

export function installResourceContracts(container: Container, definition: any, strict: boolean, identity: string) {
  const contracts = definition.contracts ?? {};
  for (const type of Object.keys(contracts)) {
    if (!definition.resources?.[type]) throw new TypeError(`${identity}: contract has no resource consumer: ${type}`);
  }
  for (const type of Object.keys(definition.resources ?? {})) {
    const contract = contracts[type];
    if (!contract) {
      if (strict) throw new TypeError(`${identity}: resource ${type} requires an input and output contract`);
      continue; // Existing JavaScript capability adapters retain their old contract.
    }
    if (!Array.isArray(contract.input) || !Object.prototype.hasOwnProperty.call(contract, 'output')) {
      throw new TypeError(`${identity}: ${type} requires input tuple and output type`);
    }
    contract.input.forEach((item: any, index: number) => checkType(item, `${identity}:${type}.input[${index}]`));
    checkType(contract.output, `${identity}:${type}.output`);
    const state = container.state('runtime:resource-contracts');
    if (state.has(type)) throw new Error(`${identity}: duplicate resource contract ${type}`);
    // Snapshot validated data so a provider cannot mutate the active contract.
    state.set(type, JSON.parse(JSON.stringify(contract)));
  }
}

function equalTypes(left: any, right: any): boolean {
  if (typeof left !== 'object' || left === null || right === null || typeof right !== 'object') return left === right;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left).sort();
  return keys.join('\0') === Object.keys(right).sort().join('\0') && keys.every(key => equalTypes(left[key], right[key]));
}

/** Validation surrounds the authority-mediated handler, including isolated RPC.
 * Keep synchronous handlers synchronous; await only thenables for output checks.
 */
export function typedResource(container: Container, resource: any) {
  resource = metadataResource(container, resource);
  const contract = container.state('runtime:resource-contracts').get(resource.declaration.type) as ResourceContract | undefined;
  if (!contract) {
    const invoke = jsdocHandler(resource.handler, resource.declaration.tags, resource.file, `${resource.package}:${resource.declaration.name}`);
    return { ...resource, handler: invoke };
  }
  const location = `${resource.package}:${resource.declaration.type}:${resource.declaration.name ?? resource.file}`;
  const annotations = resource.declaration.tags.returns;
  if (annotations?.length !== 1) throw new TypeError(`${location}: typed resource requires one @returns JSON type`);
  let output: ValueType;
  try { output = JSON.parse(annotations[0]); } catch { throw new TypeError(`${location}: @returns must be a JSON type`); }
  checkType(output, location + '.returns');
  if (!equalTypes(output, contract.output)) throw new TypeError(`${location}: @returns differs from provider output`);
  const handler = resource.handler;
  return { ...resource, handler: (...args: any[]) => {
    if (args.length !== contract.input.length) throw new TypeError(`${location}: expected ${contract.input.length} arguments, received ${args.length}`);
    args.forEach((value, index) => assertValue(value, contract.input[index], `${location}.input[${index}]`));
    const result = handler(...args);
    const validate = (value: any) => { assertValue(value, contract.output, location + '.output'); return value; };
    return result && typeof result.then === 'function' ? Promise.resolve(result).then(validate) : validate(result);
  } };
}
