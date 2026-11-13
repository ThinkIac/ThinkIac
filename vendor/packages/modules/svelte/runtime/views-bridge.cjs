'use strict';

// This bridge is deliberately configured by the capability factory.  The
// copied view runtime never imports the Logos source tree.
let host;
function configure(value) { host = value; }
function requireHost() { if (!host) throw new Error('Svelte capability was used before configuration'); return host; }

module.exports = {
  configure,
  measurePhase: (...args) => requireHost().http.measurePhase(...args),
  setPerformanceRoute: (...args) => requireHost().http.setPerformanceRoute(...args),
  getHub: () => requireHost().ws.getHub(),
  getPackageMount: () => requireHost().http.getPackageMount(),
  routeMountPath: (...args) => requireHost().http.routeMountPath(...args),
};
