'use strict';

// Repository hosting is installed as a normal capability. Its SSH, deploy,
// branch and proxy transports live in this package.
function createRuntimeModule(host) {
  let state = null;
  return {
    name: 'repo', phase: 'wire', after: ['http', 'tools'],
    api: {
      getState: () => state,
      close: async () => { await state?.close?.(); },
    },
    install() {
      const legacy = require('./transport');
      legacy.repoModule.install(host.repo.container());
      state = legacy.getRepoState(host.repo.container());
    },
  };
}
module.exports = { createRuntimeModule };
