import fs from 'node:fs';
import path from 'node:path';
import { parseScribaSchema } from '../schema/scriba-parser';
import { IGNORE_DIRS } from './utils';

export function packageRoot(filename: string): string {
  const initial = path.dirname(path.resolve(filename));
  let dir = initial;
  while (true) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return initial;
    dir = parent;
  }
}

/** A nested manifest is another owner. Symlinks and generated data are excluded. */
export function schemaFiles(root: string): string[] {
  const files: string[] = [];
  function visit(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || IGNORE_DIRS.has(entry.name) || ['tests', 'test', '__tests__'].includes(entry.name)) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory() && !fs.existsSync(path.join(file, 'package.json'))) visit(file);
      else if (entry.isFile() && /\.(scriba|schema|prisma)$/i.test(file)) files.push(file);
    }
  }
  visit(root); return files.sort();
}
export function modelCatalog(root: string) {
  const models: Record<string, any> = Object.create(null), enums: Record<string, string[]> = Object.create(null);
  const sources = schemaFiles(root);
  for (const file of sources) {
    const parsed = parseScribaSchema(fs.readFileSync(file, 'utf8'));
    for (const [name, values] of Object.entries(parsed.enums)) {
      if (enums[name] && JSON.stringify(enums[name]) !== JSON.stringify(values)) throw new Error(`Conflicting enum ${name}: ${file}`);
      enums[name] = values as string[];
    }
    for (const [name, model] of Object.entries(parsed.models) as any) {
      const previous = models[name];
      if (!previous) { models[name] = model; continue; }
      for (const field of model.fields) {
        const old = previous.fields.find((f: any) => f.name === field.name);
        if (old && JSON.stringify(old) !== JSON.stringify(field)) throw new Error(`Conflicting model ${name}.${field.name}: ${file}`);
        if (!old) previous.fields.push(field);
      }
    }
  }
  return { models, enums, sources };
}
export type ModelCatalog = ReturnType<typeof modelCatalog>;

/** Resolve field references without involving the persistence provider. */
export function fieldReference(expression: string, catalog: ModelCatalog, location: string): { type: string; description: string } {
  const match = expression.trim().match(/^([A-Za-z_]\w*)\.([A-Za-z_]\w*)(\[\]|\?)?$/);
  if (!match) return { type: expression, description: '' };
  const field = catalog.models[match[1]]?.fields.find((f: any) => f.name === match[2]);
  if (!field) throw new TypeError(`${location}: unknown field ${match[1]}.${match[2]}`);
  return { type: field.type + (field.isList ? '[]' : '') + (field.isOptional ? '?' : '') + (match[3] ?? ''), description: field.description ?? '' };
}

/** JSDoc type expressions are data, never eval. Model validation returns a DTO,
 * so ORM bookkeeping and lazy relation managers cannot leak into responses. */
export function expressionValidator(expression: string, catalog: ModelCatalog, location: string) {
  const checked = new Set<string>();
  function check(raw: string): void {
    const type = raw.trim().replace(/^\((.*)\)$/, '$1').trim();
    const resolved = fieldReference(type, catalog, location).type;
    if (resolved !== type) return check(resolved);
    if (checked.has(type)) return;
    checked.add(type);
    if (type.endsWith('?') || type.endsWith('[]')) return check(type.slice(0, type.endsWith('?') ? -1 : -2));
    if (type.includes('|')) { type.split('|').forEach(check); return; }
    if (/^(?:String|string|Int|Float|number|Boolean|boolean|DateTime|Json|void|null|undefined)$/.test(type) || /^(['"]).*\1$/.test(type) || catalog.enums[type]) return;
    if (catalog.models[type]) { for (const f of catalog.models[type].fields) check(f.type); return; }
    throw new TypeError(`${location}: unknown type ${type}`);
  }
  check(expression);
  function validate(value: any, raw: string, at: string, depth = 0): any {
    if (depth > 100) throw new TypeError(`${at}: cyclic or excessively deep model value`);
    const type = raw.trim().replace(/^\((.*)\)$/, '$1').trim();
    const resolved = fieldReference(type, catalog, at).type;
    if (resolved !== type) return validate(value, resolved, at, depth + 1);
    if (type.endsWith('?')) return value == null ? value : validate(value, type.slice(0, -1), at, depth + 1);
    if (type.endsWith('[]')) {
      if (!Array.isArray(value)) throw new TypeError(`${at}: expected ${type}`);
      return value.map((item, i) => validate(item, type.slice(0, -2), `${at}[${i}]`, depth + 1));
    }
    if (type.includes('|')) {
      for (const child of type.split('|')) { try { return validate(value, child, at, depth + 1); } catch {} }
      throw new TypeError(`${at}: expected ${type}`);
    }
    let valid = false;
    if (catalog.models[type]) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${at}: expected model ${type}`);
      const result: Record<string, any> = {};
      for (const f of catalog.models[type].fields) {
        const item = value[f.name];
        if (f.isOptional && item == null) { Object.defineProperty(result, f.name, { value: item, enumerable: true, configurable: true, writable: true }); continue; }
        Object.defineProperty(result, f.name, { value: validate(item, f.type + (f.isList ? '[]' : ''), `${at}.${f.name}`, depth + 1), enumerable: true, configurable: true, writable: true });
      }
      return result;
    }
    if (catalog.enums[type]) valid = catalog.enums[type].includes(value);
    else if (/^(['"]).*\1$/.test(type)) valid = value === type.slice(1, -1);
    else switch (type) {
      case 'String': case 'string': valid = typeof value === 'string'; break;
      case 'Int': valid = Number.isSafeInteger(value); break;
      case 'Float': case 'number': valid = typeof value === 'number' && Number.isFinite(value); break;
      case 'Boolean': case 'boolean': valid = typeof value === 'boolean'; break;
      case 'void': case 'undefined': valid = value === undefined; break;
      case 'null': valid = value === null; break;
      case 'DateTime': valid = (value instanceof Date || typeof value === 'string') && Number.isFinite(new Date(value).getTime()); if (valid) return new Date(value).toISOString(); break;
      case 'Json': try { const json = JSON.stringify(value); valid = json !== undefined; if (valid) return JSON.parse(json); } catch {} break;
    }
    if (!valid) throw new TypeError(`${at}: expected ${type}`);
    return value;
  }
  return (value: any, at = location) => validate(value, expression, at);
}
