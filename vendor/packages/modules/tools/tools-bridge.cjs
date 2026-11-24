'use strict';
function createBridge(host) {
  const get = () => host;
return {
  registerTools: folder => get().tools.scan(folder),
  resolveConditions: (...args) => get().resolveConditions(...args),
  createRuntimeContext: (...args) => get().createContext(...args),
  resolveMiddlewares: (...args) => get().tools.resolveMiddlewares(...args),
  runMiddlewares: (...args) => get().tools.runMiddlewares(...args),
  generateManifest: (...args) => get().tools.generateManifest(...args),
  getErrors: () => get().tools.getErrors(),
  requestReboot: (...args) => get().tools.requestReboot(...args),
  currentAuthority: () => get().tools.currentAuthority(),
  runAsPackage: (...args) => get().tools.runAsPackage(...args),
  runAsSystem: (...args) => get().tools.runAsSystem(...args),
  SYSTEM_PRINCIPAL: { kind: 'system', id: 'logos' },
  getIsolatedRunner: (...args) => get().tools.isolatedRunner(...args),
};

}
module.exports = { createBridge };
