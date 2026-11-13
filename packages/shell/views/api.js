import * as agentRuntime from './agents/runtime.js'

export async function api(path, method = "GET", body = null, packageName = null, requestOptions = {}) {
    const timeoutMs = Number.isFinite(requestOptions?.timeoutMs)
        ? Math.max(0, requestOptions.timeoutMs)
        : 0;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    let timeoutId = null;
    let timedOut = false;
    try {
        const opts = {
            method,
            headers: { "Content-Type": "application/json" },
        };
        if (controller) opts.signal = controller.signal;
        if (body) opts.body = JSON.stringify(body);
        const request = packageName
            ? fetch(`/${packageName}${path}`, opts)
            : agentRuntime.request(path, opts);
        const res = timeoutMs
            ? await Promise.race([
                  request,
                  new Promise((_, reject) => {
                      timeoutId = setTimeout(() => {
                          timedOut = true;
                          controller?.abort();
                          reject(new Error(`The route did not respond within ${Math.ceil(timeoutMs / 1000)} seconds.`));
                      }, timeoutMs);
                  }),
              ])
            : await request;
        if (res.status === 401 || new URL(res.url, window.location.href).pathname === "/view/auth/Login") {
            const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
            window.top.location.replace(`/view/auth/Login?next=${encodeURIComponent(next)}`);
            return null;
        }
        const text = await res.text();
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch { /* preserve the HTTP detail below */ }
        if (!res.ok) {
            const detail = json?.error || json?.message || text?.trim();
            return {
                error: detail || `A rota respondeu HTTP ${res.status}.`,
                status: res.status,
                code: res.status === 404
                    ? "route_not_found"
                    : res.status >= 500
                      ? "runtime_or_provider_unavailable"
                      : "request_rejected",
            };
        }
        return json?.data || json || {};
    } catch (error) {
        if (timedOut) {
            return {
                error: error?.message || "The route took too long to respond.",
                status: 0,
                code: "request_timeout",
            };
        }
        return {
            error: error?.message || "Could not connect to the local Runtime.",
            status: 0,
            code: "network_unavailable",
        };
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}
