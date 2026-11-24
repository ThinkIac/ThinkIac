'use strict';
function createBridge(host) {
  const timing = requireCapabilityDependency("@thinkiac/module-http/performance.cjs", "../../http/performance.cjs");
  return {
    measurePhase: timing.measurePhase, setPerformanceRoute: timing.setPerformanceRoute,
    getHub: () => host.ws.getHub(),
    getPackageMount: () => host.http.getPackageMount(),
    routeMountPath: (pkg, route) => route.startsWith('/') ? route : `/${pkg}/${route}`,
  };
}
module.exports = { createBridge };

function requireCapabilityDependency(name, local) {
  let entry;
  try { entry = require.resolve(name); }
  catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    entry = require.resolve(local);
  }
  return require(entry);
}
