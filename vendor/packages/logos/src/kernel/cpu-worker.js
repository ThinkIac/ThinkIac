'use strict';
// Compatibility entrypoint. Worker execution belongs to the selected module.
const path = require('node:path');
const { externalModulePath } = require('./module-resolution');
require(path.join(externalModulePath('workers'), 'cpu-worker.js'));
