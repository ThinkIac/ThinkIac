<script>
    import { createEventDispatcher, tick } from 'svelte';
    import { fade, fly } from 'svelte/transition';
  
    const dispatch = createEventDispatcher();
  
    // ─── Props ────────────────────────────────────────────────────────────────

    /**
     * Array de objetos de configuração de cada etapa do formulário.
     * Aceita também um único objeto (normalizado internamente para array).
     * @type {Object | Object[]}
     */
    export let steps = [];
  
    // ─── Estado interno de navegação e acúmulo ────────────────────────────────
  
    let currentStepIndex = 0;
    let stepResponses = [];       // Acumula os textos de resposta de cada passo
    let submitted = false;        // Trava o componente apenas ao finalizar tudo
    let submitting = false;       // Evita duas resoluções enquanto a rota responde
    let submitError = '';         // Erro assíncrono devolvido pelo handler pai
    
    // Estados temporários do passo atual
    let selected = new Set();     
    let customText = '';          
    let promptText = '';          
    let rating = 0;               
    let hoverRating = 0;          

    // ─── Normalização e Derivação Reativa ─────────────────────────────────────
    
    // Garante que 'steps' sempre seja tratado como uma lista (array)
    $: normalizedSteps = Array.isArray(steps) ? steps : (steps ? [steps] : []);
    $: currentStepConfig = normalizedSteps[currentStepIndex] || {};
    
    // Dados do passo atual mapeados dinamicamente do objeto de configuração
    $: type             = currentStepConfig.type || null;
    $: question         = currentStepConfig.question || '';
    $: options          = currentStepConfig.options || [];
    $: mode             = currentStepConfig.mode || 'single';
    $: allowCustom      = currentStepConfig.allowCustom || false;
    $: minSelect        = currentStepConfig.minSelect || 0;
    $: maxSelect        = currentStepConfig.maxSelect || 0;
    $: placeholder      = currentStepConfig.placeholder || 'Digite aqui…';
    $: confirmLabel     = currentStepConfig.confirmLabel || 'Confirmar';
    $: cancelLabel      = currentStepConfig.cancelLabel || 'Cancel';
    $: destructive      = currentStepConfig.destructive || false;
    $: ratingMax        = currentStepConfig.ratingMax || 5;
    $: escapeLinkLabel  = currentStepConfig.escapeLinkLabel || 'Responder em texto';
    $: promptLabel      = currentStepConfig.promptLabel || '';
    // Ação concreta por trás da confirmação (governança). Sem isso o card vira
    // uma pergunta genérica e o usuário aprova sem saber o que está aprovando.
    $: command          = currentStepConfig.command || null;

    // Reinicia o fluxo caso a propriedade global 'steps' mude do lado de fora
    let previousSteps = null;
    $: if (steps !== previousSteps) {
        previousSteps = steps;
        currentStepIndex = 0;
        submitted = false;
        submitting = false;
        submitError = '';
        stepResponses = [];
        resetCurrentStepInputs();
    }

    // Limpa os inputs de escolha/texto toda vez que mudamos de etapa
    function resetCurrentStepInputs() {
        selected = new Set();
        customText = '';
        promptText = '';
        rating = 0;
        hoverRating = 0;
    }
  
    // ─── Validações Reativas ──────────────────────────────────────────────────
  
    $: tooFew  = mode === 'multi' && minSelect > 0 && selected.size < minSelect;
    $: tooMany = mode === 'multi' && maxSelect > 0 && selected.size > maxSelect;
    $: canConfirmChoice = !tooFew && !tooMany && (selected.size > 0 || (allowCustom && customText.trim()));
    $: canConfirmPrompt = promptText.trim().length > 0;
    $: canConfirmRating = rating > 0;
  
    // ─── Handlers ─────────────────────────────────────────────────────────────
  
    function toggleOption(i) {
        if (submitted || submitting) return;
        if (mode === 'single') {
            selected = new Set([i]);
        } else {
            const next = new Set(selected);
            if (next.has(i)) {
                next.delete(i);
            } else {
                if (maxSelect > 0 && next.size >= maxSelect) return;
                next.add(i);
            }
            selected = next;
        }
    }
  
    function buildChoiceMessage() {
        const parts = [];
        for (const i of [...selected].sort()) {
            parts.push(options[i]);
        }
        if (allowCustom && customText.trim()) parts.push(customText.trim());
        return parts.join('\n');
    }
  
    // Controla o avanço das etapas ou o envio final consolidado
    function fireAndLock(text) {
        if (!text || submitted || submitting) return;
      
        // Salva a resposta do passo atual no histórico
        stepResponses[currentStepIndex] = text;
      
        // Se ainda houverem próximos passos, avança
        if (currentStepIndex < normalizedSteps.length - 1) {
            currentStepIndex += 1;
            resetCurrentStepInputs();
        } else {
            // Chegamos ao fim de todas as etapas!
            // Formata o payload com markdown — quebra de linha dupla entre etapas,
            // separador horizontal entre blocos de pergunta/resposta
            const formattedPayload = stepResponses.map((res, idx) => {
                const stepObj = normalizedSteps[idx];
                const stepPrefix = normalizedSteps.length > 1
                    ? ` (${idx + 1}/${normalizedSteps.length})`
                    : '';
                return `**${stepObj.question}**${stepPrefix}\n\n${res}`;
            }).join('\n\n---\n\n');
          
            // `responses` carrega as respostas cruas de cada etapa. O texto
            // formatado é para exibição; quem precisa comparar a resposta com
            // um label (ex.: governança) deve usar `responses`.
            // Só trava após o backend confirmar a resposta. Isso mantém o
            // formulário utilizável quando a conexão falha durante o clique.
            submitting = true;
            dispatch('send', {
                text: formattedPayload,
                responses: [...stepResponses],
                acknowledge: () => { submitted = true; submitting = false; submitError = ''; },
                reject: (error) => { submitting = false; submitError = error || 'Could not submit the response. Please try again.'; },
            });
        }
    }
  
    function handleChoice() {
        if (!canConfirmChoice || submitted || submitting) return;
        fireAndLock(buildChoiceMessage());
    }
  
    function handlePrompt() {
        if (!canConfirmPrompt || submitted || submitting) return;
        fireAndLock(promptText.trim());
    }
  
    function handleConfirm(value) {
        if (submitted || submitting) return;
        fireAndLock(value === true ? confirmLabel : cancelLabel);
    }
  
    function handleRating() {
        if (!canConfirmRating || submitted || submitting) return;
        fireAndLock(`${rating} de ${ratingMax}`);
    }
  
    function handleEscape() {
        dispatch('escape');
    }
  
    let promptEl;
    $: if (type === 'prompt' && promptEl) tick().then(() => promptEl?.focus());

    // Label do botão de avançar/confirmar
    $: isLastStep = currentStepIndex >= normalizedSteps.length - 1;
    $: advanceLabel = submitted ? 'Submitted' : (isLastStep ? 'Confirm' : 'Next');
    $: advanceLabelPrompt = submitted ? 'Submitted' : (isLastStep ? 'Send' : 'Next');
</script>
  
{#if type !== null}
    <div
        class="si-wrap"
        class:submitted
        in:fly={{ y: 10, duration: 220, delay: 40 }}
        out:fade={{ duration: 120 }}
    >
  
        {#if question}
            <p class="si-question">
                {#if normalizedSteps.length > 1}
                    <span class="si-step-badge">{currentStepIndex + 1}/{normalizedSteps.length}</span>
                {/if}
                {question}
            </p>
        {/if}

        {#if submitError}
            <p class="si-submit-error" role="alert">{submitError}</p>
        {/if}
  
        {#if command}
            <div class="si-command">
                <div class="si-command-head">
                    <span class="si-command-tag">Action</span>
                    <code class="si-command-name">{command.command || command.tool}</code>
                    {#if command.target && command.target !== command.command}
                        <span class="si-command-target">{command.target}</span>
                    {/if}
                </div>
                {#if command.params?.length}
                    <dl class="si-params">
                        {#each command.params as param}
                            <div class="si-param">
                                <dt>{param.name}</dt>
                                <dd><pre>{param.value}</pre></dd>
                            </div>
                        {/each}
                    </dl>
                {:else}
                    <p class="si-params-empty">no parameters</p>
                {/if}
            </div>
        {/if}

        <!-- ── multi_choice ── -->
        {#if type === 'multi_choice'}
            <fieldset class="si-fieldset" disabled={submitted}>
                <legend class="sr-only">{question}</legend>
  
                <div class="si-options">
                    {#each options as opt, i}
                        {@const checked = selected.has(i)}
                        <button
                            type="button"
                            class="si-option"
                            class:checked
                            on:click={() => toggleOption(i)}
                            aria-pressed={checked}
                        >
                            <span class="si-checkbox" aria-hidden="true">
                                {#if mode === 'single'}
                                    <span class="si-radio-outer">
                                        {#if checked}
                                            <span class="si-radio-inner" in:fade={{ duration: 120 }}></span>
                                        {/if}
                                    </span>
                                {:else}
                                    <span class="si-cb-outer">
                                        {#if checked}
                                            <svg class="si-tick" in:fade={{ duration: 100 }} viewBox="0 0 10 8" fill="none">
                                                <path d="M1 4l3 3 5-6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                                            </svg>
                                        {/if}
                                    </span>
                                {/if}
                            </span>
                            <span class="si-opt-label">{opt}</span>
                        </button>
                    {/each}
  
                    {#if allowCustom}
                        <div class="si-custom-row" class:active={customText.trim().length > 0}>
                            <span class="si-cb-outer si-cb-custom" aria-hidden="true">
                                {#if customText.trim()}
                                    <svg class="si-tick" viewBox="0 0 10 8" fill="none">
                                        <path d="M1 4l3 3 5-6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                                    </svg>
                                {/if}
                            </span>
                            <input
                                class="si-custom-input"
                                type="text"
                                placeholder="Enter your response…"
                                bind:value={customText}
                                disabled={submitted}
                            />
                        </div>
                    {/if}
                </div>
  
                {#if mode === 'multi' && (minSelect > 0 || maxSelect > 0)}
                    <p class="si-hint">
                        {#if minSelect > 0 && maxSelect > 0}
                            Selecione entre {minSelect} e {maxSelect}
                        {:else if minSelect > 0}
                            Selecione pelo menos {minSelect}
                        {:else}
                            Selecione até {maxSelect}
                        {/if}
                        · {selected.size} selecionado{selected.size !== 1 ? 's' : ''}
                    </p>
                {/if}
            </fieldset>
  
            <div class="si-actions">
                <button
                    class="si-btn si-btn-primary"
                    disabled={!canConfirmChoice || submitted}
                    on:click={handleChoice}
                >
                    {advanceLabel}
                </button>
                {#if !submitted}
                    <button class="si-escape" on:click={handleEscape}>{escapeLinkLabel}</button>
                {/if}
            </div>
  
        <!-- ── prompt ── -->
        {:else if type === 'prompt'}
            {#if promptLabel}
                <p class="si-prompt-label">{promptLabel}</p>
            {/if}
  
            <textarea
                bind:this={promptEl}
                bind:value={promptText}
                class="si-textarea"
                {placeholder}
                rows="3"
                disabled={submitted}
                on:keydown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handlePrompt();
                    }
                }}
            ></textarea>
  
            <div class="si-actions">
                <button
                    class="si-btn si-btn-primary"
                    disabled={!canConfirmPrompt || submitted}
                    on:click={handlePrompt}
                >
                    {advanceLabelPrompt}
                </button>
                {#if !submitted}
                    <button class="si-escape" on:click={handleEscape}>{escapeLinkLabel}</button>
                {/if}
            </div>
  
        <!-- ── confirm ── -->
        {:else if type === 'confirm'}
            <div class="si-confirm-btns">
                <button
                    class="si-btn si-btn-primary"
                    class:si-btn-destructive={destructive}
                    disabled={submitted}
                    on:click={() => handleConfirm(true)}
                >
                    {confirmLabel}
                </button>
                <button
                    class="si-btn si-btn-ghost"
                    disabled={submitted}
                    on:click={() => handleConfirm(false)}
                >
                    {cancelLabel}
                </button>
            </div>
            {#if !submitted}
                <div class="si-actions si-actions-center">
                    <button class="si-escape" on:click={handleEscape}>{escapeLinkLabel}</button>
                </div>
            {/if}
  
        <!-- ── rating ── -->
        {:else if type === 'rating'}
            <div
                class="si-rating"
                on:mouseleave={() => { hoverRating = 0; }}
                role="group"
                aria-label="Rating from 1 to {ratingMax}"
            >
                {#each Array(ratingMax) as _, i}
                    {@const val = i + 1}
                    {@const active = (hoverRating || rating) >= val}
                    <button
                        type="button"
                        class="si-star"
                        class:active
                        aria-label="Give {val} stars"
                        disabled={submitted}
                        on:mouseenter={() => { hoverRating = val; }}
                        on:click={() => { rating = val; }}
                    >
                        <svg viewBox="0 0 18 18" fill="none">
                            <path
                                d="M9 1.5l2.27 4.6 5.08.74-3.68 3.58.87 5.08L9 13l-4.54 2.5.87-5.08L1.65 6.84l5.08-.74z"
                                stroke="currentColor"
                                stroke-width="1.4"
                                stroke-linejoin="round"
                                fill={active ? 'currentColor' : 'none'}
                            />
                        </svg>
                    </button>
                {/each}
            </div>
  
            {#if rating > 0}
                <p class="si-rating-label" in:fade={{ duration: 150 }}>
                    {rating} de {ratingMax}
                </p>
            {/if}
  
            <div class="si-actions">
                <button
                    class="si-btn si-btn-primary"
                    disabled={!canConfirmRating || submitted}
                    on:click={handleRating}
                >
                    {advanceLabel}
                </button>
                {#if !submitted}
                    <button class="si-escape" on:click={handleEscape}>{escapeLinkLabel}</button>
                {/if}
            </div>
        {/if}
  
    </div>
{/if}
  
<style>
    .si-wrap {
        max-width: 760px;
        margin: 0 auto;
        margin-bottom: 12px;
        padding: 4px 24px 6px;
        width: 100%;
    }
    .si-wrap.submitted {
        opacity: 0.5;
        pointer-events: none;
    }

    /* ── Question ── */
    .si-question {
        font-family: var(--font-body);
        font-size: 13px;
        color: var(--txt-2);
        margin: 0 0 12px 0;
        line-height: 1.5;
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .si-submit-error {
        margin: -2px 0 2px;
        color: var(--danger, #d44);
        font-size: 0.84rem;
    }
    .si-step-badge {
        font-family: var(--font-mono);
        font-size: 10px;
        background: var(--w08, rgba(255, 255, 255, 0.08));
        color: var(--txt-3);
        padding: 2px 6px;
        border-radius: 4px;
        border: 1px solid var(--border);
        font-weight: 600;
        flex-shrink: 0;
    }

    /* ── Command (governança) ── */
    .si-command {
        border: 1px solid var(--border);
        border-radius: 10px;
        background: var(--surface);
        padding: 10px 12px;
        margin-bottom: 12px;
    }
    .si-command-head {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 8px;
    }
    .si-command-tag {
        font-family: var(--font-mono);
        font-size: 9px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--txt-3);
        border: 1px solid var(--border);
        border-radius: 4px;
        padding: 2px 5px;
    }
    .si-command-name {
        font-family: var(--font-mono);
        font-size: 12.5px;
        color: var(--txt);
        word-break: break-all;
    }
    .si-command-target {
        font-family: var(--font-mono);
        font-size: 10.5px;
        color: var(--txt-3);
    }
    .si-params {
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .si-param {
        display: grid;
        grid-template-columns: minmax(70px, 22%) 1fr;
        gap: 10px;
        align-items: start;
    }
    .si-param dt {
        font-family: var(--font-mono);
        font-size: 11px;
        color: var(--txt-3);
        word-break: break-all;
    }
    .si-param dd {
        margin: 0;
        min-width: 0;
    }
    .si-param dd pre {
        margin: 0;
        font-family: var(--font-mono);
        font-size: 11.5px;
        color: var(--txt-2);
        white-space: pre-wrap;
        word-break: break-word;
        max-height: 160px;
        overflow: auto;
    }
    .si-params-empty {
        margin: 0;
        font-family: var(--font-mono);
        font-size: 10.5px;
        color: var(--txt-3);
    }

    /* ── Fieldset ── */
    .si-fieldset {
        border: none;
        padding: 0;
        margin: 0;
    }
    .si-fieldset:disabled {
        pointer-events: none;
    }
    .si-options {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    /* ── Options ── */
    .si-option {
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 8px 10px;
        border-radius: 8px;
        border: 1px solid var(--border);
        background: transparent;
        color: var(--txt-2);
        font-family: var(--font-body);
        font-size: 13px;
        cursor: pointer;
        text-align: left;
        transition: background 0.15s, border-color 0.15s, color 0.15s;
    }
    .si-option:hover:not(:disabled) {
        background: var(--w04, rgba(255, 255, 255, 0.04));
        border-color: var(--w15, rgba(255, 255, 255, 0.15));
        color: var(--txt);
    }
    .si-option.checked {
        background: var(--w06, rgba(255, 255, 255, 0.06));
        border-color: var(--w22, rgba(255, 255, 255, 0.22));
        color: var(--txt);
    }
    .si-opt-label {
        flex: 1;
    }

    /* ── Radio ── */
    .si-radio-outer {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        border: 1.5px solid var(--border);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition: border-color 0.15s;
    }
    .si-option.checked .si-radio-outer {
        border-color: var(--w50, rgba(255, 255, 255, 0.5));
    }
    .si-radio-inner {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--txt);
    }

    /* ── Checkbox ── */
    .si-cb-outer {
        width: 14px;
        height: 14px;
        border-radius: 3px;
        border: 1.5px solid var(--border);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition: border-color 0.15s, background 0.15s;
    }
    .si-option.checked .si-cb-outer {
        border-color: var(--w45, rgba(255, 255, 255, 0.45));
        background: var(--w10, rgba(255, 255, 255, 0.1));
    }
    .si-tick {
        width: 9px;
        height: 9px;
        color: var(--txt);
    }

    /* ── Custom input ── */
    .si-custom-row {
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 8px 10px;
        border-radius: 8px;
        border: 1px solid var(--border);
        background: transparent;
        transition: border-color 0.15s;
    }
    .si-custom-row.active {
        border-color: var(--w22, rgba(255, 255, 255, 0.22));
    }
    .si-cb-custom {
        color: var(--txt);
    }
    .si-custom-input {
        flex: 1;
        background: transparent;
        border: none;
        outline: none;
        font-family: var(--font-body);
        font-size: 13px;
        color: var(--txt);
    }
    .si-custom-input::placeholder {
        color: var(--txt-3);
    }

    /* ── Hint ── */
    .si-hint {
        margin: 6px 2px 0;
        font-family: var(--font-mono);
        font-size: 10px;
        color: var(--txt-3);
        letter-spacing: 0.03em;
    }

    /* ── Prompt ── */
    .si-prompt-label {
        font-family: var(--font-mono);
        font-size: 10px;
        color: var(--txt-3);
        letter-spacing: 0.04em;
        text-transform: uppercase;
        margin: 0 0 5px 2px;
    }
    .si-textarea {
        width: 100%;
        box-sizing: border-box;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 10px 12px;
        font-family: var(--font-body);
        font-size: 13px;
        color: var(--txt);
        resize: vertical;
        outline: none;
        line-height: 1.55;
        transition: border-color 0.2s;
    }
    .si-textarea:focus {
        border-color: var(--w20, rgba(255, 255, 255, 0.2));
    }
    .si-textarea::placeholder {
        color: var(--txt-3);
    }

    /* ── Confirm ── */
    .si-confirm-btns {
        display: flex;
        gap: 6px;
    }

    /* ── Rating ── */
    .si-rating {
        display: flex;
        gap: 2px;
        margin-bottom: 6px;
    }
    .si-star {
        width: 30px;
        height: 30px;
        background: transparent;
        border: none;
        color: var(--w18, rgba(255, 255, 255, 0.18));
        cursor: pointer;
        padding: 4px;
        border-radius: 4px;
        transition: color 0.12s, transform 0.1s;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .si-star:hover:not(:disabled),
    .si-star.active {
        color: rgba(255, 220, 80, 0.85);
    }
    .si-star:hover:not(:disabled) {
        transform: scale(1.15);
    }
    .si-star:disabled {
        cursor: not-allowed;
    }
    .si-star svg {
        width: 18px;
        height: 18px;
    }
    .si-rating-label {
        font-family: var(--font-mono);
        font-size: 10px;
        color: var(--txt-3);
        margin: 0 0 4px 2px;
        letter-spacing: 0.04em;
    }

    /* ── Actions ── */
    .si-actions {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-top: 8px;
    }
    .si-actions-center {
        justify-content: center;
        margin-top: 4px;
    }

    /* ── Buttons ── */
    .si-btn {
        padding: 6px 16px;
        border-radius: 20px;
        font-family: var(--font-body);
        font-size: 12px;
        cursor: pointer;
        transition: background 0.15s, opacity 0.15s, transform 0.1s;
        border: 1px solid transparent;
        letter-spacing: 0.02em;
    }
    .si-btn:active:not(:disabled) {
        transform: scale(0.96);
    }
    .si-btn:disabled {
        opacity: 0.25;
        cursor: not-allowed;
    }
    .si-btn-primary {
        background: var(--w10, rgba(255, 255, 255, 0.1));
        border-color: var(--w18, rgba(255, 255, 255, 0.18));
        color: var(--txt);
    }
    .si-btn-primary:hover:not(:disabled) {
        background: var(--w15, rgba(255, 255, 255, 0.16));
    }
    .si-btn-destructive {
        background: rgba(220, 60, 60, 0.18) !important;
        border-color: rgba(220, 60, 60, 0.35) !important;
        color: rgba(255, 130, 130, 0.95) !important;
    }
    .si-btn-destructive:hover:not(:disabled) {
        background: rgba(220, 60, 60, 0.28) !important;
    }
    .si-btn-ghost {
        background: transparent;
        border-color: var(--border);
        color: var(--txt-2);
    }
    .si-btn-ghost:hover:not(:disabled) {
        background: var(--w04, rgba(255, 255, 255, 0.04));
        color: var(--txt);
    }

    /* ── Escape link ── */
    .si-escape {
        background: none;
        border: none;
        font-family: var(--font-mono);
        font-size: 10px;
        color: var(--txt-3);
        cursor: pointer;
        letter-spacing: 0.03em;
        padding: 0;
        text-decoration: underline;
        text-underline-offset: 2px;
        text-decoration-color: transparent;
        transition: color 0.15s, text-decoration-color 0.15s;
    }
    .si-escape:hover {
        color: var(--txt-2);
        text-decoration-color: var(--txt-3);
    }

    /* ── Accessibility ── */
    .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
    }

    /* ── Mobile ── */
    @media (max-width: 767px) {
        .si-wrap {
            padding: 4px 16px 6px;
        }
        .si-option {
            font-size: 14px;
            padding: 10px 12px;
        }
        .si-textarea {
            font-size: 14px;
        }
    }
</style>
