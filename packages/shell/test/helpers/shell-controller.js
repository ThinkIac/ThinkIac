import { createWorkspacePersistence } from '../../views/controllers/workspace_persistence.js';
import { createWidgetBus } from '../../views/controllers/widget_bus.js';
import { createSessionTabs } from '../../views/controllers/session_tabs.js';
import { createSessionLoading } from '../../views/controllers/session_loading.js';
import { createRecentSessions } from '../../views/controllers/recent_sessions.js';
import { createMobileNavigation } from '../../views/controllers/mobile_navigation.js';
import { createDesktopIntegration } from '../../views/controllers/desktop_integration.js';
import { createChatEvents } from '../../views/controllers/chat_events.js';
import { createChatCommands } from '../../views/controllers/chat_commands.js';
import { createAppTabs } from '../../views/controllers/app_tabs.js';
import { createAppNavigation } from '../../views/controllers/app_navigation.js';
import { readFileSync } from 'node:fs';
import { parse } from 'acorn';

// Execute the current implementation before extraction, with a per-test state.
export function createShellController(state) {
  const source = readFileSync(new URL('../../views/Index.svelte', import.meta.url), 'utf8').split('<script>')[1].split('</script>')[0];
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const functions = ast.body.flatMap(node => node.type === 'ExportNamedDeclaration' ? [node.declaration] : [node]).filter(node => node?.type === 'FunctionDeclaration');
  const legacy = functions.filter(node => !/^\s*return \w+\.\w+\(\.\.\.args\);?\s*$/.test(source.slice(node.body.start + 1, node.body.end - 1)));
  const code = legacy.map(node => source.slice(node.start, node.end)).join('\n');
  const remaining = Function('state', `with (state) { ${code}; return { ${legacy.map(node => node.id.name).join(',')} }; }`)(state);
  const methods = {...remaining};
  const deps = new Proxy(state, {get: (target, key) => methods[key] ?? target[key]});
  Object.assign(methods, createAppNavigation({state, deps}), createAppTabs({state, deps}), createChatCommands({state, deps}), createChatEvents({state, deps}), createDesktopIntegration({state, deps}), createMobileNavigation({state, deps}), createRecentSessions({state, deps}), createSessionLoading({state, deps}), createSessionTabs({state, deps}), createWidgetBus({state, deps}), createWorkspacePersistence({state, deps}));
  Object.assign(state, methods);
  return methods;
}

export function createMountController(state) {
  const source = readFileSync(new URL('../../views/Index.svelte', import.meta.url), 'utf8').split('<script>')[1].split('</script>')[0];
  const ast = parse(source, {ecmaVersion:'latest',sourceType:'module'});
  const mount = ast.body.find(node=>node.type==='ExpressionStatement' && node.expression.callee?.name==='onMount').expression.arguments[0];
  return Function('state', `with (state) { return function mountShell() ${source.slice(mount.body.start,mount.body.end)}; }`)(state);
}
