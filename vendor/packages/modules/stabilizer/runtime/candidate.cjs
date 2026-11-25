// Injectable compatibility implementation, owned by module-stabilizer.
module.exports = function (require, module, exports, __dirname, __filename) {
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.candidateManifest = candidateManifest;
exports.candidateHash = candidateHash;
exports.createCandidate = createCandidate;
exports.candidateContributors = candidateContributors;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
// Source coverage only: mutable data, secrets, dependencies and generated output
// are deliberately excluded. Removing a covered file changes the manifest hash.
const EXCLUDED = new Set(['node_modules', '.git', '.logos', 'data', 'uploads', 'secrets', 'dist', 'generated', 'backups', 'snapshots', 'sessions']);
const SOURCE = /\.(?:[cm]?[jt]s|type|json|svelte|svx|prisma|inflect|md|css|html)$/i;
function candidateManifest(root) {
    const entries = [];
    function visit(dir) {
        for (const entry of fs_1.default.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
            if (entry.name.startsWith('.') || EXCLUDED.has(entry.name))
                continue;
            const absolute = path_1.default.join(dir, entry.name);
            if (entry.isSymbolicLink())
                throw new Error(`candidate source symlink unsupported: ${path_1.default.relative(root, absolute)}`);
            if (entry.isDirectory())
                visit(absolute);
            else if (SOURCE.test(entry.name))
                entries.push({ path: path_1.default.relative(root, absolute).split(path_1.default.sep).join('/'), hash: (0, crypto_1.createHash)('sha256').update(fs_1.default.readFileSync(absolute)).digest('hex') });
        }
    }
    visit(root);
    return entries;
}
function candidateHash(root) {
    return (0, crypto_1.createHash)('sha256').update(JSON.stringify(candidateManifest(root))).digest('hex');
}
function createCandidate(root) {
    return { schemaVersion: 2, candidateId: (0, crypto_1.randomUUID)(), candidateHash: candidateHash(root), producedAt: Date.now() };
}
// Correlation is accepted only for exact file content supplied by a completed
// write. This records contributors, never exclusive ownership of a package.
function candidateContributors(root, evidence) {
    const manifest = new Map(candidateManifest(root).map(entry => [path_1.default.resolve(root, entry.path), entry.hash]));
    const matched = evidence.filter(item => item?.sessionId && item?.runId && typeof item.path === 'string'
        && typeof item.hash === 'string' && manifest.get(path_1.default.resolve(item.path)) === item.hash);
    const authors = [...new Map(matched.map(item => {
            const author = { sessionId: item.sessionId, runId: item.runId, taskId: item.taskId || item.runId };
            return [JSON.stringify(author), author];
        })).values()];
    return { authors, operationIds: [...new Set(matched.map(item => item.operationId).filter(Boolean))] };
}

};
