import { readFileSync } from 'node:fs';
import { parse } from 'acorn';

// Execute the current implementation before extraction, with a per-test state.
export function createShellController(state) {
  const source = readFileSync(new URL('../../views/Index.svelte', import.meta.url), 'utf8').split('<script>')[1].split('</script>')[0];
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const functions = ast.body.flatMap(node => node.type === 'ExportNamedDeclaration' ? [node.declaration] : [node]).filter(node => node?.type === 'FunctionDeclaration');
  const code = functions.map(node => source.slice(node.start, node.end)).join('\n');
  return Function('state', `with (state) { ${code}; return { ${functions.map(node => node.id.name).join(',')} }; }`)(state);
}
