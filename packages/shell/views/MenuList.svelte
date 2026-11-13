<script>
    // MenuList — renderiza UM contexto de menu (desktop / painel esquerdo /
    // painel direito) em dois modos:
    //   • Normal: cada item monta seu widget (nativo ou de pacote), opcional-
    //     mente sanfonado (accordionMode). Ícones de pacote sempre ao lado.
    //   • Edição: a "Reforma na Configuração dos Menus" — os itens viram
    //     linhas colapsáveis arrastáveis com on/off; os desativados ficam
    //     destacados no topo e podem ser arrastados (ou toggle) pra ativar;
    //     itens de pacote que declaram `manifest.menu.edit` ganham um chevron
    //     que revela o "Widget de Edição do Widget" inline.
    //
    // Antes esse switch de item existia triplicado em Sidebar.svelte (desktop +
    // 2 painéis mobile); agora vive num lugar só e o Sidebar só o instancia 3x.
    import { dndzone } from "svelte-dnd-action";
    import Apps from "./Apps.svelte";
    import Windows from "./Windows.svelte";
    import Sessions from "./Sessions.svelte";
    import ChatSessionsCompact from "./ChatSessionsCompact.svelte";
    import PackageWidget from "./components/PackageWidget.svelte";
    import ProfileSwitcher from "./ProfileSwitcher.svelte";
    import {
        menuItems,
        leftPanelItems,
        rightPanelItems,
        desktopMenuItems,
        accordionMode,
        setAccordionMode,
        accordionOpenMap,
        toggleAccordionOpen,
        setItemVisible,
        setItemLabel,
        activateItem,
        reorderMenuItems,
    } from "./lib/menu_bootstrap.js";

    export let context = "desktop"; // "desktop" | "left" | "right"
    export let editMode = false;
    export let widgetsEnabled = true;

    // Variações de contexto
    export let appsLauncher = false; // mobile usa o launcher paginado dos Apps
    export let guardWindows = false; // desktop só mostra Dock se há abas abertas

    // Dados dos widgets nativos
    export let appTabs = [];
    export let chatTabs = [];
    export let activeTab = "";
    export let loadingMap = {};
    export let unreadMap = {};
    export let refreshTrigger = 0;
    export let sessionId = "default";
    export let activeIsApp = false;
    // Tema ativo — decide qual variante de ícone do pacote é usada
    // (`manifest.iconDark` quando dark). Ver SlateIcon.
    export let theme = "dark";

    // Callbacks (já embutem o fechar-painel quando aplicável — ver Sidebar)
    export let onOpenApp = () => {};
    export let onAppInfo = () => {};
    export let onSelectApp = () => {};
    export let onCloseApp = () => {};
    export let onCloseAllApps = () => {};
    export let onReorderApps = () => {};
    export let onSelectChat = () => {};
    export let onCloseChat = () => {};
    export let onCloseAllChats = () => {};
    export let onSelectSession = () => {};
    export let onDeleteSession = () => {};
    export let onTogglePin = () => {};
    export let onPinnedChange = () => {};
    export let onNewTopic = () => {};

    // Escolhe a variante de ícone do item para o tema atual. Mesma cascata do
    // SlateIcon (dark svg → dark raster → svg → raster), só que devolvendo o
    // par {kind, value} para o markup continuar usando as classes locais
    // (.chip-icon / .menu-pkg-icon) em vez de uma caixa Slate completa.
    function pickIcon(item, mode) {
        if (!item) return null;
        if (mode === "dark" && item.iconDarkSvg) return { kind: "svg", value: item.iconDarkSvg };
        if (mode === "dark" && item.iconDark) return { kind: "img", value: item.iconDark };
        if (item.iconSvg) return { kind: "svg", value: item.iconSvg };
        if (item.icon) return { kind: "img", value: item.icon };
        return null;
    }

    // Lista ordenada/visível deste contexto (modo normal).
    $: normalItems =
        context === "desktop" ? $desktopMenuItems
        : context === "left" ? $leftPanelItems
        : $rightPanelItems;

    // ── Estado do modo edição ──────────────────────────────────────────────
    // Faixa "Desativados" (todos os itens ocultos, compartilhada entre painéis)
    // no topo + lista ativa deste contexto abaixo. Cópias locais mutáveis pro
    // svelte-dnd-action; ressincronizadas quando as stores mudam (fora do drag,
    // que não altera store até o finalize).
    let dndActive = [];
    let dndDisabled = [];
    $: if (editMode) {
        dndActive = normalItems;
        dndDisabled = $menuItems.filter((i) => !i.visible);
    }

    const ZONE_TYPE = "menu-edit";

    function considerActive(e) { dndActive = e.detail.items; }
    function finalizeActive(e) {
        dndActive = e.detail.items;
        // Qualquer item que veio dos desativados nasce visível neste painel.
        for (const it of dndActive) if (!it.visible) activateItem(it.id, context);
        reorderMenuItems(context, dndActive.map((i) => i.id));
    }
    function considerDisabled(e) { dndDisabled = e.detail.items; }
    function finalizeDisabled(e) {
        dndDisabled = e.detail.items;
        for (const it of dndDisabled) if (it.visible) setItemVisible(it.id, false);
    }

    function toggleItem(item) {
        if (item.visible) setItemVisible(item.id, false);
        else activateItem(item.id, context); // reativa já fixando o painel atual
    }
    function rename(item, e) {
        const v = e.target.value.trim();
        if (v && v !== item.label) setItemLabel(item.id, v);
    }
    function commitOnEnter(e) { if (e.key === "Enter") e.target.blur(); }

    // Um "Widget de Edição do Widget" aberto por vez (só itens editáveis).
    let expandedEditId = null;
    function toggleEditPanel(item) {
        if (!item.editable) return;
        expandedEditId = expandedEditId === item.id ? null : item.id;
    }
</script>

{#if editMode}
    <!-- ══ MODO EDIÇÃO ══ -->
    <!-- Perfis primeiro: é o escopo de tudo que vem abaixo — o que se arrasta
         e liga/desliga aqui pertence ao perfil ativo. -->
    <ProfileSwitcher />

    <!-- Preferência de exibição do modo normal fica no topo para permanecer
         acessível mesmo quando há muitos itens configuráveis. -->
    <div class="edit-controls">
        <span class="edit-controls-label">Display as accordion</span>
        <button
            class="row-toggle"
            class:is-on={$accordionMode}
            on:click={() => setAccordionMode(!$accordionMode)}
            aria-pressed={$accordionMode}
            aria-label="Display menu items as an accordion"
            title="Each item becomes collapsible in normal mode"
        >
            <span class="row-toggle-knob"></span>
        </button>
    </div>

    {#if dndDisabled.length > 0}
        <div class="disabled-strip">
            <span class="strip-title">Disabled — drag to enable</span>
            <div
                class="disabled-list"
                use:dndzone={{ items: dndDisabled, type: ZONE_TYPE, flipDurationMs: 150, dropTargetStyle: {} }}
                on:consider={considerDisabled}
                on:finalize={finalizeDisabled}
            >
                {#each dndDisabled as item (item.id)}
                    <div class="chip">
                        {#if pickIcon(item, theme)?.kind === "svg"}
                            <span class="chip-icon chip-icon-svg">{@html pickIcon(item, theme).value}</span>
                        {:else if pickIcon(item, theme)}
                            <img src={pickIcon(item, theme).value} alt="" class="chip-icon" />
                        {:else}
                            <span class="chip-icon chip-icon-fallback">{item.label[0].toUpperCase()}</span>
                        {/if}
                        <span class="chip-label">{item.label}</span>
                        <button class="mini-toggle" on:click={() => toggleItem(item)} aria-label="Enable" title="Enable">
                            <svg viewBox="0 0 16 16" fill="none" width="12" height="12">
                                <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                            </svg>
                        </button>
                    </div>
                {/each}
            </div>
        </div>
    {/if}

    <div
        class="edit-list"
        use:dndzone={{ items: dndActive, type: ZONE_TYPE, flipDurationMs: 150, dragHandleSelector: ".drag-handle", dropTargetStyle: {} }}
        on:consider={considerActive}
        on:finalize={finalizeActive}
    >
        {#each dndActive as item (item.id)}
            <div class="edit-item">
                <div class="edit-row">
                    <span class="drag-handle" aria-hidden="true">
                        <svg viewBox="0 0 16 16" fill="none" width="12" height="12">
                            <circle cx="5" cy="4" r="1.1" fill="currentColor"/><circle cx="11" cy="4" r="1.1" fill="currentColor"/>
                            <circle cx="5" cy="8" r="1.1" fill="currentColor"/><circle cx="11" cy="8" r="1.1" fill="currentColor"/>
                            <circle cx="5" cy="12" r="1.1" fill="currentColor"/><circle cx="11" cy="12" r="1.1" fill="currentColor"/>
                        </svg>
                    </span>
                    <!-- No modo edição os ativos escondem o ícone pra enxugar
                         espaço (o ícone só aparece nos desativados, ver task). -->
                    <input
                        class="row-label-input"
                        value={item.label}
                        on:blur={(e) => rename(item, e)}
                        on:keydown={commitOnEnter}
                        aria-label="Item name"
                    />
                    {#if item.editable}
                        <button
                            class="edit-chevron"
                            class:open={expandedEditId === item.id}
                            on:click={() => toggleEditPanel(item)}
                            aria-label="Configure widget"
                            title="Configure"
                        >
                            <svg viewBox="0 0 16 16" fill="none" width="12" height="12">
                                <path d="M8 5.3a2.7 2.7 0 100 5.4 2.7 2.7 0 000-5.4z" stroke="currentColor" stroke-width="1.3"/>
                                <path d="M13.2 8c0 .34-.03.66-.08.97l1.36 1.06-1.36 2.36-1.6-.54c-.5.4-1.08.72-1.7.94l-.25 1.7H6.43l-.25-1.7a5.3 5.3 0 01-1.7-.94l-1.6.54-1.36-2.36 1.36-1.06A5.4 5.4 0 012.8 8c0-.34.03-.66.08-.97L1.52 5.97l1.36-2.36 1.6.54c.5-.4 1.08-.72 1.7-.94l.25-1.7h3.14l.25 1.7c.62.22 1.2.54 1.7.94l1.6-.54 1.36 2.36-1.36 1.06c.05.31.08.63.08.97z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>
                            </svg>
                        </button>
                    {/if}
                    <button
                        class="row-toggle is-on"
                        on:click={() => toggleItem(item)}
                        aria-pressed="true"
                        aria-label="Disable item"
                        title="Disable"
                    >
                        <span class="row-toggle-knob"></span>
                    </button>
                </div>
                {#if item.editable && expandedEditId === item.id}
                    <div class="edit-panel">
                        <PackageWidget url={item.url} title={item.label} flat edit />
                    </div>
                {/if}
            </div>
        {/each}
    </div>

{:else}
    <!-- ══ MODO NORMAL ══ -->
    {#each normalItems as item (item.id)}
        <div class="menu-item">
            {#if $accordionMode}
                <button class="acc-header" on:click={() => toggleAccordionOpen(item.id)}>
                    {#if pickIcon(item, theme)?.kind === "svg"}
                        <span class="menu-pkg-icon menu-pkg-icon-svg">{@html pickIcon(item, theme).value}</span>
                    {:else if pickIcon(item, theme)}
                        <img src={pickIcon(item, theme).value} alt="" class="menu-pkg-icon" />
                    {/if}
                    <span class="acc-label">{item.label}</span>
                    <svg class="acc-chevron" class:acc-open={$accordionOpenMap[item.id] !== false} viewBox="0 0 16 16" fill="none" width="12" height="12">
                        <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </button>
            {/if}
            <div class="menu-item-body" class:acc-hidden={$accordionMode && $accordionOpenMap[item.id] === false}>
                {#if item.id === "apps"}
                    {#if widgetsEnabled}
                        <Apps
                            variant={appsLauncher ? "launcher" : undefined}
                            on:open={onOpenApp}
                            on:info={onAppInfo}
                            on:pinnedChange={onPinnedChange}
                        />
                    {/if}
                {:else if item.id === "windows"}
                    {#if !guardWindows || appTabs.length > 0 || chatTabs.length > 1}
                        <Windows
                            {appTabs}
                            {chatTabs}
                            {activeTab}
                            {theme}
                            on:selectApp={onSelectApp}
                            on:closeApp={onCloseApp}
                            on:closeAllApps={onCloseAllApps}
                            on:reorderApps={onReorderApps}
                            on:selectChat={onSelectChat}
                            on:closeChat={onCloseChat}
                        />
                    {/if}
                {:else if item.id === "chat-sessions"}
                    <div class="chat-topic-actions mb-1 flex gap-1">
                        <button
                            class="new-topic-button flex min-h-[38px] flex-1 cursor-pointer items-center gap-2 rounded-[var(--tk-radius-md)] border border-[var(--rail-border)] bg-[var(--rail-flat)] font-sans text-[12.5px] font-medium text-[var(--rail-txt-2)] transition-[transform,opacity] duration-200 ease-out hover:opacity-80 active:scale-[0.98]"
                            on:click={onNewTopic}
                            aria-label="New Topic"
                        >
                            <span class="new-topic-icon flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[var(--tk-radius-md)] border border-[var(--rail-border)]">
                                <svg viewBox="0 0 16 16" fill="none" width="11" height="11" aria-hidden="true">
                                    <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                                </svg>
                            </span>
                            New Topic
                        </button>
                        <button
                            class="flex min-h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[var(--tk-radius-md)] border border-[var(--rail-border)] bg-[var(--rail-flat)] text-[var(--rail-txt-3)] transition-[transform,opacity] duration-200 ease-out enabled:cursor-pointer enabled:hover:text-[var(--rail-txt)] enabled:active:scale-[0.94] disabled:cursor-not-allowed disabled:opacity-35"
                            on:click={onCloseAllChats}
                            disabled={chatTabs.length === 0}
                            aria-label="Close completed conversations"
                            title="Closes completed conversations and keeps active and unread ones"
                        >
                            <svg viewBox="0 0 16 16" fill="none" width="14" height="14" aria-hidden="true">
                                <path d="M3.5 4.5h9M6 2.5h4M5 4.5l.5 9h5l.5-9M6.8 7v4M9.2 7v4" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                    </div>
                    <ChatSessionsCompact
                        {chatTabs}
                        {activeTab}
                        {loadingMap}
                        {unreadMap}
                        on:selectChat={onSelectChat}
                        on:closeChat={onCloseChat}
                        on:togglePin={onTogglePin}
                    />
                {:else if item.id === "sessions"}
                    {#if widgetsEnabled}
                        <Sessions
                            {refreshTrigger}
                            {loadingMap}
                            {unreadMap}
                            currentSessionId={sessionId}
                            {activeIsApp}
                            {onNewTopic}
                            on:selectSession={onSelectSession}
                            on:deleteSession={onDeleteSession}
                        />
                    {/if}
                {:else}
                    <div class="menu-pkg-widget">
                        {#if !$accordionMode}
                            <div class="menu-pkg-widget-header">
                                {#if pickIcon(item, theme)?.kind === "svg"}
                                    <span class="menu-pkg-icon menu-pkg-icon-svg">{@html pickIcon(item, theme).value}</span>
                                {:else if pickIcon(item, theme)}
                                    <img src={pickIcon(item, theme).value} alt="" class="menu-pkg-icon" />
                                {/if}
                                <span class="menu-pkg-widget-label">{item.label}</span>
                            </div>
                        {/if}
                        <PackageWidget url={item.url} title={item.label} flat {theme} />
                    </div>
                {/if}
            </div>
        </div>
    {/each}
{/if}

<style>
    /* ── Modo edição ── */
    .disabled-strip {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding-bottom: 12px;
        margin-bottom: 6px;
        border-bottom: 1px dashed var(--rail-border);
    }
    .strip-title {
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--rail-txt-3);
    }
    .disabled-list {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        min-height: 30px;
    }
    .chip {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 6px 4px 8px;
        border: 1px dashed var(--rail-border-hi);
        border-radius: 999px;
        background: var(--rail-flat);
        cursor: grab;
        touch-action: none;
    }
    .chip-icon { width: 15px; height: 15px; border-radius: 4px; object-fit: cover; flex-shrink: 0; }
    /* Variante svg inline: o <span> só emoldura, quem pinta é o <svg> dentro. */
    .chip-icon-svg { display: flex; align-items: center; justify-content: center; overflow: hidden; }
    .chip-icon-svg :global(svg) { width: 100%; height: 100%; display: block; }
    .chip-icon-fallback {
        display: flex; align-items: center; justify-content: center;
        background: var(--rail-border); color: var(--rail-txt-2);
        font-size: 8px; font-weight: 600;
    }
    .chip-label {
        font-size: 11px; font-weight: 500; color: var(--rail-txt-2);
        max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .mini-toggle {
        display: flex; align-items: center; justify-content: center;
        width: 18px; height: 18px; border-radius: 50%;
        border: 1px solid var(--rail-border); background: transparent;
        color: var(--rail-txt-2); cursor: pointer; flex-shrink: 0;
        -webkit-tap-highlight-color: transparent; transition: color 0.15s, border-color 0.15s;
    }
    .mini-toggle:hover { color: var(--rail-txt); border-color: var(--rail-border-hi); }

    .edit-list { display: flex; flex-direction: column; gap: 6px; min-height: 32px; }
    .edit-item { display: flex; flex-direction: column; }
    .edit-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        border: 1px solid var(--rail-border);
        border-radius: 10px;
        background: var(--rail-flat);
    }
    .drag-handle {
        display: flex; align-items: center; justify-content: center;
        color: var(--rail-txt-3); cursor: grab; flex-shrink: 0; touch-action: none;
    }
    .row-label-input {
        flex: 1; min-width: 0; width: 0;
        font-family: inherit; font-size: 12.5px; font-weight: 500;
        color: var(--rail-txt); background: transparent;
        border: 1px solid transparent; border-radius: 5px;
        padding: 2px 4px; margin: -2px -4px;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .row-label-input:hover { border-color: var(--rail-border); }
    .row-label-input:focus {
        outline: none; border-color: var(--rail-border-hi);
        background: var(--rail-bg); text-overflow: clip;
    }
    .edit-chevron {
        display: flex; align-items: center; justify-content: center;
        width: 26px; height: 26px; border-radius: 8px;
        border: none; background: transparent; color: var(--rail-txt-3);
        cursor: pointer; flex-shrink: 0;
        -webkit-tap-highlight-color: transparent; transition: color 0.15s, transform 0.15s;
    }
    .edit-chevron:hover { color: var(--rail-txt); }
    .edit-chevron.open { color: var(--rail-txt); transform: rotate(30deg); }

    .row-toggle {
        position: relative; flex-shrink: 0;
        width: 32px; height: 18px; border-radius: 999px;
        border: 1px solid var(--rail-border); background: transparent;
        cursor: pointer; -webkit-tap-highlight-color: transparent;
        transition: background 0.15s, border-color 0.15s;
    }
    .row-toggle.is-on { background: var(--rail-txt); border-color: var(--rail-txt); }
    .row-toggle-knob {
        position: absolute; top: 1px; left: 1px;
        width: 14px; height: 14px; border-radius: 50%;
        background: var(--rail-bg); transition: transform 0.15s;
    }
    .row-toggle.is-on .row-toggle-knob { transform: translateX(14px); }

    .edit-controls {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0 0 10px;
        padding-bottom: 10px;
        border-bottom: 1px dashed var(--rail-border);
    }
    .edit-controls-label {
        flex: 1;
        font-size: 11.5px;
        font-weight: 500;
        color: var(--rail-txt-2);
    }

    .edit-panel {
        margin-top: 6px;
        padding: 8px;
        border: 1px solid var(--rail-border);
        border-radius: 10px;
        background: var(--rail-bg);
    }

    /* ── Modo normal (mesmo visual de antes) ── */
    .menu-pkg-widget { display: flex; flex-direction: column; gap: 6px; }
    .menu-pkg-widget-header { display: flex; align-items: center; gap: 6px; }
    .menu-pkg-widget-label {
        flex: 1; font-family: var(--font-sans, inherit);
        font-size: 12px; font-weight: 500; color: var(--rail-txt-2);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .menu-pkg-icon { width: 16px; height: 16px; border-radius: 4px; object-fit: cover; flex-shrink: 0; }
    .menu-pkg-icon-svg { display: flex; align-items: center; justify-content: center; overflow: hidden; }
    .menu-pkg-icon-svg :global(svg) { width: 100%; height: 100%; display: block; }

    .menu-item { display: flex; flex-direction: column; }
    .chat-topic-actions {
        display: flex;
        gap: 4px;
        margin-bottom: 4px;
    }
    .new-topic-button {
        box-sizing: border-box;
        padding: 7px 12px;
        text-align: left;
    }
    .acc-header {
        display: flex; align-items: center; gap: 6px; width: 100%;
        padding: 6px 2px; border: none; background: transparent;
        color: var(--rail-txt-2); cursor: pointer;
        -webkit-tap-highlight-color: transparent; transition: color 0.15s;
    }
    .acc-header:hover { color: var(--rail-txt); }
    .acc-label {
        flex: 1; text-align: left; font-family: var(--font-sans, inherit);
        font-size: 12px; font-weight: 500;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .acc-chevron { flex-shrink: 0; transition: transform 0.2s ease; }
    .acc-chevron.acc-open { transform: rotate(180deg); }
    .menu-item-body.acc-hidden { display: none; }
</style>
