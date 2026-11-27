import type { Container } from './container';
import type { ExtensionPhase } from './bus';
import type { DeclarationPayload } from './declarations';
import { expressionValidator, modelCatalog, packageRoot } from './model-catalog';
import { paramDeclaration } from './metadata-contracts';
import { formatResourceIdentity } from './resource-identity';

const phases = new Set<string>(['before', 'transform', 'after']);
const canonicalResponse = /^[a-z][a-z0-9-]*::response:[a-z_$][\w$]*$/i;
const fieldName = /^[a-z_$][\w$]*$/i;

export function isExtensionDeclaration(declaration: DeclarationPayload): boolean {
  return !declaration.legacy && ['response', 'extensionHook'].includes(declaration.type);
}

export function prepareExtensionDeclarations(container: Container, owner: string, packageName: string, resources: readonly any[]) {
  const hookKeys = new Set<string>();
  const providers = [];
  const hooks = [];
  for (const resource of resources) {
    const { declaration, file, handler } = resource;
    if (!isExtensionDeclaration(declaration)) continue;
    const tags = declaration.tags;
    const location = file + ':' + declaration.name;
    if (declaration.type === 'extensionHook') {
      const [event] = tags.target ?? [];
      const [phase] = tags.phase ?? [];
      const fields: unknown = JSON.parse(tags.fields?.[0] ?? 'null');
      if (tags.target?.length !== 1 || !canonicalResponse.test(event) ||
          tags.phase?.length !== 1 || !phases.has(phase) ||
          tags.fields?.length !== 1 || !Array.isArray(fields) ||
          fields.some(field => typeof field !== 'string' || !fieldName.test(field) ||
            (phase !== 'before' && field !== 'result')) || new Set(fields).size !== fields.length) {
        throw new TypeError(location + ': invalid extension hook metadata');
      }
      const key = phase + ' ' + event;
      if (hookKeys.has(key)) throw new TypeError(location + ': duplicate hook for ' + key);
      hookKeys.add(key);
      hooks.push(() => container.bus.hook(event, phase as ExtensionPhase, (payload, context) => {
        if (phase === 'before' && fields.some(field => payload == null || !Object.hasOwn(payload, field))) {
          throw new TypeError(location + ': hook selects a field outside the active response signature');
        }
        const selected = Object.fromEntries(fields.map(field => [field, phase === 'before' ? payload[field] : payload]));
        return handler(selected, context);
      }, { owner }));
      continue;
    }

    const event = formatResourceIdentity({ package: packageName, kind: 'response', name: declaration.name });
    const extensions = tags.extensions ?? [];
    const outputType = tags.returns?.[0]?.match(/^\{([^}]+)\}$/)?.[1];
    if (!canonicalResponse.test(event) || !outputType || tags.returns.length !== 1 ||
        new Set(extensions).size !== extensions.length || extensions.some((phase: string) => !phases.has(phase))) {
      throw new TypeError(location + ': invalid response declaration');
    }
    const catalog = modelCatalog(packageRoot(file));
    const specs: string[] = tags.params ?? [];
    const params = specs.filter((text: string) => text !== '[]')
      .map((text: string) => {
        const spec = paramDeclaration(text, location);
        return { ...spec, validate: expressionValidator(spec.type, catalog, location + '.' + spec.name) };
      });
    const allowed = new Set(params.map(param => param.name));
    const validateOutput = expressionValidator(outputType, catalog, location + '.returns');
    const check = (validate: (value: unknown) => unknown, value: unknown) => {
      try { validate(value); return true; } catch { return false; }
    };
    const input = (value: unknown): value is Record<string, unknown> =>
      value !== null && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value).every(field => allowed.has(field)) &&
      params.every(param => {
        const field = Object.hasOwn(value, param.name) ? (value as Record<string, unknown>)[param.name] : undefined;
        return field === undefined ? param.optional : check(param.validate, field);
      });
    providers.push(() => {
      container.bus.provide(event, {
        extensions,
        input,
        exposeInput: payload => Object.fromEntries(params.map(param => {
          const value = Object.hasOwn(payload, param.name) ? payload[param.name] : undefined;
          return [param.name, value === undefined ? undefined : param.validate(value)];
        })),
        exposeOutput: validateOutput,
        output: (value): value is unknown => check(validateOutput, value),
      }, (payload, context) => handler(...params.map(param =>
        Object.hasOwn(payload, param.name) ? payload[param.name] : undefined), context), { owner, authorizePublish: true });
    });
  }

  let publication: ReturnType<Container['bus']['replaceDeclaredExtensions']> | undefined;
  return {
    commit() {
      publication = container.bus.replaceDeclaredExtensions(owner, () => {
        for (const install of [...providers, ...hooks]) install();
      });
    },
    rollback() { publication?.rollback(); },
    dispose() { publication?.dispose(); },
  };
}
