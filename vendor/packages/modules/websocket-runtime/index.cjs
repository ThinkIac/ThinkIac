'use strict';

// Runtime binding for the reusable transport package.  Channel ownership is
// package-scoped, so swapping one package cannot disturb another package's
// live sockets.
const { WsHub } = requireCapabilityDependency("@thinkiac/module-websocket", "../websocket");

function createRuntimeModule(host) {
  function hub() {
    const state = host.state('ws'); let value = state.get('hub');
    if (!value) { value = new WsHub(); state.set('hub', value); }
    return value;
  }
  async function wire(pkg) {
    const value = hub(); if (!value.wss) return 0;
    let routes; try { routes = await host.http.scanRoutes(pkg.folder); } catch { return 0; }
    value.offOwner(pkg.folder);
    const scope = host.scopes.get(pkg.folder) || host.scopes.create(pkg.folder, String(Date.now()));
    for (const route of routes.filter(route => route.stream)) {
      const channel = route.channel || route.path;
      value.onMessage(channel, async (message, socket, sessionId) => host.http.runAsPackage(pkg.folder, async () => {
        const context = host.http.createContext({ pkg, sessionId, ws: socket, osChannel: channel });
        try { await route.handler(socket, context, message); } catch (error) { host.log(`[ws] error on ${channel}: ${error.message}`); }
      }), { owner: pkg.folder, scope });
    }
    return routes.filter(route => route.stream).length;
  }
  return {
    name: 'ws', phase: 'wire', requires: ['http'], swappable: false,
    api: { getHub: hub, mountStreamRoutes: wire },
    async close() {
      const value = host.state('ws').get('hub');
      if (!value?.wss) return;
      for (const socket of value.wss.clients) socket.terminate();
      await new Promise(resolve => value.wss.close(() => resolve()));
    },
    install() {
      // Streams need a live hub before the first package:wiring event.
      hub().create(host.http.server(), { path: '/ws', authorize: host.config().ws?.authorize });
      host.on('package:wiring', ({ pkg }) => wire(pkg), { priority: 60 });
      host.on('reload:streams', ({ pkg }) => wire(pkg), { priority: 60 });
    },
  };
}
module.exports = { createRuntimeModule };

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
