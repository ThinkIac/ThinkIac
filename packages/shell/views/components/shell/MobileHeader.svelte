<script>
    export let isMobile;
    export let floatingShell;
    export let activeIsApp;
    export let openLeft;
    export let mobileHome;
    export let goForwardMobile;
    export let canGoForwardMobile;
    export let activeTabName;
    export let activeHeaderActions;
    export let runHeaderAction;
    export let openAppInfo;
    export let enterMobileFullscreen;
    export let refreshMobileApp;
    export let appRefreshingMap;
    export let activeTab;
    export let closeActiveMobileTab;
    export let openRight;
    export let goBackMobile;
    export let canGoBackMobile;
    export let openChatInfo;
    export let refreshMobileChat;
    export let chatRefreshing;
    export let chatFeatureAvailability;
    export let openArtifactLibrary;
    export let openBag;
    export let mobileHeaderCollapsed;
    export let appMenuOpen;
    export let chatMenuOpen;
</script>

{#if isMobile && !floatingShell}
    <div class="mobile-topbar-dock" class:collapsed={mobileHeaderCollapsed}>
    <div
        class="mobile-topbar"
        class:collapsed={mobileHeaderCollapsed}
        aria-hidden={mobileHeaderCollapsed}
        inert={mobileHeaderCollapsed}
    >
        {#if activeIsApp}
            <button class="mtb-btn" on:click={openLeft} aria-label="Docks and sessions"><svg viewBox="0 0 16 16" fill="none" width="17" height="17"><path d="M2 4.5h12M2 8h12M2 11.5h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
            <button class="mtb-btn" on:click={mobileHome} aria-label="Back" title="Back">
                <svg viewBox="0 0 16 16" fill="none" width="17" height="17"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button class="mtb-btn" on:click={goForwardMobile} disabled={!canGoForwardMobile} aria-label="Forward" title="Forward">
                <svg viewBox="0 0 16 16" fill="none" width="17" height="17" aria-hidden="true"><path d="m6 3 5 5-5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button
                type="button"
                class="mtb-app-title"
                on:click={() => (mobileHeaderCollapsed = true)}
                aria-label={`Collapse header for ${activeTabName}`}
                title="Collapse header"
            >{activeTabName}</button>
            <div class="mtb-app-menu" on:click|stopPropagation>
                <button class="mtb-btn" class:active={appMenuOpen} on:click={() => (appMenuOpen = !appMenuOpen)} aria-label="App options" aria-expanded={appMenuOpen}>
                    <svg viewBox="0 0 16 16" fill="currentColor" width="17" height="17" aria-hidden="true"><circle cx="3" cy="8" r="1.25"/><circle cx="8" cy="8" r="1.25"/><circle cx="13" cy="8" r="1.25"/></svg>
                </button>
                {#if appMenuOpen}
                    <div class="mtb-app-dropdown" role="menu" aria-label="App options">
                        {#each activeHeaderActions as action (`${action.sourcePackage}:${action.id}`)}
                            <button type="button" role="menuitem" class="mtb-header-action" on:click={() => runHeaderAction(action)}>
                                <span><strong>{action.label}</strong>{#if action.description}<small>{action.description}</small>{/if}</span>
                            </button>
                        {/each}
                        <div class="mtb-menu-actions" aria-label="Package actions">
                            <button type="button" role="menuitem" on:click={openAppInfo} aria-label="Information" title="Information"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5.75" stroke="currentColor" stroke-width="1.35"/><path d="M8 7.1v4M8 4.75v.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
                            <button type="button" role="menuitem" on:click={enterMobileFullscreen} aria-label="Full Screen" title="Full Screen"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6.25 2.75-3.5 3.5m0 0V3.4m0 2.85H5.6m4.15 7 3.5-3.5m0 0v2.85m0-2.85H10.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
                            <button type="button" role="menuitem" on:click={refreshMobileApp} disabled={appRefreshingMap[activeTab]} aria-label="Refresh" title="Refresh"><svg class:refreshing={appRefreshingMap[activeTab]} viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13 5.5A5.5 5.5 0 1 0 13.2 10M13 2.7v3h-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
                            <button type="button" role="menuitem" on:click={closeActiveMobileTab} aria-label="Close" title="Close"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m5 5 6 6m0-6-6 6" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"/></svg></button>
                        </div>
                    </div>
                {/if}
            </div>
            <button class="mtb-btn" on:click={openRight} aria-label="Apps"><svg viewBox="0 0 20 20" fill="none" width="17" height="17"><rect x="2" y="2" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.4"/><rect x="11" y="2" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.4"/><rect x="2" y="11" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.4"/><rect x="11" y="11" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.4"/></svg></button>
        {:else}
            <button class="mtb-btn" on:click={openLeft} aria-label="Docks and sessions"><svg viewBox="0 0 16 16" fill="none" width="17" height="17"><path d="M2 4.5h12M2 8h12M2 11.5h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
            <button class="mtb-btn" on:click={goBackMobile} disabled={!canGoBackMobile} aria-label="Back" title="Back">
                <svg viewBox="0 0 16 16" fill="none" width="17" height="17" aria-hidden="true"><path d="M10 3 5 8l5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button class="mtb-btn" on:click={goForwardMobile} disabled={!canGoForwardMobile} aria-label="Forward" title="Forward">
                <svg viewBox="0 0 16 16" fill="none" width="17" height="17" aria-hidden="true"><path d="m6 3 5 5-5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button
                type="button"
                class="mtb-title"
                on:click={() => (mobileHeaderCollapsed = true)}
                aria-label={`Collapse header for ${activeTabName}`}
                title="Collapse header"
            ><span class="mtb-title-text">{activeTabName}</span></button>
            <div class="mtb-app-menu" on:click|stopPropagation>
                <button class="mtb-btn" class:active={chatMenuOpen} on:click={() => (chatMenuOpen = !chatMenuOpen)} aria-label="Chat options" aria-expanded={chatMenuOpen}>
                    <svg viewBox="0 0 16 16" fill="currentColor" width="17" height="17" aria-hidden="true"><circle cx="3" cy="8" r="1.25"/><circle cx="8" cy="8" r="1.25"/><circle cx="13" cy="8" r="1.25"/></svg>
                </button>
                {#if chatMenuOpen}
                    <div class="mtb-app-dropdown" role="menu" aria-label="Chat options">
                        <div class="mtb-menu-actions" aria-label="Chat actions">
                            <button type="button" role="menuitem" on:click={openChatInfo} aria-label="Information" title="Information"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5.75" stroke="currentColor" stroke-width="1.35"/><path d="M8 7.1v4M8 4.75v.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
                            <button type="button" role="menuitem" on:click={enterMobileFullscreen} aria-label="Full Screen" title="Full Screen"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6.25 2.75-3.5 3.5m0 0V3.4m0 2.85H5.6m4.15 7 3.5-3.5m0 0v2.85m0-2.85H10.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
                            <button type="button" role="menuitem" on:click={refreshMobileChat} disabled={chatRefreshing} aria-label="Refresh" title="Refresh"><svg class:refreshing={chatRefreshing} viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13 5.5A5.5 5.5 0 1 0 13.2 10M13 2.7v3h-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
                            <button type="button" role="menuitem" on:click={closeActiveMobileTab} aria-label="Close" title="Close"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m5 5 6 6m0-6-6 6" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"/></svg></button>
                        </div>
                        {#if chatFeatureAvailability.artifacts}
                            <button type="button" role="menuitem" on:click={openArtifactLibrary}>
                                <span class="mtb-menu-icon"><svg viewBox="0 0 16 16" fill="none" width="16" height="16" aria-hidden="true"><path d="M3 2.75h6.2l3.8 3.8v6.7H3z" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/><path d="M9.2 2.75v3.8H13M5.4 9.25h5.2m-5.2 2.25h3.4" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
                                <span><strong>Artifacts</strong><small>Browse generated files</small></span>
                            </button>
                        {/if}
                        {#if chatFeatureAvailability.bags}
                            <button type="button" role="menuitem" on:click={openBag}>
                                <span class="mtb-menu-icon"><svg viewBox="0 0 16 16" fill="none" width="16" height="16" aria-hidden="true"><path d="M3 2.5h10v11H3z" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/><path d="M5.25 5.5h5.5M5.25 8h5.5M5.25 10.5h3.4" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/></svg></span>
                                <span><strong>Bag</strong><small>View session plan</small></span>
                            </button>
                        {/if}
                    </div>
                {/if}
            </div>
            <button class="mtb-btn" on:click={openRight} aria-label="Apps"><svg viewBox="0 0 20 20" fill="none" width="17" height="17"><rect x="2" y="2" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.4"/><rect x="11" y="2" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.4"/><rect x="2" y="11" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.4"/><rect x="11" y="11" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.4"/></svg></button>
        {/if}
    </div>
    {#if mobileHeaderCollapsed}
        <div class="mobile-fullscreen-center">
            <button type="button" class="mobile-topbar-toggle" on:click={() => (mobileHeaderCollapsed = false)} aria-expanded="false" aria-label="Show header" title="Show header">
                <svg viewBox="0 0 20 12" width="18" height="11" fill="none" aria-hidden="true"><path d="M3 3.5 10 9l7-5.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </button>
        </div>
    {/if}
    </div>
{/if}

<style>
    /* ── Top bar mobile ── */
    .mobile-topbar-dock {
        --mobile-topbar-height: calc(56px + var(--safe-top, env(safe-area-inset-top)));
        position: relative;
        z-index: 10;
        flex: 0 0 auto;
        height: var(--mobile-topbar-height);
        transition: height 280ms cubic-bezier(0.22, 0.75, 0.18, 1);
    }
    .mobile-topbar-dock::after {
        content: "";
        position: absolute;
        right: 0;
        bottom: 0;
        left: 0;
        z-index: 0;
        height: 18px;
        background: linear-gradient(to bottom, transparent, color-mix(in srgb, var(--bg) 28%, transparent));
        pointer-events: none;
        transition: opacity 180ms ease;
    }
    .mobile-topbar-dock.collapsed {
        /* Em fullscreen, o controle não reserva uma faixa do cabeçalho: ele
           flutua sobre o conteúdo, como as setas das laterais. */
        height: 0;
    }
    .mobile-topbar-dock.collapsed::after {
        opacity: 0;
    }
    .mobile-topbar {
        display: flex;
        align-items: center;
        gap: 8px;
        height: calc(56px + var(--safe-top, env(safe-area-inset-top)));
        padding: var(--safe-top, env(safe-area-inset-top)) 10px 0;
        position: absolute;
        inset: 0 0 auto;
        z-index: 1;
        border: 0;
        border-bottom: 1px solid color-mix(in srgb, var(--border) 52%, transparent);
        background: transparent;
        opacity: 1;
        transform: translateY(0);
        transition: transform 280ms cubic-bezier(0.22, 0.75, 0.18, 1), opacity 180ms ease;
    }
    .mobile-topbar.collapsed {
        opacity: 0;
        pointer-events: none;
        transform: translateY(calc(-1 * var(--mobile-topbar-height)));
    }
    .mobile-fullscreen-center {
        position: absolute;
        z-index: 2;
        top: 0;
        left: 50%;
        display: flex;
        height: 38px;
        align-items: center;
        justify-content: center;
        gap: 5px;
        transform: translateX(-50%);
    }
    .mobile-topbar-toggle {
        display: flex;
        width: 38px;
        height: 38px;
        align-items: center;
        justify-content: center;
        padding: 0;
        border: 0;
        border-radius: 0;
        background-color: transparent;
        box-shadow: none;
        color: var(--txt-2);
        opacity: 0.52;
        cursor: pointer;
        transition: color 150ms ease, opacity 150ms ease;
        -webkit-tap-highlight-color: transparent;
    }
    .mobile-topbar-toggle:active {
        color: var(--txt);
        opacity: 0.9;
    }
    .mobile-topbar-toggle:focus-visible {
        outline: 2px solid var(--border-strong);
        outline-offset: 2px;
    }
    .mtb-btn {
        width: 40px;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 12px;
        border: 1px solid transparent;
        background: transparent;
        color: var(--txt-2);
        cursor: pointer;
        flex-shrink: 0;
        -webkit-tap-highlight-color: transparent;
        transition: background 0.15s, color 0.15s, border-color 0.15s;
    }
    .mtb-btn:active {
        background: var(--w06);
        color: var(--txt);
        border-color: var(--border);
        transform: scale(0.93);
    }
    .mtb-title {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 0 6px;
        background: transparent;
        border: none;
        color: var(--txt);
        font-family: var(--font-body);
        font-size: 15px;
        font-weight: 600;
        letter-spacing: 0.01em;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
    }
    .mtb-title-text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .mtb-app-title {
        flex: 1;
        min-width: 0;
        padding: 0 6px;
        border: 0;
        background: transparent;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--txt);
        font: 600 15px var(--font-body);
        letter-spacing: 0.01em;
        text-align: center;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
    }
    .mtb-title:focus-visible,
    .mtb-app-title:focus-visible {
        outline: 2px solid var(--border-strong);
        outline-offset: 2px;
        border-radius: 4px;
    }
    .mtb-app-menu { position: relative; flex-shrink: 0; }
    .mtb-btn.active { background: var(--w06); color: var(--txt); border-color: var(--border); }
    .mtb-btn.refreshing { cursor: wait; }
    .mtb-btn.refreshing svg { animation: mtb-refresh-spin .7s linear infinite; }
    .mtb-btn:disabled { cursor: not-allowed; opacity: .48; }
    @keyframes mtb-refresh-spin { to { transform: rotate(360deg); } }
    .mtb-app-dropdown {
        position: absolute;
        top: calc(100% + 5px);
        right: 0;
        min-width: 158px;
        padding: 4px;
        border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
        border-radius: 10px;
        background: color-mix(in srgb, var(--bg) 94%, transparent);
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.18);
        backdrop-filter: blur(20px) saturate(1.15);
        animation: mtb-menu-in 160ms cubic-bezier(.22,.75,.18,1);
    }
    .mtb-menu-actions { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2px; }
    .mtb-header-action { min-height: 42px; text-align: left; }
    .mtb-header-action + .mtb-header-action { border-top: 1px solid color-mix(in srgb, var(--border) 52%, transparent); }
    .mtb-header-action > span { display: grid; gap: 2px; }
    .mtb-app-dropdown .mtb-menu-actions button {
        display: grid;
        width: 30px;
        height: 30px;
        min-height: 30px;
        place-items: center;
        padding: 0;
        border: 1px solid transparent;
        border-radius: 7px;
        color: var(--txt-2);
    }
    .mtb-app-dropdown .mtb-menu-actions button:hover, .mtb-app-dropdown .mtb-menu-actions button:focus-visible { border-color: color-mix(in srgb, var(--border) 72%, transparent); background: var(--w06); color: var(--txt); outline: none; }
    .mtb-menu-actions button svg { width: 15px; height: 15px; }
    .mtb-app-dropdown > button {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 9px;
        min-height: 36px;
        margin-top: 3px;
        padding: 6px;
        border: 0;
        border-radius: 7px;
        background: transparent;
        color: var(--txt);
        font: 500 12px var(--font-body);
        text-align: left;
        transition: background 140ms ease, transform 140ms ease;
    }
    .mtb-app-dropdown > button:hover, .mtb-app-dropdown > button:focus-visible { background: var(--w06); outline: none; }
    .mtb-app-dropdown > button:active { background: var(--w06); transform: scale(.985); }
    .mtb-app-dropdown button:disabled { cursor: wait; opacity: .62; }
    .mtb-menu-icon { display: grid; width: 32px; height: 32px; flex: 0 0 auto; place-items: center; border: 1px solid color-mix(in srgb, var(--border) 65%, transparent); border-radius: 9px; background: var(--w03); color: var(--txt-2); }
    .mtb-app-dropdown button > span:last-child { display: grid; gap: 2px; }
    .mtb-app-dropdown strong { font: 600 13px var(--font-body); }
    .mtb-app-dropdown small { color: var(--txt-3); font: 400 10px var(--font-body); }
    .mtb-session-id small { max-width: 148px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono, ui-monospace, monospace); }
    .mtb-app-dropdown svg { flex: 0 0 auto; }
    .mtb-app-dropdown svg.refreshing { animation: mtb-refresh-spin .7s linear infinite; }
    @keyframes mtb-menu-in { from { opacity: 0; transform: translateY(-4px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }

</style>
