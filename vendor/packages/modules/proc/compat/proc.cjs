// Legacy public compatibility implementation, owned by module-proc.
module.exports = function(require, module, exports, __dirname, __filename, kernel) {
// Process-module integration for the external JSONL bridge.
'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startProcessModule = startProcessModule;
exports.stopProcessModule = stopProcessModule;
const path_1 = __importDefault(require("path"));
const { ProcessBridge } = require('@thinkiac/module-process-bridge');
/** Connects the host bus and lifecycle to the reusable transport. */
class ProcBridge extends ProcessBridge {
    container;
    folder;
    unsubscribes = [];
    scope;
    constructor(container, opts) {
        let self;
        super({
            name: opts.name, cwd: opts.dir, runtime: opts.runtime, main: opts.main,
            onRegister: (patterns) => patterns.forEach(pattern => self.subscribe(pattern)),
            onEmit: (event, payload) => container.bus.emit(event, payload),
            onLog: (message, kind) => kind === 'stderr' ? process.stderr.write(`[proc:${opts.name}] ${message}`) : container.log(`[proc] "${opts.name}" ${message}`),
            onError: (error) => container.log(`[proc] ${opts.name}: ${error.message}`),
            onExit: ({ code, signal }) => {
                container.bus.emit('proc:crashed', { module: opts.name, code });
                const supervisor = container.state('supervisor').get('controller');
                if (!supervisor)
                    return false;
                void supervisor.scheduleProc(opts.folder ?? opts.name, async () => {
                    if (self.stopped)
                        return { ok: false, error: 'Bridge stopped' };
                    self.start();
                    return { health: 'unknown' };
                }, { code, signal });
                return true;
            },
        });
        self = this;
        this.container = container;
        this.folder = opts.folder ?? opts.name;
        this.scope = opts.scope;
        for (const pattern of opts.events || [`${opts.name}:*`])
            this.subscribe(pattern);
    }
    subscribe(pattern) {
        const off = this.container.bus.on(pattern, (payload) => this.call(pattern, payload), { owner: `proc:${this.name}`, priority: 100, scope: this.scope });
        this.unsubscribes.push(off);
    }
    stop() {
        this.container.state('supervisor').get('controller')?.cancel(this.folder);
        for (const off of this.unsubscribes)
            off();
        super.stop();
    }
}
/** Spawns bridges for every workspace module declared with a non-node runtime. */
function startProcessModule(container, pkg) {
    const rt = pkg.runtime || {};
    const runtime = rt.runtime;
    if (!runtime || runtime === 'node')
        return null;
    const scope = container.getPackageScope(pkg.folder) ??
        container.createPackageScope(pkg.folder, String(Date.now()));
    const bridge = new ProcBridge(container, {
        folder: pkg.folder,
        name: rt.name || pkg.folder,
        dir: pkg.dir,
        runtime,
        main: path_1.default.join(pkg.dir, rt.main || 'main.py'),
        events: rt.events || [`${rt.name || pkg.folder}:*`],
        scope,
    });
    bridge.start();
    scope.defer(() => bridge.stop(), { kind: 'process', label: rt.name || pkg.folder });
    container.state('proc').set(pkg.folder, bridge);
    return bridge;
}
async function stopProcessModule(container, folder) {
    const bridge = container.state('proc').get(folder);
    if (bridge) {
        bridge.stop();
        container.state('proc').delete(folder);
    }
    await container.disposePackageScope(folder, 'process_module_stopped');
}

};
