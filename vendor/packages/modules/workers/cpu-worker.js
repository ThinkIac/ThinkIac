'use strict';

const { parentPort } = require('node:worker_threads');
const { pathToFileURL } = require('node:url');

if (!parentPort) throw new Error('CPU worker requires a parent port');

parentPort.on('message', async message => {
  const { id, module: modulePath, exportName, args } = message;
  try {
    const loaded = await import(pathToFileURL(modulePath).href);
    const fn = exportName === 'default' ? loaded.default : loaded[exportName];
    if (typeof fn !== 'function') throw new TypeError(`Worker export "${exportName}" is not a function`);
    const result = await fn(...args);
    parentPort.postMessage({ id, result });
  } catch (error) {
    parentPort.postMessage({ id, error: {
      name: error?.name || 'Error',
      message: error?.message || String(error),
      stack: error?.stack,
    } });
  }
});
