import fs from 'fs';
import path from 'path';
import { IGNORE_DIRS } from '../kernel/utils';

export interface ComposedSchema {
  schema: string;
  outputPath: string;
  sources: string[];
}

interface Declaration {
  kind: string;
  name: string;
  header: string;
  body: string;
  raw: string;
  source: string;
  primary: boolean;
  memberOrigins?: Map<string, { source: string; primary: boolean }>;
}

const DECLARATION = /\b(model|enum|type|view|datasource|generator)\s+([A-Za-z_]\w*)\s*\{/g;

function normalize(value: string): string {
  return value.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
}

function declarations(text: string, source: string, primary: boolean): Declaration[] {
  const result: Declaration[] = [];
  DECLARATION.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DECLARATION.exec(text))) {
    const open = text.indexOf('{', match.index);
    let depth = 1;
    let cursor = open + 1;
    let quote = '';
    for (; cursor < text.length && depth > 0; cursor++) {
      const char = text[cursor];
      if (quote) {
        if (char === '\\') cursor++;
        else if (char === quote) quote = '';
      } else if (char === '"' || char === "'") quote = char;
      else if (char === '{') depth++;
      else if (char === '}') depth--;
    }
    if (depth !== 0) throw new Error(`DB_SCHEMA_UNCLOSED_DECLARATION:${source}:${match[1]}:${match[2]}`);
    const raw = text.slice(match.index, cursor).trim();
    result.push({ kind: match[1], name: match[2], header: `${match[1]} ${match[2]}`, body: text.slice(open + 1, cursor - 1), raw, source, primary });
    DECLARATION.lastIndex = cursor;
  }
  return result;
}

function modelMembers(body: string): Map<string, string> {
  const members = new Map<string, string>();
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    const key = line.startsWith('@@') ? normalize(line) : line.split(/\s+/)[0];
    const existing = members.get(key);
    if (existing && normalize(existing) !== normalize(line)) throw new Error(`DB_SCHEMA_DUPLICATE_MEMBER:${key}`);
    members.set(key, line);
  }
  return members;
}

function mergeModel(base: Declaration, incoming: Declaration): Declaration {
  const target = modelMembers(base.body);
  const origins = base.memberOrigins ?? new Map([...target.keys()].map(name => [name, { source: base.source, primary: base.primary }]));
  for (const [name, line] of modelMembers(incoming.body)) {
    const current = target.get(name);
    if (!current) {
      target.set(name, line);
      origins.set(name, { source: incoming.source, primary: incoming.primary });
    } else if (normalize(current) !== normalize(line) && !origins.get(name)?.primary) {
      throw new Error(`DB_SCHEMA_FRAGMENT_CONFLICT:${base.kind}:${base.name}:${name}:${origins.get(name)?.source}:${incoming.source}`);
    }
  }
  const body = [...target.values()].map(line => `  ${line}`).join('\n');
  return { ...base, body, raw: `${base.header} {\n${body}\n}`, memberOrigins: origins };
}

function mergeEnum(base: Declaration, incoming: Declaration): Declaration {
  const values = new Map<string, string>();
  for (const body of [base.body, incoming.body]) {
    for (const raw of body.split(/\r?\n/)) {
      const line = raw.trim();
      if (line && !line.startsWith('//')) values.set(normalize(line), line);
    }
  }
  const body = [...values.values()].map(line => `  ${line}`).join('\n');
  return { ...base, body, raw: `${base.header} {\n${body}\n}` };
}

function schemaSources(packageDir: string): string[] {
  const found: string[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && IGNORE_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && /\.(prisma|scriba)$/i.test(entry.name)) found.push(full);
    }
  };
  visit(packageDir);
  const primary = path.join(packageDir, 'schema.prisma');
  return found.sort((a, b) => a === primary ? -1 : b === primary ? 1 : a.localeCompare(b));
}

export function effectiveSchemaPath(packageDir: string): string {
  return path.join(packageDir, '.logos', 'generated', 'db', 'schema.prisma');
}

export function composePackageSchema(packageDir: string): ComposedSchema | null {
  const sources = schemaSources(packageDir);
  if (!sources.length) return null;
  const primaryPath = path.join(packageDir, 'schema.prisma');
  const merged = new Map<string, Declaration>();
  for (const source of sources) {
    const primary = source === primaryPath;
    for (const declaration of declarations(fs.readFileSync(source, 'utf8'), path.relative(packageDir, source), primary)) {
      const key = `${declaration.kind}:${declaration.name}`;
      const current = merged.get(key);
      if (!current) merged.set(key, declaration);
      else if (declaration.kind === 'model' || declaration.kind === 'type' || declaration.kind === 'view') {
        merged.set(key, mergeModel(current, declaration));
      } else if (declaration.kind === 'enum') {
        merged.set(key, mergeEnum(current, declaration));
      } else if (normalize(current.raw) !== normalize(declaration.raw) && !current.primary) {
        throw new Error(`DB_SCHEMA_FRAGMENT_CONFLICT:${key}:${current.source}:${declaration.source}`);
      }
    }
  }
  const banner = `// Generated by Logos from: ${sources.map(source => path.relative(packageDir, source)).join(', ')}\n// Do not edit this file directly.\n\n`;
  const schema = banner + [...merged.values()].map(item => item.raw).join('\n\n') + '\n';
  const outputPath = effectiveSchemaPath(packageDir);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, schema, 'utf8');
  fs.renameSync(temporary, outputPath);
  return { schema, outputPath, sources };
}
