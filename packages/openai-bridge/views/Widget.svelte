<script>
    import { onMount } from "svelte";

    // Keep this in sync with the Shell theme toggle. The previous key was
    // obsolete, which made the widget render its dark text on a light shell.
    const THEME_KEY = "agent:theme";
    let theme = "dark";
    let accounts = [];
    let loading = true;
    let error = "";
    let updatedAt = null;
    let resizeObserver;
    let selectedAccount = null;

    function readTheme() {
        theme = localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
    }

    function onStorage(event) {
        if (event.key === THEME_KEY) readTheme();
    }

    function reportHeight() {
        parent.postMessage(
            { source: "agent", type: "widget:height", detail: document.documentElement.scrollHeight },
            "*",
        );
    }

    async function load(force = false) {
        loading = true;
        error = "";
        try {
            const response = await fetch(`/agent/codex-usage${force ? "?refresh=1" : ""}`);
            const data = await response.json();
            if (!data.success) throw new Error(data.error || "Could not load accounts");
            accounts = data.accounts || [];
            selectedAccount = accounts.find(account => account.name === selectedAccount?.name) || null;
            updatedAt = data.updatedAt ? new Date(data.updatedAt * 1000) : new Date();
        } catch (err) {
            error = err.message || "Usage is unavailable";
        } finally {
            loading = false;
            setTimeout(reportHeight, 0);
        }
    }

    function snapshots(account) {
        const byId = account.rateLimitsByLimitId;
        if (byId && Object.keys(byId).length) {
            return Object.entries(byId).map(([id, value]) => ({ id, ...value }));
        }
        return account.rateLimits ? [{ id: account.rateLimits.limitId || "codex", ...account.rateLimits }] : [];
    }

    function windows(snapshot) {
        return [snapshot.primary, snapshot.secondary].filter(Boolean);
    }

    function percent(value) {
        return Math.max(0, Math.min(100, Number(value) || 0));
    }

    function previewWindows(account) {
        const all = snapshots(account).flatMap(snapshot => windows(snapshot));
        const weekly = all.find(window => window.windowDurationMins === 10080);
        const short = all.find(window => window !== weekly);
        return [short, weekly].filter(Boolean);
    }

    function openAccount(account) {
        selectedAccount = account;
        setTimeout(reportHeight, 0);
    }

    function returnToAccounts() {
        selectedAccount = null;
        setTimeout(reportHeight, 0);
    }

    function windowLabel(window) {
        const minutes = window.windowDurationMins;
        if (minutes === 300) return "5h";
        if (minutes === 10080) return "Week";
        if (minutes === 43200 || minutes === 43800 || minutes === 44640) return "Month";
        if (!minutes) return "Limit";
        if (minutes % 1440 === 0) return `${Math.round(minutes / 1440)} days`;
        if (minutes % 60 === 0) return `${Math.round(minutes / 60)}h`;
        return `${minutes} min`;
    }

    function formatReset(timestamp) {
        if (!timestamp) return "";
        const date = new Date(timestamp * 1000);
        const delta = date.getTime() - Date.now();
        if (delta > 0 && delta < 24 * 60 * 60 * 1000) {
            const totalMinutes = Math.ceil(delta / 60000);
            const hours = Math.floor(totalMinutes / 60);
            const minutes = totalMinutes % 60;
            return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
        }
        return date.toLocaleString("en-US", {
            weekday: "short",
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        });
    }

    function plan(account) {
        const snapshot = snapshots(account)[0];
        const raw = snapshot?.planType || account.account?.planType || "";
        return raw.replaceAll("_", " ");
    }

    function tokenText(value) {
        if (value == null) return "";
        return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
    }

    function relativeUpdated(date) {
        if (!date) return "";
        const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
        if (seconds < 60) return "now";
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
        return `${Math.floor(seconds / 3600)}h ago`;
    }

    onMount(() => {
        readTheme();
        window.addEventListener("storage", onStorage);
        resizeObserver = new ResizeObserver(reportHeight);
        resizeObserver.observe(document.body);
        load();

        return () => {
            window.removeEventListener("storage", onStorage);
            resizeObserver?.disconnect();
        };
    });
</script>

<div class="wrap" data-theme={theme}>
    <header class="widget-meta">
        {#if selectedAccount}
            <button class="back-button" type="button" on:click={returnToAccounts} aria-label="Back to accounts">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
                Back
            </button>
        {/if}
        {#if updatedAt}
            <span>Updated {relativeUpdated(updatedAt)}</span>
        {/if}
        <button class="icon-button" on:mousedown|preventDefault on:click={() => load(true)} disabled={loading} aria-label="Refresh usage">
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7" />
            </svg>
        </button>
    </header>

    {#if error}
        <div class="notice error">{error}</div>
    {/if}

    {#if loading && !accounts.length}
        <div class="notice">Loading accounts…</div>
    {:else if !accounts.length}
        <div class="notice">No Codex accounts are signed in through Terminal profiles.</div>
    {:else if selectedAccount}
        <section class:unavailable={!selectedAccount.ok} class="account-detail-view">
            <div class="detail-heading">
                <span class:offline={!selectedAccount.ok} class="status-dot"></span>
                <strong>{selectedAccount.name}</strong>
            </div>
            {#if !selectedAccount.ok}
                <p class="account-error">{selectedAccount.error || "Usage is unavailable"}</p>
            {:else}
                {#if plan(selectedAccount)}
                    <div class="detail-plan">{plan(selectedAccount)}</div>
                {/if}
                {#each snapshots(selectedAccount) as snapshot (snapshot.id)}
                    {#if snapshots(selectedAccount).length > 1}
                        <div class="limit-name">{snapshot.limitName || snapshot.id}</div>
                    {/if}
                    {#each windows(snapshot) as window}
                        <div class="quota-row">
                            <div class="quota-meta">
                                <span>{windowLabel(window)}</span>
                                <span class="quota-value">
                                    {percent(window.usedPercent)}% used
                                    {#if window.resetsAt}<small>· resets in {formatReset(window.resetsAt)}</small>{/if}
                                </span>
                            </div>
                            <div class="track" role="progressbar" aria-label={`${windowLabel(window)} used`} aria-valuenow={percent(window.usedPercent)} aria-valuemin="0" aria-valuemax="100">
                                <span class:critical={percent(window.usedPercent) >= 90} class:warning={percent(window.usedPercent) >= 70 && percent(window.usedPercent) < 90} style={`width:${percent(window.usedPercent)}%`}></span>
                            </div>
                        </div>
                    {/each}

                    {#if snapshot.individualLimit}
                        <div class="summary-line">
                            <span>Monthly limit</span>
                            <span>{snapshot.individualLimit.used} of {snapshot.individualLimit.limit}</span>
                        </div>
                    {/if}
                    {#if snapshot.credits?.hasCredits}
                        <div class="summary-line">
                            <span>Credits</span>
                            <span>{snapshot.credits.unlimited ? "Unlimited" : snapshot.credits.balance || "—"}</span>
                        </div>
                    {/if}
                {/each}

                {#if selectedAccount.rateLimitResetCredits?.availableCount}
                    <div class="summary-line">
                        <span>Resets available</span>
                        <span>{selectedAccount.rateLimitResetCredits.availableCount}</span>
                    </div>
                {/if}
                {#if selectedAccount.usage?.summary?.lifetimeTokens != null}
                    <div class="activity">
                        <span>{tokenText(selectedAccount.usage.summary.lifetimeTokens)} lifetime tokens</span>
                        {#if selectedAccount.usage.summary.currentStreakDays}
                            <span>{selectedAccount.usage.summary.currentStreakDays} active days</span>
                        {/if}
                    </div>
                {/if}
            {/if}
        </section>
    {:else}
        <div class="account-list">
            {#each accounts as account (account.name)}
                <section class:unavailable={!account.ok} class="account-card">
                    <button class="account-head" type="button" on:click={() => openAccount(account)} aria-label={`View ${account.name} details`}>
                        <div class="identity">
                            <span class:offline={!account.ok} class="status-dot"></span>
                            <strong>{account.name}</strong>
                        </div>
                        <span class="account-preview">
                            {#if account.ok}
                                {#each previewWindows(account) as window (window.windowDurationMins)}
                                    <span class="preview-window">
                                        <span>{windowLabel(window)}</span>
                                        <span class:critical={percent(window.usedPercent) >= 90} class:warning={percent(window.usedPercent) >= 70 && percent(window.usedPercent) < 90} class="account-peak">{Math.round(percent(window.usedPercent))}%</span>
                                        {#if window.resetsAt}<small>resets in {formatReset(window.resetsAt)}</small>{/if}
                                    </span>
                                {/each}
                            {:else}
                                <span class="account-peak">unavailable</span>
                            {/if}
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
                        </span>
                    </button>
                </section>
            {/each}
        </div>
    {/if}

</div>

<style>
    :global(html), :global(body) {
        margin: 0;
        padding: 0;
        background: transparent;
        overflow-x: hidden;
    }
    :global(*) { box-sizing: border-box; }

    [data-theme="dark"] {
        --tk-bg: #111111;
        --tk-surface: #181818;
        --tk-surface-2: #1f1f1f;
        --tk-border: rgba(255,255,255,.09);
        --tk-border-hi: rgba(255,255,255,.16);
        --tk-text: #f5f5f5;
        --tk-muted: #888888;
        --tk-muted-2: rgba(136,136,136,.5);
        --tk-accent: #f5f5f5;
        --tk-on-accent: #111111;
        --tk-radius-md: 8px;
        --tk-radius-lg: 14px;
        --tk-font: 'Ubuntu', system-ui, sans-serif;
        --tk-mono: 'Ubuntu Mono', monospace;
    }
    [data-theme="light"] {
        --tk-bg: #ffffff;
        --tk-surface: #f5f5f5;
        --tk-surface-2: #ececec;
        --tk-border: rgba(0,0,0,.10);
        --tk-border-hi: rgba(0,0,0,.18);
        --tk-text: #1a1a1a;
        --tk-muted: #666666;
        --tk-muted-2: rgba(0,0,0,.4);
        --tk-accent: #111111;
        --tk-on-accent: #ffffff;
        --tk-radius-md: 8px;
        --tk-radius-lg: 14px;
        --tk-font: 'Ubuntu', system-ui, sans-serif;
        --tk-mono: 'Ubuntu Mono', monospace;
    }

    .wrap {
        width: 100%;
        max-width: 420px;
        margin: 0 auto;
        padding: 8px 12px 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        color: var(--tk-text);
        background: transparent;
        font: 400 12px/1.4 var(--tk-font);
    }
    .widget-meta { min-height: 20px; display: flex; justify-content: flex-end; align-items: center; gap: 4px; color: var(--tk-muted-2); font-size: 9px; }
    .back-button {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        margin-right: auto;
        padding: 0;
        border: 0;
        color: var(--tk-muted);
        background: transparent;
        cursor: pointer;
        font: 500 10px/1 var(--tk-font);
    }
    .back-button:hover { color: var(--tk-text); }
    .back-button svg {
        width: 14px;
        height: 14px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.8;
        stroke-linecap: round;
        stroke-linejoin: round;
    }
    .icon-button {
        width: 24px;
        height: 24px;
        display: grid;
        place-items: center;
        padding: 0;
        border: 0;
        color: var(--tk-muted);
        background: transparent;
        cursor: pointer;
    }
    .icon-button:hover { color: var(--tk-text); border-color: var(--tk-border-hi); }
    .icon-button:disabled { opacity: .45; cursor: default; }
    .icon-button svg {
        width: 14px;
        height: 14px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.8;
        stroke-linecap: round;
        stroke-linejoin: round;
    }
    .account-list { display: flex; flex-direction: column; border: 1px solid var(--tk-border); border-radius: 12px; overflow: hidden; }
    .account-card {
        padding: 0;
        display: flex;
        flex-direction: column;
        border-top: 1px solid var(--tk-border);
        background: transparent;
    }
    .account-card:first-child { border-top: 0; }
    .account-card:last-child { border-bottom: 0; }
    .account-card.unavailable { opacity: .72; }
    .account-head, .identity, .quota-meta, .summary-line, .activity, .account-preview, .preview-window {
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .account-head {
        width: 100%;
        min-height: 38px;
        justify-content: space-between;
        padding: 7px 10px;
        border: 0;
        color: inherit;
        background: transparent;
        cursor: pointer;
        font: inherit;
        text-align: left;
    }
    .account-head:hover { background: var(--tk-surface); }
    .account-head:hover .identity strong { color: var(--tk-accent); }
    .account-preview { flex: 0 0 auto; justify-content: flex-end; color: var(--tk-muted); }
    .preview-window { gap: 3px; color: var(--tk-muted); font: 400 9px/1 var(--tk-mono); white-space: nowrap; }
    .preview-window + .preview-window { padding-left: 6px; border-left: 1px solid var(--tk-border); }
    .preview-window small { color: var(--tk-muted-2); font: inherit; }
    .account-peak { font: 700 10px/1 var(--tk-mono); }
    .account-peak.warning { opacity: .65; }
    .account-peak.critical { opacity: .4; }
    .account-preview svg {
        width: 14px;
        height: 14px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.8;
        stroke-linecap: round;
        stroke-linejoin: round;
        transition: transform 200ms ease-out;
    }
    .identity { min-width: 0; }
    .identity strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
    .status-dot {
        width: 6px;
        height: 6px;
        flex: 0 0 auto;
        border-radius: 50%;
        background: var(--tk-text);
    }
    .status-dot.offline { background: var(--tk-muted-2); }
    .quota-row { display: flex; flex-direction: column; gap: 4px; }
    .quota-meta { justify-content: space-between; color: var(--tk-muted); font-size: 10px; }
    .quota-value { color: var(--tk-text); font-weight: 500; white-space: nowrap; }
    .quota-value small { color: var(--tk-muted); font-weight: 400; }
    .track {
        height: 5px;
        overflow: hidden;
        border-radius: var(--tk-radius-md);
        background: var(--tk-surface-2);
    }
    .track span {
        display: block;
        height: 100%;
        background: var(--tk-accent);
        transition: transform 250ms ease-out;
        transform-origin: left;
    }
    .track span.warning { opacity: .65; }
    .track span.critical { opacity: .4; }
    .account-detail-view { min-height: 100%; padding: 8px 2px 10px; display: flex; flex-direction: column; gap: 10px; }
    .detail-heading { display: flex; align-items: center; gap: 7px; font-size: 14px; }
    .detail-plan { color: var(--tk-muted); font-size: 9px; font-weight: 700; text-transform: uppercase; }
    .summary-line { justify-content: space-between; color: var(--tk-muted); font-size: 10px; }
    .summary-line span:last-child { color: var(--tk-text); }
    .activity {
        justify-content: space-between;
        padding-top: 6px;
        border-top: 1px solid var(--tk-border);
        color: var(--tk-muted);
        font: 400 9px/1.3 var(--tk-mono);
    }
    .limit-name { color: var(--tk-muted); font-size: 9px; text-transform: uppercase; letter-spacing: .05em; }
    .notice, .account-error {
        margin: 0;
        padding: 9px 10px;
        border-radius: 10px;
        border: 1px solid var(--tk-border);
        color: var(--tk-muted);
        background: transparent;
        font-size: 11px;
    }
    .notice.error, .account-error { color: var(--tk-text); border-color: var(--tk-border-hi); }
    @media (max-width: 360px) {
        .preview-window small { display: none; }
    }
</style>
