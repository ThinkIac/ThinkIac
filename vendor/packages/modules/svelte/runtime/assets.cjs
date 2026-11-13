"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.versionedAsset = void 0;
exports.precompressAssets = precompressAssets;
exports.compressedAssets = compressedAssets;
const path_1 = __importDefault(require("path"));
const fs_1 = require("fs");
const util_1 = require("util");
const zlib_1 = require("zlib");
const zip = (0, util_1.promisify)(zlib_1.gzip);
const brotli = (0, util_1.promisify)(zlib_1.brotliCompress);
const versionedAsset = (name) => /\.[a-f0-9]{32}(?:\.chunk\.[A-Za-z0-9_-]+)?\.(?:mjs|css)$/.test(name);
exports.versionedAsset = versionedAsset;
/** Compression runs in libuv, once per published asset, never on a request. */
async function precompressAssets(files) {
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(2, files.length) }, async () => {
        while (cursor < files.length) {
            const file = files[cursor++];
            if (!(0, exports.versionedAsset)(path_1.default.basename(file)))
                continue;
            const bytes = await fs_1.promises.readFile(file);
            if (bytes.length < 1024)
                continue;
            const [gz, br] = await Promise.all([zip(bytes), brotli(bytes, { params: { [zlib_1.constants.BROTLI_PARAM_QUALITY]: 4 } })]);
            await Promise.all([fs_1.promises.writeFile(`${file}.gz`, gz), fs_1.promises.writeFile(`${file}.br`, br)]);
        }
    }));
}
function compressedAssets(cacheDir) {
    return async (req, res, next) => {
        if (!['GET', 'HEAD'].includes(req.method))
            return next();
        let name;
        try {
            name = decodeURIComponent(req.path).slice(1);
        }
        catch {
            return next();
        }
        if (name !== path_1.default.basename(name) || !(0, exports.versionedAsset)(name))
            return next();
        res.vary('Accept-Encoding');
        if (req.headers.range)
            return next();
        const encoding = req.acceptsEncodings('br', 'gzip', 'identity');
        if (encoding !== 'br' && encoding !== 'gzip')
            return next();
        const file = path_1.default.join(cacheDir, `${name}.${encoding === 'br' ? 'br' : 'gz'}`);
        try {
            await fs_1.promises.access(file);
        }
        catch {
            return next();
        }
        res.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : 'application/javascript');
        res.setHeader('Content-Encoding', encoding);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.sendFile(file, (error) => {
            if (!error)
                return;
            if (!res.headersSent)
                res.removeHeader('Content-Encoding');
            next(error);
        });
    };
}
//# sourceMappingURL=assets.js.map