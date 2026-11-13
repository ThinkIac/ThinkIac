// External repo transport — reaching an ephemeral branch through the main port.
//
// Every instance always has its own port, which is the honest way in
// (`http://host:5117`). The proxy exists so a branch is also reachable
// without knowing which port it landed on:
//
//   expose: 'path'       GET /@my-feature/…      → 127.0.0.1:<port>/…
//   expose: 'subdomain'  Host: my-feature.host   → 127.0.0.1:<port>/…
//   expose: 'port-only'  no proxy at all
//
// A slug only routes if a branch with that name actually exists in the
// repository, so a typo in a URL can never spawn a process.
//
// Path mode rewrites the URL but cannot rewrite the HTML an app generates:
// absolute links (`/assets/app.css`) escape the prefix. Subdomain mode has no
// such problem and is the better default when wildcard DNS is available.
'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveTarget = resolveTarget;
exports.proxyRequest = proxyRequest;
exports.installUpgradeProxy = installUpgradeProxy;
const http_1 = __importDefault(require("http"));
const PATH_PREFIX = /^\/@([a-z0-9-]+)(\/.*)?$/;
function resolveTarget(mode, url, host, knownSlug) {
    if (mode === 'port-only')
        return null;
    if (mode === 'path') {
        const match = PATH_PREFIX.exec(url || '');
        if (!match)
            return null;
        if (!knownSlug(match[1]))
            return null;
        return { slug: match[1], path: match[2] || '/' };
    }
    // subdomain
    const bare = (host || '').split(':')[0];
    const labels = bare.split('.');
    if (labels.length < 2)
        return null;
    const slug = labels[0].toLowerCase();
    if (!knownSlug(slug))
        return null;
    return { slug, path: url || '/' };
}
function proxyRequest(port, targetPath, req, res, onDone) {
    const headers = { ...req.headers };
    headers['x-forwarded-host'] = req.headers.host ?? '';
    headers['x-forwarded-proto'] = req.protocol ?? 'http';
    headers['x-logos-branch'] = '1';
    delete headers['content-length']; // recomputed by the pipe below when chunked
    const upstream = http_1.default.request({
        host: '127.0.0.1',
        port,
        path: targetPath,
        method: req.method,
        headers,
    }, upstreamRes => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(res);
        upstreamRes.on('end', onDone);
    });
    upstream.on('error', (err) => {
        onDone();
        if (res.headersSent)
            return res.destroy();
        res.status?.(502);
        res.statusCode = 502;
        res.end(JSON.stringify({ error: `branch instance unreachable: ${err.message}` }));
    });
    req.on('aborted', () => upstream.destroy());
    // express may have consumed the body already (express.json); replay it.
    if (req.body !== undefined && req.readableEnded) {
        const payload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
        if (req.headers['content-type'])
            upstream.setHeader('content-type', req.headers['content-type']);
        upstream.setHeader('content-length', Buffer.byteLength(payload));
        upstream.end(payload);
    }
    else {
        req.pipe(upstream);
    }
}
/**
 * WebSocket upgrades to a branch. The main runtime's own hub owns `/ws` on
 * this port, so we install ourselves as the single 'upgrade' listener and
 * hand everything that is not a branch back to the listeners that were there
 * before us — otherwise `ws` would abort the handshake for foreign paths.
 */
function installUpgradeProxy(server, resolve, hold, release) {
    const previous = server.listeners('upgrade');
    server.removeAllListeners('upgrade');
    const handler = (req, socket, head) => {
        const target = resolve(req);
        if (!target) {
            for (const listener of previous)
                listener.call(server, req, socket, head);
            return;
        }
        hold(target.slug);
        const upstream = http_1.default.request({
            host: '127.0.0.1',
            port: target.port,
            path: target.path,
            method: 'GET',
            headers: { ...req.headers, 'x-logos-branch': '1' },
        });
        upstream.end();
        upstream.on('upgrade', (upstreamRes, upstreamSocket, upstreamHead) => {
            const lines = [`HTTP/1.1 101 ${upstreamRes.statusMessage || 'Switching Protocols'}`];
            for (const [key, value] of Object.entries(upstreamRes.headers)) {
                for (const item of Array.isArray(value) ? value : [value])
                    lines.push(`${key}: ${item}`);
            }
            socket.write(`${lines.join('\r\n')}\r\n\r\n`);
            if (upstreamHead?.length)
                socket.unshift(upstreamHead);
            if (head?.length)
                upstreamSocket.unshift(head);
            upstreamSocket.pipe(socket);
            socket.pipe(upstreamSocket);
            const done = () => release(target.slug);
            socket.once('close', done);
            upstreamSocket.once('error', () => socket.destroy());
        });
        upstream.on('error', () => {
            release(target.slug);
            socket.destroy();
        });
    };
    server.on('upgrade', handler);
    return () => {
        server.removeListener('upgrade', handler);
        for (const listener of previous)
            server.on('upgrade', listener);
    };
}
//# sourceMappingURL=proxy.js.map
