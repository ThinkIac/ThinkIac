'use strict';

function toEnvSegment(value) {
  return String(value).replace(/[^A-Za-z0-9]/g, '_').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
}

function expectedCredential(pkgFolder, env = process.env) {
  return env[`${toEnvSegment(pkgFolder)}_ENV_AUTH_TOKEN`] || env.AUTH_TOKEN || null;
}

function buildCredentialGuard(container, pkgFolder, { env = process.env } = {}) {
  return async function credentialGuard(req, res, next) {
    const header = req.headers?.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const expected = expectedCredential(pkgFolder, env);
    let verdict = {
      allowed: Boolean(expected) && token === expected,
      status: 401,
      message: expected ? 'Invalid or missing bearer credential' : 'Credential token not configured for this package',
    };
    verdict = await container.bus.pipeline('credential:verify', verdict, { req, res, pkg: pkgFolder, token });
    if (verdict?.allowed) return next();
    return res.status(verdict?.status ?? 401).json({ error: verdict?.message ?? 'Credential rejected' });
  };
}

function createCredentialModule(options) {
  return {
    name: 'credential', phase: 'boot',
    install(container) {
      container.state('credential').set('buildGuard', pkgFolder => buildCredentialGuard(container, pkgFolder, options));
    },
  };
}

const credentialModule = createCredentialModule();
function provideCredential(host) {
  /**
   * @register module credential
   * @context capability
   */

  return {
    name: 'credential', phase: 'boot',
    install() {
      createCredentialModule().install({ state: host.state, bus: { pipeline: host.pipeline } });
    },
  };
}
module.exports = { toEnvSegment, expectedCredential, buildCredentialGuard, createCredentialModule, credentialModule, provideCredential };

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

// Library alias for existing direct consumers; not used for runtime discovery.
module.exports.createRuntimeModule = provideCredential;
