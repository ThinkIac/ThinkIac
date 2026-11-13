const path = require('node:path');
const { discoverContributions } = require('./protocol');

let router = null;

async function getRouter() {
  if (!router) router = import('./semantic-router.mjs').then(({ SemanticRouter }) => new SemanticRouter(discoverContributions(path.dirname(__dirname))));
  return router;
}

/**
 * @register_hook classification:route
 * @priority 20
 */
async function onClassificationRoute(payload) {
  if (payload?.decision) return payload;
  return { ...payload, decision: await (await getRouter()).classify(payload?.text) };
}

/**
 * @register_hook package:added
 */
async function onClassificationPackageAdded(payload) {
  router = null;
  return payload;
}

/**
 * @register_hook package:stopped
 */
async function onClassificationPackageStopped(payload) {
  router = null;
  return payload;
}

/**
 * @register_hook reload:swapped
 */
async function onClassificationReload(payload) {
  router = null;
  return payload;
}

module.exports = { onClassificationReload, getRouter, onClassificationPackageAdded, onClassificationPackageStopped, onClassificationRoute };
