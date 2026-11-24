'use strict';
// Compatibility entrypoint. The isolation module owns its process bootstrap.
const path = require('node:path');
const { externalModulePath } = require('../../kernel/module-resolution');
require(path.join(externalModulePath('isolated-runtime'), 'child.js'));
