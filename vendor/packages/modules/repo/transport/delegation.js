'use strict'; // External repo transport.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DELEGATION_PREFIX = void 0;
exports.verifyDelegatedCredential = verifyDelegatedCredential;
const crypto_1 = __importDefault(require("crypto"));
exports.DELEGATION_PREFIX = 'logos-delegated-v1.';
/** Validates the compact identity issued by Git Cloud for a single SSH session. */
function verifyDelegatedCredential(username, publicKey, expectedMachine = '', now = () => Date.now()) {
    if (!publicKey || !username.startsWith(exports.DELEGATION_PREFIX))
        return null;
    const parts = username.slice(exports.DELEGATION_PREFIX.length).split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1])
        return null;
    try {
        const [payload, signature] = parts;
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
        if (claims?.v !== 1 || typeof claims.machine !== 'string' || typeof claims.actor !== 'string' || !['main', 'branch', 'read'].includes(claims.role) || !Number.isInteger(claims.exp))
            return null;
        if (claims.exp <= Math.floor(now() / 1000) || (expectedMachine && claims.machine !== expectedMachine))
            return null;
        const valid = crypto_1.default.verify(null, Buffer.from(`thinkiac:git-delegation:v1:${payload}`), publicKey, Buffer.from(signature, 'base64url'));
        return valid ? { machine: claims.machine, actor: claims.actor, role: claims.role, exp: claims.exp } : null;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=delegation.js.map
