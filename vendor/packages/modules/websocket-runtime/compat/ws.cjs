// Legacy public compatibility implementation, owned by module-websocket-runtime.
module.exports = function(require, module, exports, __dirname, __filename, kernel) {
// Logos adapter for the reusable WebSocket transport.
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.wsModule = void 0;
exports.getHub = getHub;
const scan_1 = require("../kernel/scan");
const context_1 = require("../kernel/context");
const authority_context_1 = require("../kernel/authority-context");
function loadWebsocketModule() { return kernel.resolveModule('websocket'); }
// The public transport belongs to packages/modules/websocket; Logos only wires
// its container, package authority and @stream route lifecycle to that hub.
const { WsHub } = loadWebsocketModule();
function getHub(container) {
    let hub = container.state('ws').get('hub');
    if (!hub) {
        hub = new WsHub();
        container.state('ws').set('hub', hub);
    }
    return hub;
}
async function mountStreamRoutes(container, pkg) {
    const hub = getHub(container);
    if (!hub.wss)
        return;
    let routes = [];
    try {
        routes = await (0, scan_1.registerRoutes)(pkg.folder);
    }
    catch {
        return;
    }
    const dropped = hub.offOwner(pkg.folder);
    if (dropped)
        container.log(`[ws] ${pkg.folder}: ${dropped} handler(s) da versão anterior removidos`);
    const scope = container.getPackageScope(pkg.folder) ??
        container.createPackageScope(pkg.folder, String(Date.now()));
    for (const route of routes.filter(r => r.stream)) {
        const channel = route.channel || route.path;
        hub.onMessage(channel, async (msg, ws, sessionId) => {
            await (0, authority_context_1.runAsPackage)(container.authority, pkg.folder, async () => {
                const context = (0, context_1.createRuntimeContext)({ pkg, sessionId, ws, osChannel: channel });
                try {
                    await route.handler(ws, context, msg);
                }
                catch (err) {
                    container.log(`[ws] error on ${channel}: ${err.message}`);
                }
            });
        }, { owner: pkg.folder, scope });
        container.log(`${pkg.name ?? pkg.folder} registered [WS:${route.direction}] /${pkg.folder}/${route.path}`);
    }
}
exports.wsModule = {
    name: 'ws',
    phase: 'wire',
    swappable: false,
    install(container) {
        container.bus.on('package:wiring', (payload) => mountStreamRoutes(container, payload.pkg), { priority: 60 });
        container.bus.on('reload:streams', (payload) => mountStreamRoutes(container, payload.pkg), { priority: 60 });
    },
};

};
