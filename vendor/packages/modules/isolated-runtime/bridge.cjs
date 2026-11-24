'use strict';
const libraries = new WeakMap();
function createBridge(runAsPackage) {
if (libraries.has(runAsPackage)) return libraries.get(runAsPackage);
const exports = {};
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withStagedIsolated = withStagedIsolated;
exports.isolatedRunnerFor = isolatedRunnerFor;
exports.getIsolatedRunner = getIsolatedRunner;
exports.stopIsolatedRunner = stopIsolatedRunner;
const node_async_hooks_1 = require("node:async_hooks");
const { IsolatedRunner } = require('./runner.cjs');
const stagingRunner = new node_async_hooks_1.AsyncLocalStorage();
function withStagedIsolated(container, folder, runner, work) {
    return stagingRunner.run({ container, folder, runner }, work);
}
/** Starts an isolated package before any public surface is wired. */
async function isolatedRunnerFor(container, pkg, publish = true) {
    if (pkg?.isolated !== true && pkg?.runtime?.mode !== 'isolated')
        return null;
    const runners = container.state('isolated');
    let runner = runners.get(pkg.folder);
    if (publish && runner?.running)
        return runner;
    runner = new IsolatedRunner({
        folder: pkg.folder,
        dir: pkg.dir,
        // Do not inherit host credentials or arbitrary environment values.
        env: { NODE_ENV: process.env.NODE_ENV ?? 'production' },
        onExit: event => {
            if (!event.expected && runners.get(pkg.folder) === runner) {
                void container.bus.emit('isolated:exit', { pkg: pkg.folder, ...event }).catch(error => container.log(error.message));
            }
        },
        onLog: message => container.log(`[isolated:${pkg.folder}] ${message}`),
        onEvent: async (event, payload) => runAsPackage(container.authority, pkg.folder, async () => {
            container.authority.enforce({ principal: { kind: 'package', id: pkg.folder }, surface: 'events', operation: 'publish', resource: event });
            await container.bus.emit(event, payload, { pkg });
            return undefined;
        }),
        onCapability: async (request) => {
            const provider = container.state('runtime:capabilities').get(request.surface);
            if (typeof provider !== 'function')
                throw new Error(`Unsupported isolated capability: ${request.surface}`);
            return runAsPackage(container.authority, pkg.folder, () => provider(request, Object.freeze({ package: pkg.folder })));
        },
    });
    await runner.start();
    if (publish)
        runners.set(pkg.folder, runner);
    return runner;
}
function getIsolatedRunner(container, folder) {
    const staged = stagingRunner.getStore();
    if (staged?.container === container && staged.folder === folder)
        return staged.runner;
    return container.state('isolated').get(folder) ?? null;
}
async function stopIsolatedRunner(container, folder, reason) {
    const runner = getIsolatedRunner(container, folder);
    container.state('isolated').delete(folder);
    await runner?.stop(reason);
}

libraries.set(runAsPackage, exports);
return exports;
}
module.exports = { createBridge };
