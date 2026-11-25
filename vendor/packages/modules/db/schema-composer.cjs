"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.effectiveSchemaPath = effectiveSchemaPath;
exports.composePackageSchema = composePackageSchema;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const utils_1 = { IGNORE_DIRS: new Set(['node_modules', '.git', '.logos', '.svelte-cache', '.snapshots', '.database', 'dist', 'data', 'uploads', 'profiles', 'secrets', 'generated', 'backups', 'snapshots', 'sessions', 'shared-cache']) };
const DECLARATION = /\b(model|enum|type|view|datasource|generator)\s+([A-Za-z_]\w*)\s*\{/g;
function normalize(value) {
    return value.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
}
function declarations(text, source, primary) {
    const result = [];
    DECLARATION.lastIndex = 0;
    let match;
    while ((match = DECLARATION.exec(text))) {
        const open = text.indexOf('{', match.index);
        let depth = 1;
        let cursor = open + 1;
        let quote = '';
        for (; cursor < text.length && depth > 0; cursor++) {
            const char = text[cursor];
            if (quote) {
                if (char === '\\')
                    cursor++;
                else if (char === quote)
                    quote = '';
            }
            else if (char === '"' || char === "'")
                quote = char;
            else if (char === '{')
                depth++;
            else if (char === '}')
                depth--;
        }
        if (depth !== 0)
            throw new Error(`DB_SCHEMA_UNCLOSED_DECLARATION:${source}:${match[1]}:${match[2]}`);
        const raw = text.slice(match.index, cursor).trim();
        result.push({ kind: match[1], name: match[2], header: `${match[1]} ${match[2]}`, body: text.slice(open + 1, cursor - 1), raw, source, primary });
        DECLARATION.lastIndex = cursor;
    }
    return result;
}
function modelMembers(body) {
    const members = new Map();
    for (const raw of body.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('//'))
            continue;
        const key = line.startsWith('@@') ? normalize(line) : line.split(/\s+/)[0];
        const existing = members.get(key);
        if (existing && normalize(existing) !== normalize(line))
            throw new Error(`DB_SCHEMA_DUPLICATE_MEMBER:${key}`);
        members.set(key, line);
    }
    return members;
}
function mergeModel(base, incoming) {
    const target = modelMembers(base.body);
    const origins = base.memberOrigins ?? new Map([...target.keys()].map(name => [name, { source: base.source, primary: base.primary }]));
    for (const [name, line] of modelMembers(incoming.body)) {
        const current = target.get(name);
        if (!current) {
            target.set(name, line);
            origins.set(name, { source: incoming.source, primary: incoming.primary });
        }
        else if (normalize(current) !== normalize(line) && !origins.get(name)?.primary) {
            throw new Error(`DB_SCHEMA_FRAGMENT_CONFLICT:${base.kind}:${base.name}:${name}:${origins.get(name)?.source}:${incoming.source}`);
        }
    }
    const body = [...target.values()].map(line => `  ${line}`).join('\n');
    return { ...base, body, raw: `${base.header} {\n${body}\n}`, memberOrigins: origins };
}
function mergeEnum(base, incoming) {
    const values = new Map();
    for (const body of [base.body, incoming.body]) {
        for (const raw of body.split(/\r?\n/)) {
            const line = raw.trim();
            if (line && !line.startsWith('//'))
                values.set(normalize(line), line);
        }
    }
    const body = [...values.values()].map(line => `  ${line}`).join('\n');
    return { ...base, body, raw: `${base.header} {\n${body}\n}` };
}
function schemaSources(packageDir) {
    const found = [];
    const visit = (dir) => {
        for (const entry of fs_1.default.readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory() && utils_1.IGNORE_DIRS.has(entry.name))
                continue;
            const full = path_1.default.join(dir, entry.name);
            if (entry.isDirectory() && !fs_1.default.existsSync(path_1.default.join(full, "package.json")))
                visit(full);
            else if (entry.isFile() && /\.(prisma|scriba|schema)$/i.test(entry.name))
                found.push(full);
        }
    };
    visit(packageDir);
    const primary = path_1.default.join(packageDir, 'schema.prisma');
    return found.sort((a, b) => a === primary ? -1 : b === primary ? 1 : a.localeCompare(b));
}
function effectiveSchemaPath(packageDir) {
    return path_1.default.join(packageDir, '.logos', 'generated', 'db', 'schema.prisma');
}
function composePackageSchema(packageDir) {
    const sources = schemaSources(packageDir);
    if (!sources.length)
        return null;
    const primaryPath = path_1.default.join(packageDir, 'schema.prisma');
    const merged = new Map();
    for (const source of sources) {
        const primary = source === primaryPath;
        for (const declaration of declarations(fs_1.default.readFileSync(source, 'utf8'), path_1.default.relative(packageDir, source), primary)) {
            const key = `${declaration.kind}:${declaration.name}`;
            const current = merged.get(key);
            if (!current)
                merged.set(key, declaration);
            else if (declaration.kind === 'model' || declaration.kind === 'type' || declaration.kind === 'view') {
                merged.set(key, mergeModel(current, declaration));
            }
            else if (declaration.kind === 'enum') {
                merged.set(key, mergeEnum(current, declaration));
            }
            else if (normalize(current.raw) !== normalize(declaration.raw) && !current.primary) {
                throw new Error(`DB_SCHEMA_FRAGMENT_CONFLICT:${key}:${current.source}:${declaration.source}`);
            }
        }
    }
    const banner = `// Generated by Logos from: ${sources.map(source => path_1.default.relative(packageDir, source)).join(', ')}\n// Do not edit this file directly.\n\n`;
    const schema = banner + [...merged.values()].map(item => item.raw).join('\n\n') + '\n';
    const outputPath = effectiveSchemaPath(packageDir);
    fs_1.default.mkdirSync(path_1.default.dirname(outputPath), { recursive: true });
    const temporary = `${outputPath}.${process.pid}.tmp`;
    fs_1.default.writeFileSync(temporary, schema, 'utf8');
    fs_1.default.renameSync(temporary, outputPath);
    return { schema, outputPath, sources };
}
