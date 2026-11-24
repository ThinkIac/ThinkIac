'use strict';
const { createLibrary } = require('./library.cjs');
function createRuntimeModule(host) {
    const library = createLibrary(host.kernelPrimitives());
    // Preparation runs before workspace module entrypoints are imported.
    const dependencies = new (library('dependencies').DependencyInstaller)({
        workspace: host.workspace(), log: message => host.log(message),
    });
    host.on('logos:package:preparing', async ({ pkg }) => {
        if (!host.state('supervisor').get('controller')?.bootBlock(pkg))
            await dependencies.ensureDeps(pkg.folder);
    });
    let container;
    let stabilizer;
    let checkpoints;
    host.on('logos:starting', () => {
        checkpoints = new (library('checkpoint').CheckpointStore)(host.workspace());
        library('crashguard').bootAttempt(host.workspace(), checkpoints);
    });
    let removePackageFaultRecovery = () => { };
    const packageRecoveryJobs = new Map();
    let closing;
    const close = () => closing || (closing = (async () => {
        removePackageFaultRecovery();
        const results = await Promise.allSettled([stabilizer?.close(), ...packageRecoveryJobs.values()]);
        const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
        if (failures.length)
            throw new AggregateError(failures, 'Stabilization shutdown failed');
    })());
    return {
        name: 'stabilizer', phase: 'boot', swappable: false,
        close,
        install(c) {
            container = c;
            stabilizer = new (library('index').Stabilizer)(container, checkpoints);
            container.state('runtime').set('stabilizer', stabilizer);
            const registerPackageFaultRecovery = host.kernelPrimitives()['../kernel/package-fault-recovery'].registerPackageFaultRecovery;
            const packageFaultTimes = new Map();
            removePackageFaultRecovery = registerPackageFaultRecovery(container.authority, (folder, error, source) => {
                if (packageRecoveryJobs.has(folder))
                    return;
                const now = Date.now();
                const times = (packageFaultTimes.get(folder) || []).filter(at => now - at < 60_000);
                times.push(now);
                packageFaultTimes.set(folder, times);
                const quarantine = times.length >= 3;
                const detail = error instanceof Error ? error.message : String(error);
                container.log('[recovery] ' + source + ' in package "' + folder + '": ' + detail);
                const job = (async () => {
                    await new Promise(resolve => setImmediate(resolve));
                    try {
                        const result = await host.authority.runAsSystem(container.authority, () => quarantine
                            ? library('isolation').stopPackage(container, folder, { force: true })
                            : library('isolation').startPackage(container, folder));
                        if (!result?.ok)
                            throw new Error(result?.error || 'package recovery failed');
                        container.log(quarantine
                            ? '[recovery] "' + folder + '" stopped after repeated failures; runtime remains active'
                            : '[recovery] "' + folder + '" restarted; runtime remains active');
                    }
                    catch (recoveryError) {
                        container.log('[recovery] could not recover "' + folder + '": ' + (recoveryError?.message || recoveryError));
                        if (!quarantine) {
                            try {
                                await host.authority.runAsSystem(container.authority, () => library('isolation').stopPackage(container, folder, { force: true }));
                                container.log('[recovery] "' + folder + '" stopped after restart failed; runtime remains active');
                            }
                            catch (stopError) {
                                container.log('[recovery] could not stop "' + folder + '": ' + (stopError?.message || stopError));
                            }
                        }
                    }
                })();
                packageRecoveryJobs.set(folder, job);
                void job.finally(() => packageRecoveryJobs.delete(folder)).catch(() => { });
            });
            container.state('runtime').set('removePackageFaultRecovery', removePackageFaultRecovery);
            container.state('runtime').set('packageDiagnostics', folder => stabilizer.diagnostics(folder));
            host.on('package:activating', async ({ pkg }) => {
                await stabilizer.ensureDeps(pkg.folder);
                stabilizer.watchPackage(pkg.folder);
            });
            host.on('package:added', ({ pkg }) => stabilizer.checkpoints.commitStable(pkg, 'new-package'));
            host.on('logos:ready', () => library('crashguard').bootStable(container.workspace));
            host.on('logos:stopping', close);
        },
        start() {
            const packages = container.registry.discover().filter(pkg => !['stopped', 'blocked'].includes(container.registry.getState(pkg.folder)?.state));
            if (stabilizer.enabled())
                for (const pkg of packages)
                    stabilizer.watchPackage(pkg.folder);
            stabilizer.watchWorkspace(packages.map(pkg => pkg.folder), folder => container.state('runtime').get('activatePackage')(folder, 'watcher'));
            stabilizer.checkpoints.commitStable(null, 'boot');
        },
    };
}
module.exports = { createRuntimeModule, createLibrary };

// Compatibility factories resolve their SDK from their own dependency graph.
module.exports.createHost = (...args) => requireCapabilityDependency('@thinkiac/module-runtime-compat', '../runtime-compat').createHost(...args);

function requireCapabilityDependency(name, local) {
  let entry;
  try { entry = require.resolve(name); }
  catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    entry = require.resolve(local);
  }
  return require(entry);
}
