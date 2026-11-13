// modules/tools.ts — tool execution with conditions, lifecycle events and
// package middleware (wire phase). Also home of the kernel tools that let an
// agent operate the runtime itself (runtime_commit, runtime_status).
'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.toolsModule = void 0;
exports.toolToMcp = toolToMcp;
exports.kernelTools = kernelTools;
exports.loadMcpTools = loadMcpTools;
const node_path_1 = __importDefault(require("node:path"));
const scan_1 = require("./tools-bridge.cjs");
const conditions_1 = require("./tools-bridge.cjs");
const context_1 = require("./tools-bridge.cjs");
const middleware_1 = require("./tools-bridge.cjs");
const manifest_1 = require("./tools-bridge.cjs");
const debug_log_1 = require("./tools-bridge.cjs");
const isolation_1 = require("./tools-bridge.cjs");
const authority_context_1 = require("./tools-bridge.cjs");
const bridge_1 = require("./tools-bridge.cjs");
function qualifiedTool(pkgFolder, toolName) {
    if (!pkgFolder)
        return `system.${toolName}`;
    return toolName.startsWith(`${pkgFolder}.`) ? toolName : `${pkgFolder}.${toolName}`;
}
function toolOwner(container, tool, agentFolder) {
    const source = typeof tool?._file === 'string' ? tool._file : agentFolder;
    const relative = node_path_1.default.relative(container.workspace, source);
    if (!relative || relative.startsWith('..') || node_path_1.default.isAbsolute(relative))
        return null;
    const owner = relative.split(node_path_1.default.sep)[0];
    return owner && owner !== '.' ? owner : null;
}
function toolToMcp(container, tool, pkgFolder) {
    const provider = pkgFolder ? { kind: 'package', id: pkgFolder } : authority_context_1.SYSTEM_PRINCIPAL;
    container.authority.enforce({
        principal: provider,
        surface: 'tools',
        operation: 'provide',
        resource: qualifiedTool(pkgFolder, tool.name),
    });
    return {
        name: tool.name,
        qualifiedName: qualifiedTool(pkgFolder, tool.name),
        description: tool.description || '',
        inputSchema: tool.parameters || { type: 'object', properties: {} },
        condition: tool.condition || null,
        reach: tool.reach || 'auto',
        recoveryPolicy: tool.recoveryPolicy || null,
        reconcileTool: tool.reconcileTool || null,
        async handler(args, context = (0, context_1.createRuntimeContext)()) {
            const caller = (0, authority_context_1.currentAuthority)().principal;
            container.authority.enforce({
                principal: caller,
                surface: 'tools',
                operation: 'invoke',
                resource: qualifiedTool(pkgFolder, tool.name),
            });
            const allowed = await (0, conditions_1.resolveConditions)(tool.condition || {}, context);
            if (!allowed)
                throw new Error(`Tool not available in this context: ${tool.name}`);
            // `veto` no lugar de `emit`: os mesmos handlers de `tool_before` rodam,
            // mas agora um deles pode BARRAR a execução devolvendo `false` ou
            // `{ veto: true, reason }` — é aqui que uma política (governança) entra.
            // Antes o evento era só aviso, então quem chamasse por um transporte sem
            // gate próprio (o MCP HTTP, por exemplo) executava a tool de qualquer
            // jeito. Handler que só observa devolve o payload e não bloqueia nada.
            // sessionId sai do contexto do transporte: sem ele a política da sessão e
            // a auditoria não têm a quem atribuir a chamada.
            const sessionId = context?.sessionId ?? null;
            const gate = await (0, authority_context_1.runAsSystem)(container.authority, () => container.bus.veto('tool_before', { tool: tool.name, payload: args, sessionId }, context));
            if (!gate.allowed) {
                const reason = gate.reason || `Tool blocked by ${gate.by ?? 'runtime policy'}: ${tool.name}`;
                await (0, authority_context_1.runAsSystem)(container.authority, () => container.bus.emit('tool_after', { tool: tool.name, sessionId, payload: { blocked: true, error: reason, code: gate.code } }, context));
                const err = new Error(reason);
                // TOOL_BLOCKED é o genérico de quem vetou sem se identificar; quem
                // manda um código próprio (MISSING_SESSION, GOVERNANCE_BLOCKED,
                // CONFIRMATION_REQUIRED, CONFIRMATION_DENIED) chega intacto até o
                // transporte, que traduz cada um no seu status HTTP.
                err.code = gate.code || 'TOOL_BLOCKED';
                err.blockedBy = gate.by ?? null;
                err.details = gate.details ?? null;
                throw err;
            }
            const execute = async () => {
                const middlewares = await (0, middleware_1.resolveMiddlewares)(pkgFolder ?? container.workspace, context);
                return (0, middleware_1.runMiddlewares)(middlewares, context, async () => tool.call(args, context));
            };
            const result = pkgFolder
                ? await (0, authority_context_1.runAsPackage)(container.authority, pkgFolder, execute)
                : await (0, authority_context_1.runAsSystem)(container.authority, execute);
            await (0, authority_context_1.runAsSystem)(container.authority, () => container.bus.emit('tool_after', { tool: tool.name, sessionId, payload: result }, context));
            return result;
        },
    };
}
/** Tools the kernel itself offers to agents (self-modification control loop). */
function kernelTools(container) {
    return [
        {
            name: 'runtime_commit',
            description: 'Commits pending file changes of a package: validates in staging and swaps atomically if healthy. Use after finishing a multi-file edit.',
            inputSchema: {
                type: 'object',
                properties: { package: { type: 'string', description: 'Package folder name' } },
                required: ['package'],
            },
            condition: null,
            async handler(args) {
                return container.bus.pipeline('reload:commit', { pkg: args.package, requestedBy: 'tool' });
            },
        },
        {
            name: 'runtime_activate_package',
            description: 'Safely discovers and activates a package created while the runtime is running. It validates and wires only that package; it never restarts the process.',
            inputSchema: { type: 'object', properties: { package: { type: 'string', description: 'Package folder name' } }, required: ['package'] },
            condition: null,
            async handler(args) {
                const activate = container.state('runtime').get('activatePackage');
                if (typeof activate !== 'function')
                    return { ok: false, error: 'Package activation is unavailable before runtime initialization.' };
                return activate(args.package, 'manual');
            },
        },
        {
            name: 'runtime_package_diagnostics',
            description: 'Reports package discovery and activation diagnostics without exposing credentials or source content.',
            inputSchema: { type: 'object', properties: { package: { type: 'string', description: 'Optional package folder name' } } },
            condition: null,
            async handler(args) {
                const diagnostics = container.state('runtime').get('packageDiagnostics');
                if (typeof diagnostics === 'function')
                    return diagnostics(args?.package);
                return { workspaceWatcher: false, package: args?.package ?? null, state: null, error: 'Runtime diagnostics are unavailable before initialization.' };
            },
        },
        {
            name: 'runtime_reboot_impact',
            description: 'Returns what a FULL runtime restart would cost right now: packages that declare themselves critical (runtime.isolation.critical) and the live WebSocket sessions that would be dropped. Check this before rebooting — reloading a single package (runtime_commit) is almost always enough.',
            inputSchema: { type: 'object', properties: {} },
            condition: null,
            async handler() {
                const verdict = await (0, isolation_1.requestReboot)(container, { reason: 'impact check' });
                return {
                    rebootAdvised: verdict.allowed,
                    blockedBy: verdict.blockedBy ?? null,
                    criticalPackages: verdict.impact.critical,
                    liveSessions: verdict.impact.liveSessions,
                };
            },
        },
        {
            name: 'runtime_status',
            description: 'Returns the lifecycle state of every package (active, staging, failed, rolled_back) and last reload errors.',
            inputSchema: { type: 'object', properties: {} },
            condition: null,
            async handler() {
                return { packages: container.registry.snapshot(), errors: (0, debug_log_1.getErrors)().slice(-10) };
            },
        },
        {
            name: 'runtime_manifest',
            description: 'Returns a package\'s capability manifest (tools, hooks, routes, commands) derived from its @register_* JSDoc tags — use to discover what a package offers before wiring it into a crew or flow.',
            inputSchema: {
                type: 'object',
                properties: { package: { type: 'string', description: 'Package folder name' } },
                required: ['package'],
            },
            condition: null,
            async handler(args) {
                return (0, manifest_1.generateManifest)(args.package);
            },
        },
    ];
}
async function loadMcpTools(container, agentFolder) {
    const isolated = (0, bridge_1.getIsolatedRunner)(container, node_path_1.default.basename(agentFolder));
    const tools = isolated?.surfaces?.tools.map(tool => ({ ...tool, _file: agentFolder, call: (args, context) => isolated.invoke(tool.id, [args], context) })) ?? await (0, scan_1.registerTools)(agentFolder);
    return tools.map((tool) => {
        const owner = toolOwner(container, tool, agentFolder);
        const principal = owner ? { kind: 'package', id: owner } : authority_context_1.SYSTEM_PRINCIPAL;
        container.authority.enforce({
            principal,
            surface: 'tools',
            operation: 'expose',
            resource: qualifiedTool(owner, tool.name),
        });
        return toolToMcp(container, tool, owner);
    });
}
exports.toolsModule = {
    name: 'tools',
    phase: 'wire',
    install(container) {
        container.state('tools').set('kernel', kernelTools(container));
        // Bridge used by the "run_runtime_tool" builtin (and any other caller)
        // to invoke a package's @register_tool function by name. Previously
        // "tool:call" had no listener anywhere, so run_runtime_tool always
        // silently no-op'd (dispatchEvent just echoed the payload back).
        container.bus.on('tool:call', async (payload, ctx) => {
            const { package: pkgFolder, tool: toolName, args } = payload || {};
            if (!pkgFolder || !toolName) {
                return { success: false, error: 'package e tool sao obrigatorios' };
            }
            let tools;
            try {
                const isolated = (0, bridge_1.getIsolatedRunner)(container, pkgFolder);
                tools = isolated?.surfaces?.tools.map(tool => ({ ...tool, _file: container.registry.getPackage(pkgFolder).dir, call: (input, context) => isolated.invoke(tool.id, [input], context) })) ?? await (0, scan_1.registerTools)(pkgFolder);
            }
            catch (err) {
                return { success: false, error: `Pacote "${pkgFolder}" nao encontrado: ${err.message}` };
            }
            const toolDef = tools.find((t) => t.name === toolName);
            if (!toolDef) {
                return { success: false, error: `Tool "${toolName}" nao encontrada no pacote "${pkgFolder}"` };
            }
            try {
                const wrapped = toolToMcp(container, toolDef, pkgFolder);
                return await wrapped.handler(args, ctx ?? (0, context_1.createRuntimeContext)());
            }
            catch (err) {
                return { success: false, error: err.message };
            }
        });
    },
};
//# sourceMappingURL=tools.js.map