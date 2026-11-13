

export async function api(path, method = "GET", body = null, domain = 'agent') {
    const baseUrl = `/${domain}`;

    try {
        const opts = {
            method,
            headers: { "Content-Type": "application/json" },
        };
        if (body) opts.body = JSON.stringify(body);
        const res = await fetch(`${baseUrl}${path}`, opts);
        if (res.status === 401 || new URL(res.url, window.location.href).pathname === "/view/auth/Login") {
            const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
            window.top.location.replace(`/view/auth/Login?next=${encodeURIComponent(next)}`);
            return null;
        }
        const json = await res.json();
        return json.data || json;
    } catch {
        return null;
    }
}
