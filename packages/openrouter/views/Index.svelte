<script>
  // OpenRouter provider config. OpenRouter is an OpenAI-compatible API: a
  // single static API key (Bearer) unlocks hundreds of models addressed as
  // `provider/model`. See packages/openrouter/index.js and, for execution,
  // agent/llm/llm_keys.js (PROVIDER_DEFS.openrouter) + the default HTTP path
  // in agent/llm/llm.js.
  // Visual: Agent's "Slate" design system (see agent/DESIGN.md) — flat
  // ground, achromatic, object elevation via a soft double shadow, English UI.
  // Runs in its own iframe (its own document), so it can't inherit the shell's
  // .shell tokens — it reads localStorage['agent:theme'] itself and stays in
  // sync via 'storage' events, per apps/thinkiac/AGENTS.md.
  import { onMount, onDestroy } from 'svelte'
  import * as api from './lib/api.js'
  import { getTheme, onThemeChange } from './lib/theme.js'

  let theme = getTheme()
  let offTheme = null

  let status = null
  let loading = true
  let error = null

  // Popular models — OpenRouter has hundreds, so this is a convenience list
  // for a free-text field (any `provider/model` id works), not a hard menu.
  const MODELS = [
    'anthropic/claude-sonnet-4.5',
    'anthropic/claude-opus-4.1',
    'openai/gpt-4o',
    'openai/gpt-4o-mini',
    'google/gemini-2.5-pro',
    'google/gemini-2.5-flash',
    'deepseek/deepseek-chat',
    'meta-llama/llama-3.3-70b-instruct',
    'moonshotai/kimi-k2',
    'x-ai/grok-4',
  ]

  // Key card: collapses to a one-line summary once a key is saved, so it
  // doesn't reopen the form on every visit. "Edit" reveals it.
  let editingKey = false

  let apiKeyInput = ''
  let modelInput = 'anthropic/claude-sonnet-4.5'
  let models = []
  let modelDraft = ''
  let savingModels = false
  let saving = false
  let saveMsg = null

  let toggling = false

  let testing = false
  let testResult = null
  let testError = null

  onDestroy(() => offTheme?.())

  async function load() {
    loading = true
    error = null
    try {
      status = await api.getStatus()
      if (status?.model) modelInput = status.model
      models = status?.models?.length ? status.models : (status?.model ? [{ id: status.model }] : [])
    } catch (e) {
      error = e.message
    } finally {
      loading = false
    }
  }

  // OpenRouter keys look like "sk-or-v1-…" — reject a botched paste up front
  // (mirrors the server-side check) so the form gives instant feedback instead
  // of a round-trip.
  function looksLikeKey(s) {
    return /^sk-or-[A-Za-z0-9._-]+$/.test(s)
  }

  async function save() {
    const key = apiKeyInput.trim()
    if (!key) return
    if (!looksLikeKey(key)) {
      error = 'Isso não parece uma chave do OpenRouter — ela começa com "sk-or-". Pegue em openrouter.ai/keys.'
      return
    }
    saving = true
    saveMsg = null
    error = null
    try {
      const payload = { api_key: key }
      if (modelInput.trim()) payload.model = modelInput.trim()
      const res = await api.saveKey(payload)
      status = res.status
      apiKeyInput = ''
      editingKey = false
      saveMsg = status?.enabled ? 'Key saved — provider enabled.' : 'Key saved.'
      setTimeout(() => (saveMsg = null), 4000)
      runTest() // valida chave + modelo na hora
    } catch (e) {
      error = e.message
    } finally {
      saving = false
    }
  }

  async function saveModels(nextModels, defaultModel = status?.model) {
    const ids = nextModels.map(item => typeof item === 'string' ? item : item?.id).map(id => id?.trim()).filter(Boolean)
    if (!ids.length) {
      error = 'Keep at least one model in the catalog.'
      return
    }
    savingModels = true
    error = null
    try {
      const res = await api.setModels(ids, defaultModel)
      status = res.status
      models = status.models
      modelInput = status.model
    } catch (e) {
      error = e.message
    } finally {
      savingModels = false
    }
  }

  async function addModel() {
    const id = modelDraft.trim()
    if (!id) return
    if (models.some(item => item.id === id)) {
      error = 'That model is already in the catalog.'
      return
    }
    await saveModels([...models, { id }], status?.model || id)
    modelDraft = ''
  }

  async function removeModel(id) {
    if (models.length <= 1) {
      error = 'The catalog needs one model.'
      return
    }
    const next = models.filter(item => item.id !== id)
    await saveModels(next, status?.model === id ? next[0].id : status?.model)
  }

  async function setDefaultModel(id) {
    if (id === status?.model) return
    await saveModels(models, id)
  }

  async function toggle() {
    if (!status) return
    toggling = true
    error = null
    try {
      const res = await api.setEnabled(!status.enabled)
      status = res.status
    } catch (e) {
      error = e.message
    } finally {
      toggling = false
    }
  }

  async function runTest() {
    testing = true
    testResult = null
    testError = null
    try {
      const res = await api.testConnection()
      // O backend responde 200 mesmo quando o provider falha (pra o Cloudflare
      // não trocar o corpo por uma página 5xx) — decide pelo campo `success`.
      if (res?.success) testResult = res
      else testError = res?.error || 'Test failed.'
    } catch (e) {
      testError = e.message
    } finally {
      testing = false
    }
  }

  function cancelEdit() {
    editingKey = false
    apiKeyInput = ''
    error = null
  }

  $: stateLabel = !status?.present
    ? 'Not configured'
    : !status.configured
      ? 'No key'
      : status.enabled
        ? 'Active'
        : 'Disabled'

  $: stateKind = !status?.present
    ? 'neutral'
    : !status.configured
      ? 'warn'
      : status.enabled
        ? 'on'
        : 'neutral'

  onMount(load)
  onMount(() => { offTheme = onThemeChange((t) => (theme = t)) })
</script>

<main class="page" data-theme={theme} aria-busy={loading}>
  <div class="shell">
  <header class="page-header">
    <div class="title-row">
      <div class="icon-box">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
          <g stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12h3"/>
            <path d="M12 12l5-5M12 12h5M12 12l5 5"/>
          </g>
          <g fill="currentColor">
            <circle cx="12" cy="12" r="2.2"/>
            <circle cx="5" cy="12" r="1.4"/>
            <circle cx="18" cy="7" r="1.4"/>
            <circle cx="18" cy="12" r="1.4"/>
            <circle cx="18" cy="17" r="1.4"/>
          </g>
        </svg>
      </div>
      <div>
        <h1>OpenRouter</h1>
        <p class="subtitle">OpenAI-compatible gateway for hundreds of models.</p>
      </div>
    </div>
    <span class="badge {stateKind}">{stateLabel}</span>
  </header>

  {#if error}
    <div class="notice error">{error}</div>
  {/if}

  {#if loading}
      <div class="empty">Loading OpenRouter</div>
  {:else}
    <!-- ── Connection ─────────────────────────────────────────────────────── -->
    <section class="card">
      <div class="toggle-row">
        <div>
        <span class="toggle-title">Provider</span>
          <span class="toggle-desc">Available in Agent's model rotation.</span>
        </div>
        <button
          class="switch" class:on={status?.enabled}
          disabled={toggling || !status?.configured}
          title={!status?.configured ? 'Configure a key first' : ''}
          on:click={toggle}
          aria-label="Enable openrouter provider"
        ><span class="knob"></span></button>
      </div>

      <div class="meta-grid">
        <div class="meta">
          <span class="meta-k">API key</span>
          <span class="meta-v mono">{status?.configured ? status.keyPreview : '— empty —'}</span>
        </div>
        <div class="meta">
          <span class="meta-k">Model</span>
          <span class="meta-v mono">{status?.model || '—'}</span>
        </div>
        <div class="meta">
          <span class="meta-k">Endpoint</span>
          <span class="meta-v mono">{status?.base_url || '—'}</span>
        </div>
        <div class="meta">
          <span class="meta-k">Weight</span>
          <span class="meta-v">{status?.weight ?? 1}</span>
        </div>
      </div>
    </section>

    <!-- ── API key ────────────────────────────────────────────────────────── -->
    {#if status?.configured && !editingKey}
      <section class="card">
        <div class="card-head">
          <div>
            <h2>API key</h2>
            <p class="card-desc tight">
              <span class="mono">{status.keyPreview}</span> ·
              <strong class="mono">{status.model || '—'}</strong>
            </p>
          </div>
          <button class="btn-ghost" on:click={() => (editingKey = true)}>Edit</button>
        </div>
      </section>
    {:else}
      <section class="card">
        <h2>API key</h2>
          <p class="card-desc">
          Get a key at <span class="mono">openrouter.ai/keys</span>. It is stored locally and
          only sent to OpenRouter.
        </p>

        <div class="field">
          <label for="or-key">API key</label>
          <input
            id="or-key"
            type="password"
            bind:value={apiKeyInput}
            spellcheck="false"
            autocomplete="off"
            placeholder={status?.configured ? `keeps current (${status.keyPreview})` : 'sk-or-v1-…'}
          />
        </div>

        <div class="field">
          <label for="or-model">Model</label>
          <input
            id="or-model"
            list="or-models"
            bind:value={modelInput}
            spellcheck="false"
            autocomplete="off"
            placeholder="provider/model"
          />
          <datalist id="or-models">
            {#each MODELS as m}<option value={m}></option>{/each}
          </datalist>
          <span class="field-hint">Use any <span class="mono">provider/model</span> id.</span>
        </div>

        <div class="actions">
          <button class="btn-primary" on:click={save} disabled={saving || !apiKeyInput.trim()}>
            {saving ? 'Saving…' : 'Save key'}
          </button>
          {#if status?.configured}
            <button class="btn-ghost" on:click={cancelEdit} disabled={saving}>Cancel</button>
          {/if}
          {#if saveMsg}<span class="save-msg">{saveMsg}</span>{/if}
        </div>
      </section>
    {/if}

    <!-- ── Model catalog ─────────────────────────────────────────────────── -->
    {#if status?.configured && !editingKey}
      <section class="card">
        <div class="card-head">
          <div>
            <h2>Model catalog</h2>
            <p class="card-desc tight">Choose the default or add another model.</p>
          </div>
        </div>
        <div class="catalog">
          {#each models as item (item.id)}
            <div class="model-row">
              <button
                class="default-dot" class:active={item.id === status?.model}
                title={item.id === status?.model ? 'Default model' : 'Set as default'}
                aria-label={`Set ${item.id} as default`}
                disabled={savingModels}
                on:click={() => setDefaultModel(item.id)}
              ></button>
              <span class="mono model-id">{item.id}</span>
              {#if item.capabilities?.tools?.supported}<span class="capability">Tools</span>{/if}
              <button class="icon-button" aria-label={`Remove ${item.id}`} title="Remove model" disabled={savingModels || models.length <= 1} on:click={() => removeModel(item.id)}>
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
              </button>
            </div>
          {/each}
        </div>
        <div class="add-model">
          <input
            list="or-models-2"
            bind:value={modelDraft}
            on:keydown={(event) => event.key === 'Enter' && addModel()}
            spellcheck="false"
            autocomplete="off"
            placeholder="Add provider/model"
          />
          <datalist id="or-models-2">
            {#each MODELS as m}<option value={m}></option>{/each}
          </datalist>
          <button class="btn-ghost" on:click={addModel} disabled={savingModels || !modelDraft.trim()}>Add</button>
        </div>
        <span class="field-hint">The filled dot marks the default model.</span>
      </section>
    {/if}

    <!-- ── Test ───────────────────────────────────────────────────────────── -->
    {#if status?.configured}
      <section class="card">
        <div class="card-head">
          <div>
            <h2>Test connection</h2>
            <p class="card-desc">Send one live request to validate the key and model.</p>
          </div>
          <button class="btn-ghost" on:click={runTest} disabled={testing}>
            {testing ? 'Testing…' : 'Test'}
          </button>
        </div>

        {#if testError}
          <div class="notice error">{testError}</div>
        {/if}
        {#if testResult}
          <div class="notice ok"><strong>OK</strong> · {testResult.model} · {testResult.ms}ms</div>
          <div class="reply-block">
            <span class="meta-k">Reply</span>
            <p>{testResult.reply || '(empty)'}</p>
          </div>
        {/if}
      </section>
    {/if}
  {/if}
  </div>
</main>

<style>
  /* Theme tokens — this view runs in its own iframe/document and can't inherit
     Agent's .shell tokens, so it declares its own per apps/thinkiac/AGENTS.md.
     Mirrors the maritaca app's Slate palette. */
  .page[data-theme="dark"] {
    --tk-bg: #111111;
    --tk-surface: #181818;
    --tk-border: rgba(255, 255, 255, 0.09);
    --tk-border-hi: rgba(255, 255, 255, 0.16);
    --tk-text: #f5f5f5;
    --tk-muted: #888888;
    --tk-accent: #f5f5f5;
    --tk-on-accent: #111111;
    --tk-mono: 'Ubuntu Mono', 'Fira Code', monospace;
    --w04: rgba(255, 255, 255, 0.04);
    --w06: rgba(255, 255, 255, 0.06);
    --w08: rgba(255, 255, 255, 0.08);
    --w10: rgba(255, 255, 255, 0.10);
    --w15: rgba(255, 255, 255, 0.15);
    --w20: rgba(255, 255, 255, 0.20);
    --w25: rgba(255, 255, 255, 0.25);
    --w30: rgba(255, 255, 255, 0.30);
    --shadow-soft: 0 1px 2px rgba(0,0,0,0.4), 0 6px 16px rgba(0,0,0,0.28);
    --shadow-soft-hover: 0 2px 4px rgba(0,0,0,0.45), 0 12px 28px rgba(0,0,0,0.35);
  }
  .page[data-theme="light"] {
    --tk-bg: #ffffff;
    --tk-surface: #f5f5f5;
    --tk-border: rgba(0, 0, 0, 0.10);
    --tk-border-hi: rgba(0, 0, 0, 0.18);
    --tk-text: #1a1a1a;
    --tk-muted: #666666;
    --tk-accent: #111111;
    --tk-on-accent: #ffffff;
    --tk-mono: 'Ubuntu Mono', 'Fira Code', monospace;
    --w04: rgba(0, 0, 0, 0.04);
    --w06: rgba(0, 0, 0, 0.06);
    --w08: rgba(0, 0, 0, 0.08);
    --w10: rgba(0, 0, 0, 0.10);
    --w15: rgba(0, 0, 0, 0.15);
    --w20: rgba(0, 0, 0, 0.20);
    --w25: rgba(0, 0, 0, 0.25);
    --w30: rgba(0, 0, 0, 0.30);
    --shadow-soft: 0 1px 2px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.08);
    --shadow-soft-hover: 0 2px 4px rgba(0,0,0,0.08), 0 8px 20px rgba(0,0,0,0.10);
  }

  /* Full-bleed: o fundo dark cobre 100% da largura da iframe (sem gutters
     brancos vindos do iframe do shell). O conteúdo respira num container
     interno largo, mas a cor vai de ponta a ponta. */
  .page {
    width: 100%;
    box-sizing: border-box;
    padding: 14px 12px 64px;
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    gap: 14px;
    background: var(--tk-bg);
    color: var(--tk-text);
  }

  .shell { width: min(820px, 100%); margin: 0 auto; display: flex; flex-direction: column; gap: 12px; }
  .page-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 2px 2px 4px; }
  .title-row { display: flex; align-items: flex-start; gap: 12px; }
  .icon-box {
    flex: none;
    width: 34px; height: 34px;
    border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    background: var(--tk-surface);
    border: 1px solid var(--tk-border);
    color: var(--tk-text);
  }

  h1 { font-size: 16px; margin: 0 0 2px; }
  h2 { font-size: 14px; margin: 0 0 6px; }
  .subtitle { font-size: 11px; color: var(--tk-muted); margin: 0; line-height: 1.4; }
  .card-desc { font-size: 11px; color: var(--tk-muted); margin: 0 0 10px; max-width: 560px; line-height: 1.4; }
  .card-desc.tight { margin: 5px 0 8px; }

  .notice {
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 12px;
    color: var(--tk-text);
    background: var(--w04);
    border: 1px solid var(--w10);
  }
  .notice.error { border-left: 3px solid var(--tk-text); font-weight: 500; }
  .notice.ok { background: var(--w06); }

  .card {
    background: var(--tk-surface);
    border: 1px solid var(--tk-border);
    border-radius: 8px;
    padding: 12px;
  }
  .card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 4px; }
  .empty { font-size: 12px; color: var(--tk-muted); text-align: center; padding: 28px 12px; }

  .toggle-row { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
  .toggle-title { display: block; font-size: 12px; font-weight: 600; }
  .toggle-desc { display: block; font-size: 11px; color: var(--tk-muted); margin-top: 2px; max-width: 480px; line-height: 1.45; }
  .switch {
    flex: 0 0 40px;
    width: 40px; height: 22px;
    border-radius: 999px;
    border: 1px solid var(--tk-border-hi);
    background: var(--tk-bg);
    position: relative; cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }
  .switch:disabled { opacity: 0.45; cursor: not-allowed; }
  .switch .knob {
    position: absolute; top: 2px; left: 2px;
    width: 16px; height: 16px; border-radius: 50%;
    background: var(--tk-muted);
    transition: all 0.15s ease;
  }
  .switch.on { background: var(--w20); border-color: var(--w30); }
  .switch.on .knob { left: 20px; background: var(--tk-text); }

  .meta-grid {
    margin-top: 10px; padding-top: 10px;
    border-top: 1px solid var(--tk-border);
    display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px;
  }
  .meta { display: flex; flex-direction: column; gap: 3px; }
  .meta-k { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--tk-muted); }
  .meta-v { font-size: 12px; font-weight: 600; word-break: break-all; }
  .mono { font-family: var(--tk-mono); font-weight: 500; }

  .badge { font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
  .badge.on      { background: var(--w15); color: var(--tk-text); border: 1px solid var(--w25); }
  .badge.warn    { background: var(--w06); color: var(--tk-muted); border: 1px solid var(--w15); }
  .badge.neutral { background: transparent; color: var(--tk-muted); border: 1px solid var(--tk-border-hi); }

  .field { display: flex; flex-direction: column; gap: 4px; margin-top: 14px; }
  .field.narrow { max-width: 340px; }
  .field label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--tk-muted); }
  .field-hint { font-size: 11px; color: var(--tk-muted); line-height: 1.4; margin-top: 2px; }
  input {
    padding: 8px 10px;
    background: var(--tk-bg);
    border: 1px solid var(--tk-border);
    border-radius: 6px;
    color: var(--tk-text);
    font-size: 12px;
    font-family: var(--tk-mono);
  }
  input:focus { border-color: var(--tk-accent); outline: 2px solid var(--tk-accent); outline-offset: 1px; }

  .actions { display: flex; align-items: center; gap: 12px; margin-top: 14px; flex-wrap: wrap; }
  .btn-primary {
    padding: 9px 16px; font-size: 12px; font-weight: 600; border-radius: 8px;
    background: var(--tk-accent); color: var(--tk-on-accent);
    border: none; cursor: pointer;
    box-shadow: var(--shadow-soft);
    transition: transform 0.12s ease, box-shadow 0.16s ease, filter 0.12s ease;
  }
  .btn-primary:hover:not(:disabled) { transform: translateY(-2px); filter: brightness(0.92); box-shadow: var(--shadow-soft-hover); }
  .btn-primary:active:not(:disabled) { transform: translateY(0); }
  .btn-primary:disabled { opacity: 0.35; cursor: not-allowed; box-shadow: none; }
  .btn-ghost {
    padding: 8px 14px; font-size: 12px; border-radius: 6px;
    background: transparent; color: var(--tk-muted);
    border: 1px solid var(--tk-border);
    cursor: pointer; white-space: nowrap;
    transition: color 0.15s ease, border-color 0.15s ease;
  }
  .btn-ghost:hover:not(:disabled) { color: var(--tk-text); border-color: var(--w20); }
  .btn-ghost:disabled { opacity: 0.4; cursor: not-allowed; }
  .save-msg { font-size: 12px; color: var(--tk-text); font-weight: 600; }

  .catalog { border: 1px solid var(--tk-border); border-radius: 8px; overflow: hidden; }
  .model-row { min-height: 40px; padding: 7px 8px; display: flex; align-items: center; gap: 9px; border-bottom: 1px solid var(--tk-border); }
  .model-row:last-child { border-bottom: 0; }
  .model-id { min-width: 0; flex: 1; font-size: 12px; overflow-wrap: anywhere; }
  .default-dot { width: 14px; height: 14px; flex: none; border-radius: 50%; background: transparent; border: 1px solid var(--tk-border-hi); cursor: pointer; padding: 0; }
  .default-dot.active { background: var(--tk-text); box-shadow: inset 0 0 0 3px var(--tk-surface); }
  .default-dot:disabled { cursor: wait; opacity: .5; }
  .capability { padding: 2px 6px; border: 1px solid var(--tk-border); border-radius: 999px; font-size: 10px; color: var(--tk-muted); }
  .icon-button { width: 28px; height: 28px; display: grid; place-items: center; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--tk-muted); cursor: pointer; }
  .icon-button:hover:not(:disabled) { color: var(--tk-text); border-color: var(--tk-border); }
  .icon-button:disabled { opacity: .35; cursor: not-allowed; }
  .add-model { margin-top: 10px; display: flex; gap: 8px; max-width: 480px; }
  .add-model input { min-width: 0; flex: 1; }

  .reply-block {
    margin-top: 10px; padding: 10px 12px;
    background: var(--tk-bg);
    border: 1px solid var(--w06);
    border-radius: 8px;
  }
  .reply-block p { margin: 4px 0 0; font-size: 12px; line-height: 1.5; color: var(--tk-text); white-space: pre-wrap; word-break: break-word; }

  @media (max-width: 480px) {
    .meta-grid { grid-template-columns: 1fr 1fr; }
  }
  @media (max-width: 420px) {
    .meta-grid { grid-template-columns: 1fr; }
    .page-header { align-items: flex-start; }
  }
</style>
