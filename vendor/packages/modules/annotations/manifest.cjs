'use strict';
function create(scanners) {
const exports = {};
// kernel/manifest.ts — auto-generates a machine-readable capability manifest
// for a package.
//
// Every SOTA agent framework has some notion of a package/plugin manifest
// (an MCP server's tool list, a LangChain plugin's schema, a CrewAI tool
// registry) so other tools — a registry, a crew builder, another agent —
// can discover what a package offers without reading its source. Lógos
// packages already declare all of this via @register_tool/@register_hook/
// @register_router/@register_command JSDoc tags, scanned by kernel/scan.ts
// for the runtime's own wiring. This module reuses that exact scan output
// instead of asking package authors to hand-write a second, parallel
// description of the same capabilities (which would drift immediately).
'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateManifest = generateManifest;
exports.writeManifest = writeManifest;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const scan_1 = scanners;
function readPackageJson(folderPath) {
    try {
        return JSON.parse(fs_1.default.readFileSync(path_1.default.join(folderPath, 'package.json'), 'utf-8'));
    }
    catch {
        return {};
    }
}
async function generateManifest(agentFolder) {
    const folderPath = (0, scan_1.resolveAgentFolder)(agentFolder);
    if (!folderPath)
        throw new Error('Folder not found');
    const pkgJson = readPackageJson(folderPath);
    const [tools, hooks, routes, commands] = await Promise.all([
        (0, scan_1.registerTools)(folderPath),
        (0, scan_1.registerHooks)(folderPath),
        (0, scan_1.registerRoutes)(folderPath),
        (0, scan_1.registerCommands)(folderPath),
    ]);
    return {
        name: pkgJson.name || path_1.default.basename(folderPath),
        version: pkgJson.version,
        description: pkgJson.description,
        tools: tools.map((t) => ({
            name: t.name, description: t.description ?? null, parameters: t.parameters,
            reach: t.reach || 'auto', recoveryPolicy: t.recoveryPolicy || null,
            reconcileTool: t.reconcileTool || null,
        })),
        hooks: hooks.map((h) => ({ event: h.event, priority: h.priority })),
        routes: routes.map((r) => ({ path: r.path, method: r.method })),
        commands: commands.map((c) => ({ name: c.name, description: c.description ?? null, parameters: c.parameters, ...(c.order ? { order: c.order } : {}) })),
        generatedAt: new Date().toISOString(),
    };
}
// Writes the manifest as <folder>/logos.json and returns the path written.
// Not wired into boot/reload — this is an on-demand snapshot (CLI, kernel
// tool, or a registry's own CI step), not a file the runtime reads back.
async function writeManifest(agentFolder, outFile = 'logos.json') {
    const folderPath = (0, scan_1.resolveAgentFolder)(agentFolder);
    if (!folderPath)
        throw new Error('Folder not found');
    const manifest = await generateManifest(folderPath);
    const outPath = path_1.default.join(folderPath, outFile);
    fs_1.default.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
    return outPath;
}

return exports;
}
module.exports = { create };
