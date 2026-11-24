'use strict';
const { createScanners } = requireCapabilityDependency("@thinkiac/module-annotations", "../annotations");
const { resolveConditions } = requireCapabilityDependency("@thinkiac/module-annotations/conditions.cjs", "../annotations/conditions.cjs");
function createHost(container, kernel, subscriptions) {
  const { currentAuthority, runAsPackage, runAsSystem } = kernel.authority;
  const { createRuntimeContext } = kernel.context;
  const { appendLog, getErrors } = kernel.debug;
  const { getIsolatedRunner } = kernel.isolation;
  const scans = { ...createScanners(kernel.scan.registerGeneric), resolveAgentFolder: kernel.scan.resolveAgentFolder };
  const { registerRoutes, registerHooks, registerTools, registerCommands } = scans;
  const { loadMiddlewareSnapshot, resolveMiddlewares, runMiddlewares } = requireCapabilityDependency("@thinkiac/module-annotations/middleware.cjs", "../annotations/middleware.cjs").create(scans);
  const { generateManifest } = requireCapabilityDependency("@thinkiac/module-annotations/manifest.cjs", "../annotations/manifest.cjs").create(scans);
  const routeMountPath = (pkg, route) => route.startsWith('/') ? route : '/' + pkg + '/' + route;
  const stabilizationPorts = () => kernel.lifecycle;
  const requestReboot = (c, options) => kernel.ports['stabilizer/isolation'].requestReboot(c, options);
  const externalApi = (c, name) => {
    const api = c.state('external-api').get(name);
    if (!api) throw new Error('[logos] external capability unavailable: ' + name);
    return api;
  };
function host(container, subscriptions) {
    const subscribe = (once, event, handler, options) => {
        const off = once ? container.bus.once(event, handler, options) : container.bus.on(event, handler, options);
        subscriptions.add(off);
        return () => { subscriptions.delete(off); off(); };
    };
    return Object.freeze({
        kernelPrimitives: stabilizationPorts,
        authority: Object.freeze({ runAsSystem, runAsPackage }),
        applicationRoot: () => process.cwd(),
        workspace: () => container.workspace,
        dataDir: () => process.env.LOGOS_DATA_DIR,
        appendLog,
        currentAuthority,
        log: (message) => container.log(message),
        createContext: createRuntimeContext,
        resolveConditions,
        scanHooks: registerHooks,
        loadTools: (workspace) => externalApi(container, 'tools').loadMcpTools(workspace),
        // Keep the event port complete. External capabilities must not receive the
        // container, but lifecycle listeners need the same one-shot semantics as
        // built-in modules (for example, initialization after package wiring).
        on: (event, handler, options) => subscribe(false, event, handler, options),
        once: (event, handler, options) => subscribe(true, event, handler, options),
        emit: (event, payload, context) => container.bus.emit(event, payload, context),
        pipeline: (event, payload, context) => container.bus.pipeline(event, payload, context),
        veto: (event, payload, context) => container.bus.veto(event, payload, context),
        state: (namespace) => container.state(namespace),
        registry: Object.freeze({
            getPackage: (name) => container.registry.getPackage(name),
            discover: () => container.registry.discover(),
        }),
        config: () => container.config,
        // Capability modules receive narrowly-scoped runtime ports.  These are
        // deliberately functions rather than the Container itself, so a package
        // can own a capability without importing Logos internals.
        http: Object.freeze({
            app: () => container.app,
            setApp: (app) => { container.app = app; },
            setServer: (server) => { container.server = server; },
            server: () => externalApi(container, 'http').createServer(),
            getErrors,
            packageSnapshot: () => container.registry.snapshot(),
            get express() { return require('express'); },
            getPackageMount: () => externalApi(container, 'http').getPackageMount(),
            scanRoutes: registerRoutes,
            isolatedRunner: (pkg) => getIsolatedRunner(container, pkg),
            createContext: createRuntimeContext,
            loadMiddlewareSnapshot,
            resolveMiddlewares,
            runMiddlewares,
            routeMountPath,
            recordOfflineRoutes: (pkg, routes) => container.bus.emit('views:offline_routes', { pkg, routes }),
            runAsPackage: (pkg, work) => runAsPackage(container.authority, pkg, work),
        }),
        ws: Object.freeze({ getHub: () => externalApi(container, 'ws').getHub() }),
        tools: Object.freeze({
            authority: () => container.authority,
            scan: registerTools,
            resolveMiddlewares,
            runMiddlewares,
            generateManifest,
            getErrors,
            requestReboot: (ignored, options) => requestReboot(container, options),
            currentAuthority,
            runAsPackage: (_authority, pkg, work) => runAsPackage(container.authority, pkg, work),
            runAsSystem: (_authority, work) => runAsSystem(container.authority, work),
            isolatedRunner: (_ignored, pkg) => getIsolatedRunner(container, pkg),
        }),
        commands: Object.freeze({
            scan: registerCommands,
            resolveConditions,
            createContext: createRuntimeContext,
            resolveMiddlewares,
            runMiddlewares,
        }),
        storage: Object.freeze({
            config: () => container.config.storage || {},
            workspace: () => container.workspace,
        }),
        // Process and repository capabilities receive only the lifecycle ports
        // they need.  They deliberately do not receive the Container itself.
        process: Object.freeze({
            getScope: (pkg) => container.getPackageScope(pkg),
            createScope: (pkg, version) => container.createPackageScope(pkg, version),
            disposeScope: (pkg, reason) => container.disposePackageScope(pkg, reason),
            supervisor: () => container.state('supervisor').get('controller'),
        }),
        // Repository transport is external. This compatibility handle is only
        // the capability port for the pre-event repository protocol.
        repo: Object.freeze({
            container: () => container,
            isBranchInstance: () => process.env.LOGOS_ROLE === 'branch',
        }),
        scopes: Object.freeze({
            get: (pkg) => container.getPackageScope(pkg),
            create: (pkg, version) => container.createPackageScope(pkg, version),
            dispose: (pkg, reason) => container.disposePackageScope(pkg, reason),
            removeOwner: (pkg) => container.bus.removeOwner(pkg),
        }),
    });
}

  return host(container, subscriptions);
}
module.exports = { createHost };

function validateLegacyPackageWiring(container, kernel, pkg) {
  const { normalizePackageContract } = kernel.lifecycle['../kernel/package-contract'];
  const { getIsolatedRunner } = kernel.isolation;
  const { registerTools, registerHooks } = createScanners(kernel.scan.registerGeneric);
function validateToolSchema(tool) {
    const schema = tool?.parameters;
    if (!schema || schema.type !== 'object' || !schema.properties || typeof schema.properties !== 'object') {
        throw new TypeError(`Tool ${tool?.name ?? '<unknown>'} must expose an object JSON schema`);
    }
    if (schema.required !== undefined && !Array.isArray(schema.required)) {
        throw new TypeError(`Tool ${tool?.name ?? '<unknown>'} schema.required must be an array`);
    }
}
/** Validates declared and discovered capabilities before package wiring. */
async function validatePackageWiring(container, pkg) {
    const contract = normalizePackageContract(pkg);
    const principal = { kind: 'package', id: pkg.folder };
    const runner = getIsolatedRunner(container, pkg.folder);
    const surfaces = runner?.surfaces;
    if (pkg.isolated === true && !surfaces)
        throw new Error(`Isolated package ${pkg.folder} has no running runner`);
    const tools = surfaces ? surfaces.tools.map(tool => ({ ...tool, call: (args, context) => runner.invoke(tool.id, [args], context) })) : await registerTools(pkg.folder);
    const hooks = surfaces ? surfaces.hooks.map(hook => ({ ...hook, call: (payload, context) => runner.invoke(hook.id, [payload], context) })) : await registerHooks(pkg.folder);
    for (const tool of tools) {
        validateToolSchema(tool);
        container.authority.enforce({
            principal, surface: 'tools', operation: 'provide', resource: `${pkg.folder}.${tool.name}`,
        });
    }
    for (const hook of hooks) {
        container.authority.enforce({
            principal, surface: 'events', operation: 'transform', resource: hook.event,
        });
    }
    return { contract, tools: tools.length, hooks: hooks.length };
}

  return validatePackageWiring(container, pkg);
}
module.exports.validatePackageWiring = validateLegacyPackageWiring;

function requireCapabilityDependency(name, local) {
  let entry;
  try { entry = require.resolve(name); }
  catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    entry = require.resolve(local);
  }
  return require(entry);
}
