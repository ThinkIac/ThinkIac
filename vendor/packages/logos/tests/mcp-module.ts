// Test adapter for the external MCP capability.
import { createRequire } from 'node:module';
import { createRuntimeContext } from '../src/kernel/context';
import { resolveConditions } from '../src/kernel/conditions';
import { loadMcpTools } from '../src/modules/tools';

const require = createRequire(import.meta.url);
const { createRuntimeModule } = require('../../modules/mcp');

export function mcpApi(container: any) {
  return createRuntimeModule({
    createContext: createRuntimeContext,
    resolveConditions,
    loadTools: (workspace: string) => loadMcpTools(container, workspace),
    state: (namespace: string) => container.state(namespace),
    log: () => {},
  }).api;
}
