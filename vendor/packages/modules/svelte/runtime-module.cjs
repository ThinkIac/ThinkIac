'use strict';

const { createBridge } = require('./runtime/views-bridge.cjs');
const { createRuntime } = require('./runtime/views-runtime.cjs');
const offline = require('./runtime/offline.cjs');

function facade(host) {
  return {
    workspace: host.workspace(),
    config: host.config(),
    get app() { return host.http.app(); },
    state: host.state,
    registry: host.registry,
    log: host.log,
    bus: { on: host.on, emit: host.emit, pipeline: host.pipeline },
  };
}

function provideViews(host) {
  /**
   * @register module views
   * @accepts view
   * @context capability
   */

  const legacy = createRuntime(createBridge(host));
  const container = facade(host);
  return {
    name: 'views', phase: 'wire', requires: ['http'], after: ['ws'],
    async prepare() { host.state('views').set('readiness', await legacy.prewarmViews(container)); },
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

module.exports = { provideViews };

// Library alias for existing direct consumers; not used for runtime discovery.
module.exports.createRuntimeModule = provideViews;
