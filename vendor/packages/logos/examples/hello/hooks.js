// examples/hello/hooks.js
//
// Observe every package request. Because hooks live on the bus, a package can
// react to the runtime's own lifecycle events too (runtime:ready, reload:*).

/**
 * @register_hook http:request
 * @priority 100
 */
async function onRequest(payload) {
  console.log(`[hello] saw request: ${payload.method?.toUpperCase()} /${payload.pkg}/${payload.path}`);
}

module.exports = { onRequest };
