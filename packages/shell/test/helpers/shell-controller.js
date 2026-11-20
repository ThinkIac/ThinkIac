import { createChatEvents } from '../../views/controllers/chat_events.js';
import { createSessionLoading } from '../../views/controllers/session_loading.js';
import { createChatCommands } from '../../views/controllers/chat_commands.js';
import { readFileSync } from 'node:fs';
import { parse } from 'acorn';

// Execute the current implementation before extraction, with a per-test state.
export function createShellController(state) {
  const source = readFileSync(new URL('../../views/Index.svelte', import.meta.url), 'utf8').split('<script>')[1].split('</script>')[0];
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const functions = ast.body.flatMap(node => node.type === 'ExportNamedDeclaration' ? [node.declaration] : [node]).filter(node => node?.type === 'FunctionDeclaration');
  const legacy = functions.filter(node => !/^\s*return (chatEvents|sessionLoading|chatCommands)\./.test(source.slice(node.body.start + 1, node.body.end - 1)));
  const code = legacy.map(node => source.slice(node.start, node.end)).join('\n');
  const remaining = Function('state', `with (state) { ${code}; return { ${legacy.map(node => node.id.name).join(',')} }; }`)(state);
  const methods = {...remaining};
  const deps = new Proxy(state, {get: (target, key) => methods[key] ?? target[key]});
  Object.assign(methods, createChatEvents({state, deps}), createSessionLoading({state, deps}), createChatCommands({state, deps}));
  Object.assign(state, methods);
  return methods;
}
