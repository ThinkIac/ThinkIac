// Injectable compatibility implementation, owned by module-stabilizer.
module.exports = function (require, module, exports, __dirname, __filename) {
// stabilizer/crashguard.ts — process-level crash-loop protection.
//
// Boot attempts since the last stable state are counted in
// ~/.environments/logos-boot.json. If the process died CRASH_LIMIT times
// within CRASH_WINDOW_MS without ever reaching stability, the next boot
// restores the whole workspace to the last global checkpoint BEFORE wiring.
'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bootAttempt = bootAttempt;
exports.bootStable = bootStable;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const CRASH_LIMIT = 3;
const CRASH_WINDOW_MS = 120_000;
function defaultStateDir() {
    return path_1.default.join(os_1.default.homedir(), '.environments');
}
function guardFile(stateDir) {
    return path_1.default.join(stateDir, 'logos-boot.json');
}
function readGuard(stateDir) {
    try {
        return JSON.parse(fs_1.default.readFileSync(guardFile(stateDir), 'utf-8'));
    }
    catch {
        return {};
    }
}
function writeGuard(data, stateDir) {
    fs_1.default.mkdirSync(stateDir, { recursive: true });
    fs_1.default.writeFileSync(guardFile(stateDir), JSON.stringify(data, null, 2));
}
/** Call at the very start of bootstrap(). May restore the workspace. */
function bootAttempt(workspace, checkpoints, stateDir = defaultStateDir()) {
    const guard = readGuard(stateDir);
    const entry = guard[workspace] ?? { attempts: [], restoredAt: 0 };
    const now = Date.now();
    entry.attempts = entry.attempts.filter(t => now - t < CRASH_WINDOW_MS);
    entry.attempts.push(now);
    guard[workspace] = entry;
    writeGuard(guard, stateDir);
    if (entry.attempts.length >= CRASH_LIMIT) {
        console.error(`[stabilizer] crash loop detected (${entry.attempts.length} boots in ${CRASH_WINDOW_MS / 1000}s) — ` +
            `restoring workspace to last stable checkpoint`);
        const result = checkpoints.rollbackWorkspace();
        entry.attempts = [];
        entry.restoredAt = now;
        guard[workspace] = entry;
        writeGuard(guard, stateDir);
        return { restored: result.ok };
    }
    return { restored: false };
}
/** Call once the runtime reaches a stable state — resets the counter. */
function bootStable(workspace, stateDir = defaultStateDir()) {
    const guard = readGuard(stateDir);
    guard[workspace] = { attempts: [], stableAt: Date.now() };
    writeGuard(guard, stateDir);
}

};
