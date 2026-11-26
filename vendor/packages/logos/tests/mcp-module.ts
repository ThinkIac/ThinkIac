// Test adapter for the external MCP capability.
import { externalModulePath } from '../src/kernel/module-resolution';
import { createRuntimeContext } from '../src/kernel/context';
import { resolveConditions } from '../src/kernel/conditions';
import { loadMcpTools } from '../src/modules/tools';

const { createRuntimeModule } = require(externalModulePath('mcp'));

export function mcpApi(container: any) {
  return createRuntimeModule({
    createContext: createRuntimeContext,
    resolveConditions,
    loadTools: (workspace: string) => loadMcpTools(container, workspace),
    state: (namespace: string) => container.state(namespace),
    log: () => {},
  }).api;
}
