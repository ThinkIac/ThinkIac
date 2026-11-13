'use strict';

const bridge = require('./runtime/views-bridge.cjs');
const legacy = require('./runtime/views-runtime.cjs');
const offline = require('./runtime/offline.cjs');

function facade(host) {
  return {
    workspace: host.workspace(),
    config: host.config(),
    app: host.http.app(),
    state: host.state,
    registry: host.registry,
    log: host.log,
    bus: { on: host.on, emit: host.emit, pipeline: host.pipeline },
  };
}

function createRuntimeModule(host) {
  bridge.configure(host);
  const container = facade(host);
  return {
    name: 'views', phase: 'wire', after: ['http', 'ws'],
    api: {
      isRegisteredPublicView: path => legacy.isRegisteredPublicView(container, path),
      prewarm: () => legacy.prewarmViews(container),
      setGlobalData: data => legacy.setViewsGlobalData(container, data),
      getGlobalData: () => legacy.getViewsGlobalData(container),
      setTheme: theme => legacy.setViewsTheme(container, theme),
      setTailwind: enabled => legacy.setViewsTailwind(container, enabled),
      rebuildWidgets: () => legacy.rebuildWidgetRegistry(container),
      resolveHotReloadMode: (pkg, query) => legacy.resolveHotReloadMode(container, pkg, query),
    },
    install() {
      legacy.viewsModule.install(container);
      host.on('views:offline_routes', ({ pkg, routes }) => offline.recordOfflineRoutes(container, pkg, routes), { priority: 30 });
    },
  };
}

module.exports = { createRuntimeModule };
