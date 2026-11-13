// Experimental compilation gate. Not registered in SvelteEngine until the
// complete frontend contract, including loading and aliases, is validated.
// Uses the public Svelte AST and public store subscription contract only.
export function transformSharedState(source: string): string {
  const { parse } = require('svelte/compiler');
  const ast = parse(source);
  const script = ast.instance?.content;
  if (!script) return source;
  const declared = new Set<string>();
  function names(pattern: any) {
    if (!pattern) return;
    if (pattern.type === 'Identifier') declared.add(pattern.name);
    else if (pattern.type === 'ObjectPattern') pattern.properties.forEach((p: any) => names(p.value ?? p.argument));
    else if (pattern.type === 'ArrayPattern') pattern.elements.forEach(names);
    else if (pattern.type === 'AssignmentPattern') names(pattern.left);
    else if (pattern.type === 'RestElement') names(pattern.argument);
  }
  for (const statement of script.body) {
    const node = statement.declaration ?? statement;
    if (node.type === 'ImportDeclaration') node.specifiers.forEach((s: any) => names(s.local));
    if (node.type === 'VariableDeclaration') node.declarations.forEach((d: any) => names(d.id));
    if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') names(node.id);
  }
  if (declared.has('useState')) return source;
  const calls: any[] = [];
  function walk(node: any, visit: (node: any) => void) {
    if (!node || typeof node !== 'object') return;
    if (typeof node.type === 'string') visit(node);
    for (const [key, value] of Object.entries(node)) {
      if (key === 'parent') continue;
      if (Array.isArray(value)) value.forEach(item => walk(item, visit));
      else if (value && typeof value === 'object') walk(value, visit);
    }
  }
  walk(script, node => {
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'useState') calls.push(node);
  });
  if (!calls.length) return source;
  let prefix = '__scriba';
  while (source.includes(prefix)) prefix += '_';
  const edits: Array<{ start: number; end: number; value: string }> = [];
  const bindings = new Set<string>();
  const accepted = new Set<any>();
  const declarations = script.body.filter((s: any) => s.type === 'VariableDeclaration');
  for (const declaration of declarations) {
    for (const d of declaration.declarations) {
      if (calls.includes(d.init) && d.id.type === 'Identifier') {
        bindings.add(d.id.name);
        accepted.add(d.init);
        edits.push({ start: d.init.callee.start, end: d.init.callee.end, value: `${prefix}.useState` });
      }
    }
  }
  if (calls.some(call => !accepted.has(call))) throw new Error('useState requires a top-level identifier declaration');
  // Track direct nested aliases without turning primitive destructuring into
  // a live binding. Arbitrary helper-returned aliases still need a decision.
  let added = true;
  while (added) {
    added = false;
    for (const declaration of declarations) for (const d of declaration.declarations) {
      let root = d.init;
      while (root?.type === 'MemberExpression') root = root.object;
      if (d.id.type === 'Identifier' && root?.type === 'Identifier' && bindings.has(root.name) && !bindings.has(d.id.name)) {
        bindings.add(d.id.name); added = true;
      }
    }
  }
  for (const declaration of declarations) {
    if (declaration.kind === 'const' && declaration.declarations.some((d: any) => bindings.has(d.id.name))) {
      edits.push({ start: declaration.start, end: declaration.start + 5, value: 'let' });
    }
  }
  // Svelte 4 cannot see dependencies hidden inside local helper functions.
  // Follow their lexical references and make those reads explicit, without
  // rerunning unrelated template expressions on every document notification.
  const dependentHelpers = new Set<string>();
  const helpers = script.body.filter((s: any) => s.type === 'FunctionDeclaration');
  let found = true;
  while (found) {
    found = false;
    for (const helper of helpers) {
      if (dependentHelpers.has(helper.id.name)) continue;
      let depends = false;
      walk(helper.body, node => {
        if (node.type === 'Identifier' && (bindings.has(node.name) || dependentHelpers.has(node.name))) depends = true;
      });
      if (depends) { dependentHelpers.add(helper.id.name); found = true; }
    }
  }
  function indirect(expression: any) {
    let yes = false;
    walk(expression, node => {
      if (node.type === 'CallExpression' && dependentHelpers.has(node.callee.name)) yes = true;
    });
    return yes;
  }
  function wrapExpression(expression: any) {
    edits.push({ start: expression.start, end: expression.start, value: `($${prefix}, ` });
    edits.push({ start: expression.end, end: expression.end, value: ')' });
  }
  for (const statement of script.body) {
    if (statement.type !== 'LabeledStatement' || statement.label.name !== '$') continue;
    const expression = statement.body.expression;
    if (expression?.type === 'AssignmentExpression' && indirect(expression.right)) wrapExpression(expression.right);
  }
  walk(ast.html, node => {
    if (['MustacheTag', 'RawMustacheTag', 'IfBlock', 'EachBlock'].includes(node.type) && indirect(node.expression)) {
      wrapExpression(node.expression);
    }
  });
  const refresh = [...bindings].map(name => `${name} = ${name};`).join('\n');
  edits.push({ start: script.start, end: script.start, value:
    `\nimport { createViewScope as ${prefix}Create } from 'logos:scriba-view';\n` +
    `import { onDestroy as ${prefix}Destroy } from 'svelte';\n` +
    `const ${prefix} = ${prefix}Create();\n${prefix}Destroy(${prefix}.destroy);\n` });
  edits.push({ start: script.end, end: script.end, value: `\n$: { $${prefix}; ${refresh} }\n` });
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    source = source.slice(0, edit.start) + edit.value + source.slice(edit.end);
  }
  return source;
}
