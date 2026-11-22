<script>
    import Canvas from '../../Canvas.svelte';
    import NtfyInbox from '../NtfyInbox.svelte';
    import Dialogs from '../../../../ui-dialogs/views/components/Dialogs.svelte';
    import ModalSheet from '../../../../ui-dialogs/views/components/ModalSheet.svelte';
    export let canvasHtml;
    export let appInfoTarget;
    export let appInfoOpen;
    export let closeAppInfo;
    export let appInfoIcon;
    export let appInfoInitials;
    export let appInfoDetails;
    export let copyActiveSessionId;
    export let chatMenuMessage;
    export let sessionId;
    export let formatChatNumber;
    export let chatInfoMessages;
    export let chatInfoUsage;
    export let chatInfoTotalTokens;
    export let formatChatCost;
    export let bagLoading;
    export let bagError;
    export let bagStatus;
    export let bagStepLabel;
    export let canvasOpen;
    export let notificationCenterOpen;
    export let notificationCount;
    export let statusModal;
    export let chatInfoOpen;
    export let bagSheetOpen;
</script>

    <Canvas
        html={canvasHtml}
        open={canvasOpen}
        on:close={() => (canvasOpen = false)}
    />

    <NtfyInbox bind:centerOpen={notificationCenterOpen} on:count={(event) => (notificationCount = event.detail.count)} />

    {#if statusModal}
        <div class="status-modal-backdrop" role="presentation" on:click={() => (statusModal = null)}>
            <section class="status-modal" role="dialog" aria-modal="true" aria-label={statusModal.label} on:click|stopPropagation>
                <header>
                    <h2>{statusModal.label}</h2>
                    <button type="button" aria-label="Close {statusModal.label}" on:click={() => (statusModal = null)}>×</button>
                </header>
                <iframe src={statusModal.url} title={statusModal.label} sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"></iframe>
            </section>
        </div>
    {/if}

    {#if appInfoTarget}
        <ModalSheet open={appInfoOpen} centered label="Package information" on:close={closeAppInfo}>
                <div class="app-info-hero">
                    <div class="app-info-icon" aria-hidden="true">
                        {#if appInfoIcon?.kind === "svg"}
                            <span class="app-info-icon-svg">{@html appInfoIcon.value}</span>
                        {:else if appInfoIcon?.kind === "image"}
                            <img src={appInfoIcon.value} alt="" />
                        {:else}
                            <span class="app-info-initials">{appInfoInitials}</span>
                        {/if}
                    </div>
                    <div>
                        <p class="app-info-eyebrow">Package information</p>
                        <h2 id="app-info-title">{appInfoTarget.name || appInfoTarget.packageName || "Application"}</h2>
                        {#if appInfoTarget.version}<p class="app-info-version">Version {appInfoTarget.version}</p>{/if}
                    </div>
                </div>
                <div class="app-info-details" aria-label="Package details">
                    {#each appInfoDetails as detail}
                        <div class="app-info-row"><dt>{detail.label}</dt><dd>{detail.value}</dd></div>
                    {/each}
                </div>
        </ModalSheet>
    {/if}

    <ModalSheet open={chatInfoOpen} centered label="Chat information" on:close={() => (chatInfoOpen = false)}>
        <div class="app-info-hero">
            <div class="app-info-icon chat-info-icon" aria-hidden="true">Σ</div>
            <div><p class="app-info-eyebrow">Chat information</p><h2>Current conversation</h2></div>
        </div>
        <div class="app-info-details" aria-label="Chat details">
            <div class="app-info-row"><dt>Identifier</dt><dd><button type="button" class="chat-info-identifier" on:click={copyActiveSessionId} title="Copy identifier">{chatMenuMessage || sessionId}</button></dd></div>
            <div class="app-info-row"><dt>Context</dt><dd>{formatChatNumber(chatInfoMessages)} messages</dd></div>
            <div class="app-info-row"><dt>Input tokens</dt><dd>{formatChatNumber(chatInfoUsage.prompt)}</dd></div>
            <div class="app-info-row"><dt>Output tokens</dt><dd>{formatChatNumber(chatInfoUsage.completion)}</dd></div>
            <div class="app-info-row"><dt>Total usage</dt><dd>{formatChatNumber(chatInfoTotalTokens)} tokens</dd></div>
            <div class="app-info-row"><dt>Cost</dt><dd>{formatChatCost(chatInfoUsage.cost)}</dd></div>
        </div>
    </ModalSheet>

    <ModalSheet open={bagSheetOpen} centered label="Session bag" on:close={() => (bagSheetOpen = false)}>
        <div class="app-info-hero">
            <div class="app-info-icon chat-info-icon" aria-hidden="true">□</div>
            <div><p class="app-info-eyebrow">Session bag</p><h2>Plan and progress</h2></div>
        </div>
        {#if bagLoading}
            <p class="bag-sheet-message">Loading plan…</p>
        {:else if bagError}
            <p class="bag-sheet-message bag-sheet-error">{bagError}</p>
        {:else if !bagStatus}
            <p class="bag-sheet-message">No plan has been created for this conversation.</p>
        {:else}
            <div class="bag-sheet-summary">
                <p>{bagStatus.objective}</p>
                <span>{bagStatus.status === "done" ? "Complete" : "In progress"} · {bagStatus.steps?.filter((step) => step.status === "done" || step.status === "skipped").length ?? 0}/{bagStatus.steps?.length ?? 0} steps</span>
            </div>
            {#if bagStatus.steps?.length}
                <ol class="bag-sheet-steps" aria-label="Plan steps">
                    {#each bagStatus.steps as step (step.seq)}
                        <li class:done={step.status === "done" || step.status === "skipped"} class:failed={step.status === "failed"}>
                            <span class="bag-step-state">{step.seq}</span>
                            <span><strong>{step.description}</strong><small>{bagStepLabel(step.status)}{step.result ? ` · ${step.result}` : ""}</small></span>
                        </li>
                    {/each}
                </ol>
            {/if}
        {/if}
    </ModalSheet>

    <!-- Pai direto dos apps em abas: recebe os pedidos postMessage deles. -->
    <Dialogs host={true} />

<style>
    .status-modal-backdrop { position: fixed; inset: 0; z-index: 2147483645; display: grid; place-items: center; padding: 2rem; background: color-mix(in srgb, var(--tk-bg) 74%, transparent); }
    .status-modal { display: flex; width: min(100%, 58rem); height: min(78dvh, 46rem); flex-direction: column; overflow: hidden; border: 1px solid var(--tk-border); border-radius: var(--tk-radius-lg); background: var(--tk-surface); box-shadow: 0 2px 8px rgba(0,0,0,.08); }
    .status-modal header { display: flex; align-items: center; justify-content: space-between; min-height: 2.75rem; padding: 0 .75rem 0 1rem; border-bottom: 1px solid var(--tk-border); color: var(--tk-text); }
    .status-modal h2 { margin: 0; font-size: .875rem; font-weight: 600; }.status-modal button { width: 2rem; height: 2rem; border: 0; border-radius: var(--tk-radius-md); background: transparent; color: var(--tk-text); font-size: 1.25rem; cursor: pointer; }.status-modal button:hover, .status-modal button:focus-visible { background: var(--tk-surface-2); outline: none; }.status-modal iframe { min-height: 0; flex: 1; border: 0; }
    .app-info-backdrop { position: fixed; inset: 0; z-index: 2147483646; display: grid; place-items: center; padding: 1rem; background: color-mix(in srgb, var(--tk-bg) 78%, transparent); backdrop-filter: blur(14px); }
    .app-info-modal { position: relative; width: min(100%, 23rem); max-height: calc(100dvh - 2rem); overflow: auto; border: 1px solid color-mix(in srgb, var(--tk-border) 72%, transparent); border-radius: 1.1rem; padding: 1.15rem; background: color-mix(in srgb, var(--tk-surface) 96%, transparent); color: var(--tk-text); box-shadow: 0 1.2rem 3.5rem color-mix(in srgb, var(--tk-bg) 65%, transparent); outline: none; }
    .app-info-close { position: absolute; top: .55rem; right: .55rem; width: 1.8rem; height: 1.8rem; border: 0; border-radius: 999px; background: transparent; color: var(--tk-text-muted, var(--tk-text)); font: 400 1.15rem/1 system-ui; cursor: pointer; }
    .app-info-hero { display: flex; align-items: center; gap: .85rem; padding-right: 1.75rem; }
    .app-info-icon { display: grid; width: 3.8rem; height: 3.8rem; flex: 0 0 auto; place-items: center; overflow: hidden; border: 1px solid color-mix(in srgb, var(--tk-border) 60%, transparent); border-radius: .95rem; background: linear-gradient(145deg, var(--tk-surface-2), var(--tk-surface)); box-shadow: 0 .45rem 1rem color-mix(in srgb, var(--tk-bg) 32%, transparent); }
    .app-info-icon img, .app-info-icon-svg, .app-info-icon-svg :global(svg) { display: block; width: 100%; height: 100%; object-fit: cover; }
    .app-info-initials { font-size: 1.25rem; font-weight: 720; letter-spacing: -.04em; color: var(--tk-text); }
    .app-info-eyebrow { margin: 0 0 .18rem; color: var(--tk-text-muted, var(--tk-text)); font-size: .62rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    .app-info-modal h2 { margin: 0; font-size: 1.15rem; letter-spacing: -.025em; }
    .app-info-version { margin: .18rem 0 0; color: var(--tk-text-muted, var(--tk-text)); font-size: .74rem; }
    .app-info-description { margin: .85rem 0 0; color: var(--tk-text-muted, var(--tk-text)); font-size: .82rem; line-height: 1.42; }
    .app-info-details { display: grid; margin-top: .9rem; overflow: hidden; border: 1px solid color-mix(in srgb, var(--tk-border) 70%, transparent); border-radius: .7rem; background: color-mix(in srgb, var(--tk-surface-2) 58%, transparent); }
    .app-info-row { display: grid; grid-template-columns: minmax(4.8rem, .72fr) minmax(0, 1.28fr); gap: .65rem; padding: .5rem .65rem; border-bottom: 1px solid color-mix(in srgb, var(--tk-border) 55%, transparent); }
    .app-info-row:last-child { border-bottom: 0; }
    .app-info-row dt { color: var(--tk-text-muted, var(--tk-text)); font-size: .69rem; font-weight: 600; }
    .app-info-row dd { min-width: 0; margin: 0; overflow-wrap: anywhere; color: var(--tk-text); font-size: .69rem; text-align: right; }
    .chat-info-icon { color: var(--tk-accent, var(--tk-text)); font-size: 1.25rem; }
    .chat-info-identifier { max-width: 100%; border: 0; padding: 0; background: transparent; color: inherit; font: inherit; text-align: right; text-decoration: underline; cursor: copy; overflow-wrap: anywhere; }
    .bag-sheet-message { margin: 1rem 0 0; color: var(--tk-text-muted, var(--tk-text)); font-size: .82rem; line-height: 1.45; }
    .bag-sheet-error { color: var(--tk-danger, #d14d4d); }
    .bag-sheet-summary { display: grid; gap: .35rem; margin-top: .9rem; padding: .7rem; border: 1px solid color-mix(in srgb, var(--tk-border) 70%, transparent); border-radius: .7rem; background: color-mix(in srgb, var(--tk-surface-2) 58%, transparent); }
    .bag-sheet-summary p { margin: 0; color: var(--tk-text); font-size: .84rem; font-weight: 600; line-height: 1.4; }
    .bag-sheet-summary span, .bag-sheet-steps small { color: var(--tk-text-muted, var(--tk-text)); font-size: .7rem; }
    .bag-sheet-steps { display: grid; gap: .5rem; margin: .8rem 0 0; padding: 0; list-style: none; }
    .bag-sheet-steps li { display: grid; grid-template-columns: 1.5rem minmax(0, 1fr); gap: .55rem; align-items: start; padding: .5rem; border: 1px solid color-mix(in srgb, var(--tk-border) 58%, transparent); border-radius: .65rem; }
    .bag-sheet-steps li.done { opacity: .7; }.bag-sheet-steps li.failed { border-color: color-mix(in srgb, var(--tk-danger, #d14d4d) 60%, var(--tk-border)); }
    .bag-step-state { display: grid; width: 1.5rem; height: 1.5rem; place-items: center; border-radius: 999px; background: var(--tk-surface-2); color: var(--tk-text-muted, var(--tk-text)); font-size: .68rem; font-weight: 700; }
    .bag-sheet-steps strong, .bag-sheet-steps small { display: block; }.bag-sheet-steps strong { color: var(--tk-text); font-size: .76rem; line-height: 1.35; }.bag-sheet-steps small { margin-top: .12rem; line-height: 1.35; }
</style>
