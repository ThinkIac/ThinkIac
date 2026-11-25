import type { Container } from './container';
import { expressionValidator, fieldReference, modelCatalog, packageRoot } from './model-catalog';

export function paramDeclaration(text: string, location: string) {
  const match = text.match(/^\{([^}]+)\}\s+(\[[^\]]+\]|[\w$]+)(?:\s+-?\s*(.*))?$/);
  if (!match) throw new TypeError(`${location}: expected {Type} name description`);
  const optional = match[2].startsWith('[');
  const [name, ...defaults] = (optional ? match[2].slice(1, -1) : match[2]).split('=');
  return { type: match[1], name, optional, default: defaults.length ? defaults.join('=') : undefined, description: match[3] ?? '' };
}
function scalar(text: string) { try { return JSON.parse(text); } catch { return text; } }

/** Providers declare metadata schemas with @tag; kernel knows no router/tool tags. */
export function installMetadataContract(container: Container, entry: any, definition: any): boolean {
  const declarations: string[] = entry.declaration.tags.tag ?? [];
  if (!declarations.length) return false;
  const catalog = modelCatalog(packageRoot(entry.file));
  const specs = declarations.map(text => {
    const spec = paramDeclaration(text, `${entry.file}:@tag`);
    if (!['ParamDeclaration[]', 'TypeExpression'].includes(spec.type)) {
      const validate = expressionValidator(spec.type, catalog, `${entry.file}:@tag ${spec.name}`);
      if (spec.default !== undefined) validate(scalar(spec.default));
    } else if (spec.default !== undefined) throw new TypeError(`${entry.file}: structured @tag defaults are not supported`);
    return spec;
  });
  if (new Set(specs.map(s => s.name)).size !== specs.length) throw new TypeError(`${entry.file}: duplicate @tag`);
  for (const type of Object.keys(definition.resources ?? {})) {
    const state = container.state('runtime:metadata-contracts');
    if (state.has(type)) throw new TypeError(`${entry.file}: duplicate metadata contract ${type}`);
    state.set(type, { specs, catalog, file: entry.file });
  }
  return true;
}

export function metadataResource(container: Container, resource: any) {
  const contract = container.state('runtime:metadata-contracts').get(resource.declaration.type);
  const local = modelCatalog(packageRoot(resource.file));
  const signatureParams = [...(resource.declaration.tags.params ?? resource.declaration.tags.param ?? [])]
    .filter((text: string) => text !== '[]').map((text: string) => {
      const param = paramDeclaration(text, resource.file);
      const field = fieldReference(param.type, local, resource.file);
      return { ...param, type: field.type, description: param.description || field.description };
    });
  const signatureReturns = resource.declaration.tags.returns?.[0]?.match(/^\{([^}]+)\}$/)?.[1];
  resource = { ...resource, params: signatureParams, returns: signatureReturns };
  if (!contract) return resource;
  const location = `${resource.package}:${resource.declaration.type}:${resource.declaration.name}`;
  const tags = resource.declaration.tags;
  const metadata: Record<string, any> = {};
  for (const spec of contract.specs) {
    const values = tags[spec.name] ?? (spec.name === 'params' ? tags.param : undefined);
    if (!values?.length) {
      if (!spec.optional) throw new TypeError(`${location}: required @${spec.name} missing (provider ${contract.file})`);
      if (spec.default !== undefined) metadata[spec.name] = expressionValidator(spec.type, contract.catalog, location)(scalar(spec.default));
      continue;
    }
    if (spec.type === 'ParamDeclaration[]') {
      metadata[spec.name] = values.length === 1 && values[0] === '[]' ? [] : values.map((text: string) => {
        const param = paramDeclaration(text, `${location}:@${spec.name}`);
        expressionValidator(param.type, local, `${location}:${param.name}`);
        const field = fieldReference(param.type, local, location);
        return { ...param, type: field.type, description: param.description || field.description };
      });
    } else if (spec.type === 'TypeExpression') {
      if (values.length !== 1 || !/^\{[^}]+\}$/.test(values[0])) throw new TypeError(`${location}: @${spec.name} requires one {Type}`);
      const type = values[0].slice(1, -1);
      expressionValidator(type, local, `${location}:@${spec.name}`);
      metadata[spec.name] = type;
    } else {
      if (values.length !== 1) throw new TypeError(`${location}: @${spec.name} must occur once`);
      metadata[spec.name] = expressionValidator(spec.type, contract.catalog, `${location}:@${spec.name}`)(scalar(values[0]));
    }
  }
  return { ...resource, metadata, params: metadata.params ?? signatureParams, returns: metadata.returns ?? signatureReturns };
}

/** A declaration owns its handler signature. This also works without persistence. */
export function jsdocHandler(handler: Function, tags: Record<string, string[]>, file: string, label: string) {
  const annotations = tags.returns;
  if (tags.param && tags.params) throw new TypeError(`${label}: use @param or @params consistently in one declaration`);
  const params = [...(tags.param ?? []), ...(tags.params ?? [])];
  const returns = annotations?.[0]?.match(/^\{([^}]+)\}$/);
  if (!returns && !params.some(text => text.startsWith('{'))) return handler;
  if (annotations && (!returns || annotations.length !== 1)) throw new TypeError(`${label}: requires one @returns {Type}`);
  const catalog = modelCatalog(packageRoot(file));
  const output = returns ? expressionValidator(returns[1], catalog, `${label}.returns`) : undefined;
  const inputs = params.filter(text => text !== '[]').map(text => {
    const spec = paramDeclaration(text, label + ':@param');
    const validate = expressionValidator(spec.type, catalog, `${label}.${spec.name}`);
    const fallback = spec.default === undefined ? undefined : validate(scalar(spec.default));
    return { ...spec, validate, fallback };
  });
  if (new Set(inputs.map(p => p.name)).size !== inputs.length) throw new TypeError(`${label}: duplicate @param`);
  return (...args: any[]) => {
    const next = [...args];
    // Declared parameters validate their positions; host transport arguments may follow.
    inputs.forEach((param, index) => {
      if (next[index] === undefined && param.optional) next[index] = param.fallback;
      else next[index] = param.validate(next[index]);
    });
    const result = handler(...next);
    if (!output) return result;
    return result && typeof result.then === 'function' ? Promise.resolve(result).then(value => output(value)) : output(result);
  };
}


/** Compatibility consumers receive resolved JSDoc without changing generic declarations. */
export function resolvedParameterDocs(doc: string, file: string) {
  const catalog = modelCatalog(packageRoot(file));
  return doc.split('\n').flatMap(line => {
    if (!line.startsWith('@params ')) return [line];
    if (line === '@params []') return [];
    const param = paramDeclaration(line.slice(8), file);
    const field = fieldReference(param.type, catalog, file);
    const type = field.type + (param.optional && !field.type.endsWith('?') ? '?' : '');
    return [`@param {${type}} ${param.name} - ${(param.description || field.description).replace(/\n/g, ' ')}`];
  }).join('\n');
}
