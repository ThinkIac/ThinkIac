// examples/hello/routes.js
//
// Two ways to write decorators in Lógos v2:
//   - ABOVE the function (new, conventional) — see `ping`
//   - INSIDE the body (v1 style, still supported) — see `greet`

/**
 * @register_router ping
 * @method get
 */
async function ping() {
  return { data: { ok: true, at: new Date().toISOString() } };
}

/**
 * @register_router greet/:name
 * @method get
 */
async function greet(req) {
  // v1-style doc inside the body also works:
  /**
   * @register_router greet/:name
   * @method get
   */
  return { data: { message: `Hello, ${req.params.name}!` } };
}

/**
 * @register_router secret
 * @method get
 * @auth
 */
async function secret() {
  // Requires: Authorization: Bearer <HELLO_ENV_AUTH_TOKEN or AUTH_TOKEN>
  return { data: { message: 'You are authorized.' } };
}

module.exports = { ping, greet, secret };
