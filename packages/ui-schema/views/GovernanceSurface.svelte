<script>
  export let surface;
  export let state = {};
  export let actionUrl = '';

  const modes = [
    { id: 'semi', label: 'Semi', hint: 'Uses the policy and asks when an action is uncertain.' },
    { id: 'manual', label: 'Manual', hint: 'Requires approval for every state-changing action.' },
    { id: 'auto', label: 'Auto', hint: 'Approves actions automatically. Blocked actions remain blocked.' },
  ];
  const presets = [
    { id: 'read_only', label: 'Read only' }, { id: 'workspace_edits', label: 'Workspace edits' }, { id: 'custom', label: 'Custom' },
  ];

  let data = {}, form = {}, busy = false, error = '', notice = '';
  $: if (state && state !== data) {
    data = state;
    form = {
      mode: state.policy?.mode || 'semi', preset: state.policy?.preset || 'read_only', prompt: state.policy?.prompt || '',
      generateWithAI: state.confirmation?.generateWithAI === true, model: state.confirmation?.model || '',
    };
  }
  $: options = Array.isArray(data.confirmation?.options) ? data.confirmation.options : [];
  $: groups = [...new Set(options.map((option) => option.group))].map((group) => ({ group, options: options.filter((option) => option.group === group) }));

  async function save() {
    busy = true; error = ''; notice = '';
    try {
      const response = await fetch(actionUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'governance.save-defaults', values: { ...form, model: form.model || null } }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.status >= 400) throw new Error(result.mensagem || result.error || 'Could not save governance defaults.');
      data = result.state || data;
      notice = result.notice || 'Governance defaults updated.';
    } catch (cause) { error = cause.message || 'Could not save governance defaults.'; }
    finally { busy = false; }
  }
</script>

<section class="surface" aria-busy={busy}>
  <header><p class="eyebrow">{surface.eyebrow}</p><h2>{surface.title}</h2><p class="muted">{surface.description}</p></header>
  {#if error}<p class="notice error" role="alert">{error}</p>{/if}
  {#if notice}<p class="notice" role="status">{notice}</p>{/if}
  <form on:submit|preventDefault={save}>
    <section>
      <div><h3>Default policy</h3><p class="muted">Applied only to new sessions. Existing session choices remain unchanged.</p></div>
      <label>Governance mode<select bind:value={form.mode}>{#each modes as mode}<option value={mode.id}>{mode.label} · {mode.hint}</option>{/each}</select></label>
      {#if form.mode === 'semi'}
        <label>Policy preset<select bind:value={form.preset}>{#each presets as preset}<option value={preset.id}>{preset.label}</option>{/each}</select></label>
        {#if form.preset === 'custom'}<label>Custom policy<textarea bind:value={form.prompt} rows="4" placeholder="May edit project files, but never delete or publish."></textarea></label>{/if}
      {/if}
    </section>
    <section>
      <div><h3>Approval message</h3><p class="muted">The fixed message remains the fallback if AI generation is unavailable.</p></div>
      <label class="toggle"><span>Generate a verbal question with AI</span><input type="checkbox" bind:checked={form.generateWithAI} /></label>
      {#if form.generateWithAI}<label>Model for the question<select bind:value={form.model} required><option value="" disabled>Choose a model</option>{#each groups as { group, options }}<optgroup label={group}>{#each options as option}<option value={option.id} disabled={!option.poolEnabled}>{option.label}{option.poolEnabled ? '' : ' (disabled pool)'}</option>{/each}</optgroup>{/each}</select></label>{/if}
    </section>
    <footer><button class="primary" disabled={busy}>{busy ? 'Saving…' : 'Save governance defaults'}</button></footer>
  </form>
</section>

<style>
  .surface,form,section{display:grid;gap:1rem}.surface *{box-sizing:border-box}h2,h3,p{margin:0}h2{font-size:1.5rem;letter-spacing:-.03em}h3{font-size:1rem}.eyebrow{color:var(--tk-muted);font-size:.72rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;margin-bottom:.4rem}.muted{color:var(--tk-muted);font-size:.85rem;line-height:1.45}form{max-width:680px}section{border-top:1px solid var(--tk-border);padding-top:1.15rem}label{display:grid;gap:.4rem;color:var(--tk-muted);font-size:.85rem}input,select,textarea{width:100%;min-height:2.55rem;border:1px solid var(--tk-border);border-radius:var(--tk-radius-md);background:transparent;color:var(--tk-text);font:inherit;padding:.6rem .7rem}textarea{resize:vertical;min-height:6.25rem}input:focus,select:focus,textarea:focus{border-color:var(--tk-border-hi);outline:2px solid var(--tk-border);outline-offset:1px}.toggle{display:flex;align-items:center;justify-content:space-between}.toggle input{width:1.15rem;min-height:1.15rem;accent-color:var(--tk-accent)}footer{display:flex;justify-content:flex-end}.primary{border:1px solid var(--tk-accent);border-radius:var(--tk-radius-md);background:var(--tk-accent);color:var(--tk-bg);cursor:pointer;padding:.65rem .9rem;font:inherit;font-weight:700}.primary:disabled{cursor:wait;opacity:.55}.notice{border-left:2px solid var(--tk-border-hi);padding:.75rem}.error{color:var(--tk-danger,#ff9b9b)}
</style>
