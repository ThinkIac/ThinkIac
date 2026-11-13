// External repo transport — who may talk to the auto-repository.
//
// .logos/authorized_keys is an OpenSSH-shaped file. The optional options
// field carries the Lógos role:
//
//   logos-role=main    clone, fetch, push anything (default)
//   logos-role=branch  clone, fetch, push any branch EXCEPT main
//   logos-role=read    clone and fetch only
//
//   logos-role=branch ssh-ed25519 AAAAC3Nz... alice@laptop
//   ssh-ed25519 AAAAC3Nz... ci@builder
//
// The role is enforced twice: `read` never reaches git-receive-pack (ssh.ts),
// and `branch` is stopped at the pre-receive hook, which is the only place
// that knows which refs a push actually carries (git.ts).
'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseAuthorizedKeys = parseAuthorizedKeys;
exports.loadAuthorizedKeys = loadAuthorizedKeys;
exports.appendAuthorizedKey = appendAuthorizedKey;
const fs_1 = __importDefault(require("fs"));
const KEY_TYPE = /^(ssh-|ecdsa-|sk-)/;
function parseRole(options) {
    const match = /(?:logos-)?role=("?)(main|branch|read)\1/.exec(options);
    return match?.[2] ?? 'main';
}
function parseAuthorizedKeys(content) {
    const keys = [];
    for (const rawLine of content.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#'))
            continue;
        const tokens = line.split(/\s+/);
        let role = 'main';
        if (!KEY_TYPE.test(tokens[0])) {
            role = parseRole(tokens.shift());
        }
        const [type, b64, ...rest] = tokens;
        if (!type || !b64 || !KEY_TYPE.test(type))
            continue;
        let blob;
        try {
            blob = Buffer.from(b64, 'base64');
        }
        catch {
            continue;
        }
        if (!blob.length)
            continue;
        keys.push({ type, blob, comment: rest.join(' '), role });
    }
    return keys;
}
function loadAuthorizedKeys(file) {
    if (!fs_1.default.existsSync(file))
        return [];
    try {
        return parseAuthorizedKeys(fs_1.default.readFileSync(file, 'utf-8'));
    }
    catch {
        return [];
    }
}
function appendAuthorizedKey(file, line, role = 'main') {
    const parsed = parseAuthorizedKeys(line);
    if (!parsed.length)
        return null;
    const entry = `logos-role=${role} ${line.trim()}\n`;
    fs_1.default.appendFileSync(file, entry, { mode: 0o600 });
    return { ...parsed[0], role };
}
//# sourceMappingURL=keys.js.map
