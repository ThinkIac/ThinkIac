<script>
    // ProfileSwitcher — a faixa de perfis de configuração, no topo do modo
    // edição do menu (ver MenuList). Cada perfil é um conjunto salvo de
    // configurações: ordem/visibilidade do menu, da InputBar e o tema.
    //
    // Segue a regra que a Reforma dos Menus estabeleceu: controle de
    // configuração só aparece com a engrenagem ligada — em uso normal a faixa
    // não existe. Trocar de perfil aplica na hora; não há botão de salvar
    // porque o perfil ativo já espelha a tela (ver profiles_bootstrap).
    import {
        profiles,
        activeProfileId,
        switchProfile,
        createProfile,
        duplicateProfile,
        renameProfile,
        deleteProfile,
    } from "./lib/profiles_bootstrap.js";

    let criando = false;
    let nomeNovo = "";
    let renomeandoId = null;

    function abrirCriacao() {
        criando = true;
        nomeNovo = "";
    }

    function confirmarCriacao() {
        const nome = nomeNovo.trim();
        if (nome) createProfile(nome);
        criando = false;
        nomeNovo = "";
    }

    function teclaCriacao(e) {
        if (e.key === "Enter") confirmarCriacao();
        else if (e.key === "Escape") criando = false;
    }

    function confirmarRename(id, e) {
        renameProfile(id, e.target.value);
        renomeandoId = null;
    }

    function teclaRename(e) {
        if (e.key === "Enter") e.target.blur();
        else if (e.key === "Escape") renomeandoId = null;
    }

    // Excluir só é oferecido quando sobra alguém para assumir — o registry
    // recusa apagar o último perfil (ficaria sem onde gravar as mudanças).
    $: podeExcluir = $profiles.length > 1;
</script>

<div class="profiles">
    <span class="profiles-title">Profiles</span>

    <div class="profiles-row">
        {#each $profiles as p (p.id)}
            <div class="pchip" class:active={p.id === $activeProfileId}>
                {#if renomeandoId === p.id}
                    <!-- svelte-ignore a11y-autofocus -->
                    <input
                        class="pchip-input"
                        value={p.name}
                        autofocus
                        on:blur={(e) => confirmarRename(p.id, e)}
                        on:keydown={teclaRename}
                        aria-label="Profile name"
                    />
                {:else}
                    <button
                        class="pchip-name"
                        on:click={() => switchProfile(p.id)}
                        on:dblclick={() => (renomeandoId = p.id)}
                        title={p.id === $activeProfileId ? "Active profile — double-click to rename" : `Switch to ${p.name}`}
                        aria-pressed={p.id === $activeProfileId}
                    >
                        {p.name}
                    </button>
                    <button
                        class="pchip-act"
                        on:click={() => duplicateProfile(p.id)}
                        aria-label={`Duplicate ${p.name}`}
                        title="Duplicate"
                    >
                        <svg viewBox="0 0 16 16" fill="none" width="11" height="11">
                            <rect x="5.4" y="5.4" width="8.2" height="8.2" rx="1.8" stroke="currentColor" stroke-width="1.3"/>
                            <path d="M10.6 5.4V4.2A1.8 1.8 0 008.8 2.4H4.2a1.8 1.8 0 00-1.8 1.8v4.6a1.8 1.8 0 001.8 1.8h1.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                        </svg>
                    </button>
                    {#if podeExcluir}
                        <button
                            class="pchip-act"
                            on:click={() => deleteProfile(p.id)}
                            aria-label={`Delete ${p.name}`}
                            title="Delete"
                        >
                            <svg viewBox="0 0 16 16" fill="none" width="11" height="11">
                                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                            </svg>
                        </button>
                    {/if}
                {/if}
            </div>
        {/each}

        {#if criando}
            <!-- svelte-ignore a11y-autofocus -->
            <input
                class="pchip-input new"
                placeholder="Profile name"
                bind:value={nomeNovo}
                autofocus
                on:blur={confirmarCriacao}
                on:keydown={teclaCriacao}
                aria-label="New profile name"
            />
        {:else}
            <button class="pchip-new" on:click={abrirCriacao} title="New profile from the current setup">
                <svg viewBox="0 0 16 16" fill="none" width="11" height="11">
                    <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                </svg>
                New
            </button>
        {/if}
    </div>
</div>

<style>
    /* Faixa chapada, no espírito da faixa de "Desativados" logo abaixo:
       o container não flutua, só os chips têm presença. */
    .profiles {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding-bottom: 10px;
        margin-bottom: 2px;
        border-bottom: 1px solid var(--rail-border);
    }
    .profiles-title {
        font-size: 9px;
        font-weight: 600;
        letter-spacing: 0.13em;
        text-transform: uppercase;
        color: var(--rail-txt-3);
    }
    .profiles-row {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
    }

    .pchip {
        display: flex;
        align-items: center;
        gap: 2px;
        max-width: 100%;
        padding: 2px 4px 2px 2px;
        border: 1px solid var(--rail-border);
        border-radius: 8px;
        background: var(--rail-flat);
        color: var(--rail-txt-2);
        transition: border-color 0.15s, color 0.15s, background 0.15s;
    }
    .pchip:hover { border-color: var(--rail-border-hi); color: var(--rail-txt); }
    .pchip.active {
        border-color: var(--rail-active-ring);
        background: var(--rail-active);
        color: var(--rail-txt);
    }

    .pchip-name {
        max-width: 130px;
        overflow: hidden;
        padding: 4px 6px;
        border: none;
        background: transparent;
        color: inherit;
        font-family: inherit;
        font-size: 11px;
        font-weight: 500;
        text-overflow: ellipsis;
        white-space: nowrap;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
    }
    .pchip.active .pchip-name { font-weight: 600; }

    .pchip-act {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        flex-shrink: 0;
        border: none;
        border-radius: 5px;
        background: transparent;
        color: var(--rail-txt-3);
        cursor: pointer;
        opacity: 0.75;
        transition: color 0.15s, background 0.15s, opacity 0.15s;
        -webkit-tap-highlight-color: transparent;
    }
    .pchip-act:hover {
        color: var(--rail-txt);
        background: var(--rail-flat-hover);
        opacity: 1;
    }

    .pchip-input {
        width: 120px;
        padding: 4px 6px;
        border: 1px solid var(--rail-border-hi);
        border-radius: 7px;
        background: transparent;
        color: var(--rail-txt);
        font-family: inherit;
        font-size: 11px;
        outline: none;
    }
    .pchip-input.new { border-radius: 8px; }

    .pchip-new {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 5px 8px;
        border: 1px dashed var(--rail-border-hi);
        border-radius: 8px;
        background: transparent;
        color: var(--rail-txt-3);
        font-family: inherit;
        font-size: 10px;
        font-weight: 600;
        cursor: pointer;
        transition: color 0.15s, border-color 0.15s;
        -webkit-tap-highlight-color: transparent;
    }
    .pchip-new:hover { color: var(--rail-txt); border-color: var(--rail-txt-3); }
</style>
