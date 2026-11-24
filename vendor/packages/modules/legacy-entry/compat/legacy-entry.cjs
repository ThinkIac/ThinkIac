// Legacy public compatibility implementation, owned by module-legacy-entry.
module.exports = function(require, module, exports, __dirname, __filename, kernel) {
// modules/legacy-entry.ts — v1 "entry" support (wire phase).
//
// v1 allowed a package.json "entry" pointing at a function that receives the
// express app (registerPackage). Preserved as-is minus the odd v1 rule that
// required a routes.js file to exist.
'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.legacyEntryModule = void 0;
exports.runLegacyEntry = runLegacyEntry;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const authority_context_1 = require("../kernel/authority-context");
function runLegacyEntry(container, pkg) {
    if (!pkg.entry)
        return;
    const entryPath = path_1.default.join(pkg.dir, pkg.entry);
    if (!fs_1.default.existsSync(entryPath))
        return;
    try {
        const resolved = require.resolve(entryPath);
        delete require.cache[resolved];
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const usePackage = require(resolved);
        if (typeof usePackage !== 'function') {
            container.log(`${pkg.name ?? pkg.folder}: invalid entry point (expected a function)`);
            return;
        }
        const result = (0, authority_context_1.runAsPackage)(container.authority, pkg.folder, () => usePackage(container.app) ?? usePackage);
        result?.setup && (0, authority_context_1.runAsPackage)(container.authority, pkg.folder, () => result.setup());
        container.log(`${pkg.name ?? pkg.folder} ${pkg.version ? `version ${pkg.version} ` : ''}is running.`);
    }
    catch (err) {
        container.log(`Error with package ${pkg.name ?? pkg.folder}: ${err.message}`);
    }
}
exports.legacyEntryModule = {
    name: 'legacy-entry',
    phase: 'wire',
    after: ['http'],
    install(container) {
        container.bus.on('package:wiring', (payload) => runLegacyEntry(container, payload.pkg), { priority: 55 });
    },
};

};
