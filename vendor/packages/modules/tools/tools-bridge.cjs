'use strict';

let host;
function configure(value) { host = value; }
const get = () => { if (!host) throw new Error('Tools capability was used before configuration'); return host; };
module.exports = {
  configure,
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
