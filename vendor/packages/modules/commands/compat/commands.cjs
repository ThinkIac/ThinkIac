// Legacy public compatibility implementation, owned by module-commands.
module.exports = function(require, module, exports, __dirname, __filename, kernel) {
// modules/commands.ts — command execution (CLI + programmatic).
// v1 API preserved: runCommand(workspace, name, args, context).
'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.commandsModule = void 0;
exports.runCommand = runCommand;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const scan_1 = require("../kernel/scan");
const conditions_1 = require("../kernel/conditions");
const context_1 = require("../kernel/context");
const middleware_1 = require("../kernel/middleware");
async function runCommand(workspace, name, args = {}, context = (0, context_1.createRuntimeContext)()) {
    // A CLI target such as `billing:reconcile` must never resolve a same-named
    // command from another package. Programmatic callers without `pkg` retain
    // the legacy workspace-wide scan.
    const packageFolder = context?.pkg;
    const commandWorkspace = packageFolder
        ? path_1.default.join(workspace, packageFolder)
        : workspace;
    if (packageFolder && (!fs_1.default.existsSync(commandWorkspace) || !fs_1.default.statSync(commandWorkspace).isDirectory())) {
        throw new Error(`Package not found: ${packageFolder}`);
    }
    const commands = await (0, scan_1.registerCommands)(commandWorkspace);
    const command = commands.find((c) => c.name === name);
    if (!command)
        throw new Error(`Command not found: ${name}`);
    const allowed = await (0, conditions_1.resolveConditions)(command.condition || {}, context);
    if (!allowed)
        throw new Error(`Command not available in this context: ${name}`);
    const middlewares = await (0, middleware_1.resolveMiddlewares)(commandWorkspace, context);
    return (0, middleware_1.runMiddlewares)(middlewares, context, async () => command.call(args, context));
}
exports.commandsModule = {
    name: 'commands',
    phase: 'wire',
    install(container) {
        container.bus.on('command:run', async (payload, ctx) => {
            return runCommand(payload.workspace ?? container.workspace, payload.name, payload.args, ctx);
        }, { priority: 50 });
    },
};

};
