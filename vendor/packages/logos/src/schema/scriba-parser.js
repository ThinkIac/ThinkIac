// prismaParser.js
const fs = require("fs");

function trimQuotes(s) {
  if (!s && s !== 0) return s;
  return String(s).replace(/^["']|["']$/g, "");
}

function parseAttributes(attrString) {
  const attrs = [];
  const re = /@([a-zA-Z_]\w*)(\(([^)]*)\))?/g;
  let m;
  while ((m = re.exec(attrString)) !== null) {
    const name = m[1];
    const argsRaw = m[3];
    const args = [];

    if (argsRaw) {
      let cur = "";
      let depth = 0;
      for (let ch of argsRaw) {
        if (ch === "[") depth++;
        if (ch === "]") depth--;
        if (ch === "," && depth === 0) {
          args.push(cur.trim());
          cur = "";
        } else cur += ch;
      }
      if (cur.trim()) args.push(cur.trim());

      const parsed = args.map(a => {
        const kv = a.split(":").map(x => x.trim());
        if (kv.length === 1) {
          return { name: null, value: kv[0] };
        } else {
          return { name: kv[0], value: kv[1] };
        }
      });
      attrs.push({ name, args: parsed });
    } else {
      attrs.push({ name, args: [] });
    }
  }
  return attrs;
}

function parseModelUniqueConstraints(lines) {
  const constraints = [];
  for (const line of lines) {
    const match = line.match(/^@@unique\s*\(\s*\[([^\]]+)\]/);
    if (!match) continue;

    const fields = match[1]
      .split(',')
      .map(field => field.trim())
      .filter(field => /^[A-Za-z_]\w*$/.test(field));
    if (fields.length) constraints.push({ fields, source: 'model' });
  }
  return constraints;
}

function loadPrismaModels(path) {
  return parseScribaSchema(fs.readFileSync(path, "utf8"));
}

function parseScribaSchema(text) {

  const documentation = new Map();
  let model = null, pending = [], block = false;
  const noComments = text.split(/\r?\n/).map(line => {
    let code = '', comment = '', quote = null;
    for (let i = 0; i < line.length; i++) {
      if (block) { if (line.slice(i, i + 2) === '*/') { block = false; i++; } continue; }
      const c = line[i];
      if (quote) { code += c; if (c === '\\') code += line[++i] ?? ''; else if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'") { quote = c; code += c; continue; }
      if (line.slice(i, i + 2) === '/*') { block = true; i++; continue; }
      if (c === '#' || line.slice(i, i + 2) === '//') { comment = line.slice(i + (c === '#' ? 1 : 2)).replace(/^\/+/, '').trim(); break; }
      code += c;
    }
    const opening = code.match(/\bmodel\s+(\w+)\s*\{/);
    if (opening) { model = opening[1]; pending = []; }
    else if (model) {
      const field = code.trim().match(/^(\w+)\s+[A-Za-z_]\w*/);
      if (field) { documentation.set(model + '.' + field[1], [...pending, comment].filter(Boolean).join('\n')); pending = []; }
      else if (comment) pending.push(comment);
      else if (code.trim() || !line.trim()) pending = [];
    }
    if (code.includes('}')) { model = null; pending = []; }
    return code;
  }).join('\n');

  // parse enums first
  const enums = Object.create(null);
  const enumRegex = /enum\s+([A-Za-z_]\w*)\s*\{([\s\S]*?)\}/g;
  let me;
  while ((me = enumRegex.exec(noComments)) !== null) {
    const enumName = me[1];
    const body = me[2].trim();
    const items = body.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => l.split(/\s+/)[0]);
    enums[enumName] = items;
  }

  // parse models
  const modelRegex = /model\s+([A-Za-z_]\w*)\s*\{([\s\S]*?)\}/g;
  const models = Object.create(null);
  let m;
  while ((m = modelRegex.exec(noComments)) !== null) {
    const modelName = m[1];
    const body = m[2].trim();
    const lines = body.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const fields = [];
    const uniqueConstraints = parseModelUniqueConstraints(lines);

    for (let line of lines) {
      // Model-level constraints (for example @@index and @@unique) are not
      // fields. Treating them as fields creates bogus SQLite columns such as
      // "@@index([campaignId," and breaks schemas that use standard Prisma
      // annotations.
      if (line.startsWith("@@")) continue;

      // skip enum-like or other declarations accidentally inside model
      if (!line) continue;
      // field parsing
      // capture: name, type(with []?), optional ? and the rest (attributes)
      const parts = line.split(/\s+/);
      const name = parts[0];
      const rest = line.slice(name.length).trim();

      const typeMatch = rest.match(/^([A-Za-z_]\w*(\[\])?)(\?)?/);
      if (!typeMatch) continue;
      const rawType = typeMatch[1];
      const isList = rawType.endsWith("[]");
      const baseType = isList ? rawType.slice(0, -2) : rawType;
      const isOptional = !!typeMatch[3];
      const attrString = rest.slice(typeMatch[0].length).trim();

      const attrs = parseAttributes(attrString);

      const defaultAttr = attrs.find(a => a.name === "default");
      const defaultRaw = defaultAttr ? defaultAttr.args[0]?.value?.trim() : null;
      const isId = attrs.some(a => a.name === "id");
      const isUnique = attrs.some(a => a.name === "unique");

      const relAttr = attrs.find(a => a.name === "relation");

      fields.push({
        name,
        type: baseType,
        isList,
        isOptional,
        isId,
        isUnique,
        default: defaultRaw ? defaultRaw : null,
        rawAttributes: attrs,
        ...(documentation.get(modelName + '.' + name) ? { description: documentation.get(modelName + '.' + name) } : {}),
        relation: relAttr ? relAttr : null
      });
    }

    for (const field of fields) {
      if (field.isUnique) uniqueConstraints.push({ fields: [field.name], source: 'field' });
    }

    models[modelName] = { fields, uniqueConstraints };
  }

  return { models, enums };
}

module.exports = { loadPrismaModels, parseScribaSchema };
