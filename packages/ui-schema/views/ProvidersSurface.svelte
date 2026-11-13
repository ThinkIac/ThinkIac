<script>
  export let surface;
  export let state = {};
  export let actionUrl = '';

  let data = {}, busy = false, error = '', notice = '', importKey = '', editing = null, form = null;
  const retryDefaults = { maxAttempts: 2, baseDelayMs: 400, maxDelayMs: 8000, retryableStatus: [408, 425, 429, 500, 502, 503, 504] };
  const presets = {
    thinkiac: ['ThinkIac Orbit', 'thinkiac', 'https://thinkiac.cloud/thinkiac-provider/v1', 'orbit'],
    openrouter: ['OpenRouter', 'openrouter', 'https://openrouter.ai/api/v1', 'openrouter/auto'],
    openai: ['OpenAI', 'openai', 'https://api.openai.com/v1', 'gpt-4o-mini'],
    compatible: ['OpenAI-compatible API', 'openai', '', ''],
  };
  $: if (state && state !== data) data = state;
  $: pools = Array.isArray(data.pools) ? data.pools : [];
  $: slots = Array.isArray(data.slots) ? data.slots : [];
  const json = (value, fallback) => { try { return value ? JSON.parse(value) : fallback; } catch { throw new Error('Corrija os campos JSON antes de salvar.'); } };
  const pretty = (value, fallback) => JSON.stringify(value ?? fallback, null, 2);
  function blank(preset = 'openrouter') {
    const [name, provider, base_url, model] = presets[preset];
    return { preset, name, provider, base_url, description: '', api_key: '', enabled: false, weight: 1, maxConcurrency: 2, model, retryJson: pretty(retryDefaults), slotsJson: '[]', modelsJson: pretty(model ? [{ id: model }] : []) };
  }
  function edit(pool) {
    editing = pool.id;
    form = { preset: 'compatible', name: pool.name || '', provider: pool.provider || 'openai', base_url: pool.base_url || '', description: pool.description || '', api_key: '', enabled: Boolean(pool.enabled), weight: pool.weight ?? 1, maxConcurrency: pool.maxConcurrency ?? 2, model: pool.model || '', retryJson: pretty(pool.retry, retryDefaults), slotsJson: pretty((pool.api_keys || []).map(({ key, ...slot }) => ({ ...slot, key: '' })), []), modelsJson: pretty(pool.models, []) };
    error = ''; notice = '';
  }
  function newProvider() { editing = 'new'; form = blank(); error = ''; notice = ''; }
  function changePreset() { const enabled = form.enabled; form = { ...blank(form.preset), enabled }; }
  function providerPayload() {
    return { ...form, retry: json(form.retryJson, retryDefaults), slots: json(form.slotsJson, []), models: json(form.modelsJson, []), weight: Number(form.weight), maxConcurrency: Number(form.maxConcurrency) };
  }
  async function invoke(action, values, success) {
    busy = true; error = ''; notice = '';
    try {
      const response = await fetch(actionUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, values }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.status >= 400) throw new Error(result.mensagem || result.error || 'Não foi possível concluir a ação.');
      if (result.state) data = result.state;
      notice = result.notice || success;
      return true;
    } catch (cause) { error = cause.message || 'Não foi possível concluir a ação.'; return false; }
    finally { busy = false; }
  }
  async function save() { try { const payload = providerPayload(); const done = editing === 'new' ? await invoke('providers.create', payload, 'Provider criado.') : await invoke('providers.update', { id: editing, provider: payload }, 'Provider atualizado.'); if (done) editing = null; } catch (cause) { error = cause.message; } }
  async function importProviderKey() { if (await invoke('providers.import-key', { key: importKey }, 'Chave carregada.')) importKey = ''; }
  function poolSlots(pool) { return slots.filter((slot) => slot.pool === pool.id); }
</script>

<section class="surface" aria-busy={busy}>
  <header><div><p class="eyebrow">{surface.eyebrow}</p><h2>{surface.title}</h2><p class="muted">{surface.description}</p></div><div class="actions"><label class="key"><span>Chave ThinkIac</span><input type="password" bind:value={importKey} placeholder="Cole uma chave tiac.*" autocomplete="off" /></label><button class="primary" disabled={busy || !importKey.trim()} on:click={importProviderKey}>Carregar chave</button><button disabled={busy} on:click={newProvider}>Configuração avançada</button></div></header>
  {#if error}<p class="notice error" role="alert">{error}</p>{/if}{#if notice}<p class="notice" role="status">{notice}</p>{/if}
  {#if !pools.length}<p class="empty">Nenhum provider configurado.</p>{:else}<section class="grid" aria-label="Providers configurados">{#each pools as pool}<article class:off={!pool.enabled}><div class="pool-head"><div><h3>{pool.name}</h3><p class="muted">{pool.description || pool.provider}</p></div><button class:on={pool.enabled} class="switch" aria-label="Alternar {pool.name}" aria-pressed={pool.enabled} disabled={busy} on:click={() => invoke('providers.toggle', { id: pool.id, enabled: !pool.enabled }, 'Disponibilidade atualizada.')}><span></span></button></div><dl><div><dt>Tipo</dt><dd>{pool.provider}</dd></div><div><dt>Modelo padrão</dt><dd>{pool.model || 'Não definido'}</dd></div><div><dt>Modelos / slots</dt><dd>{pool.models?.length || 0} / {poolSlots(pool).length}</dd></div><div><dt>Retentativas</dt><dd>{pool.retry?.maxAttempts || 2} tentativas</dd></div></dl>{#each poolSlots(pool) as slot}<div class:blocked={slot.blocked} class="slot"><span><strong>{slot.id}</strong><small>{slot.in_flight}/{slot.max_concurrency} ativos · {slot.failures} falhas</small></span>{#if slot.blocked}<button disabled={busy} on:click={() => invoke('providers.reactivate-slot', { id: slot.id, pool: pool.id }, 'Slot reativado.')}>Reativar</button>{/if}</div>{/each}<footer><button disabled={busy} on:click={() => edit(pool)}>Editar</button>{#if !pool.protected}<button class="danger" disabled={busy} on:click={() => confirm(`Remover ${pool.name}? Esta ação não pode ser desfeita.`) && invoke('providers.remove', { id: pool.id }, 'Provider removido.')}>Remover</button>{:else}<small class="muted">Gerenciado pelo ThinkIac</small>{/if}</footer></article>{/each}</section>{/if}
  {#if editing}<div class="backdrop" role="presentation" on:click|self={() => !busy && (editing = null)}><section class="editor" role="dialog" aria-modal="true" aria-labelledby="provider-editor-title"><header><div><p class="eyebrow">Configuração do provider</p><h3 id="provider-editor-title">{editing === 'new' ? 'Novo provider' : form.name}</h3><p class="muted">As alterações são gravadas diretamente na configuração do Agent.</p></div><button aria-label="Fechar" disabled={busy} on:click={() => editing = null}>×</button></header><div class="editor-body"><div class="fields"><label>Preset<select bind:value={form.preset} on:change={changePreset}><option value="thinkiac">ThinkIac Orbit</option><option value="openrouter">OpenRouter</option><option value="openai">OpenAI</option><option value="compatible">API compatível com OpenAI</option></select></label><label>Nome<input bind:value={form.name} /></label><label>Tipo<input bind:value={form.provider} /></label><label>URL base<input bind:value={form.base_url} /></label><label>Modelo padrão<input bind:value={form.model} /></label><label>Peso<input type="number" min="0" bind:value={form.weight} /></label><label>Concorrência<input type="number" min="1" max="100" bind:value={form.maxConcurrency} /></label><label class="toggle"><input type="checkbox" bind:checked={form.enabled} /> Provider ativo</label><label class="wide">Descrição<textarea bind:value={form.description}></textarea></label><label class="wide">{editing === 'new' ? 'Chave da API' : 'Nova chave da API (vazio preserva as atuais)'}<input type="password" bind:value={form.api_key} autocomplete="new-password" /></label></div><details open><summary>Resiliência, slots e catálogo avançado</summary><p class="muted">Use JSON para manter todos os metadados suportados pelo Agent, inclusive capacidades e roteamento por chave.</p><div class="fields"><label>Política de retentativa (JSON)<textarea rows="7" bind:value={form.retryJson}></textarea></label><label>Slots de credencial (JSON)<textarea rows="7" bind:value={form.slotsJson}></textarea></label><label class="wide">Modelos e capacidades (JSON)<textarea rows="12" bind:value={form.modelsJson}></textarea></label></div></details></div><footer><button disabled={busy} on:click={() => editing = null}>Cancelar</button><button class="primary" disabled={busy} on:click={save}>{busy ? 'Salvando…' : 'Salvar provider'}</button></footer></section></div>{/if}
</section>

<style>
  .surface{display:grid;gap:1rem}.surface *{box-sizing:border-box}header,.pool-head,footer,.actions,.slot{display:flex;gap:.75rem;justify-content:space-between;align-items:flex-start}h2,h3,p{margin:0}h2{font-size:1.5rem;letter-spacing:-.03em}.eyebrow{font-size:.72rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;margin-bottom:.4rem}.muted,small{color:var(--tk-muted)}.actions{align-items:end;flex-wrap:wrap}.key{display:grid;gap:.35rem;font-size:.8rem;color:var(--tk-muted)}input,select,textarea,button{font:inherit;color:var(--tk-text)}input,select,textarea{min-height:2.55rem;width:100%;padding:.55rem .65rem;background:transparent;border:1px solid var(--tk-border);border-radius:var(--tk-radius-md)}textarea{resize:vertical;font-family:ui-monospace,monospace}button{padding:.6rem .8rem;cursor:pointer;background:transparent;border:1px solid var(--tk-border);border-radius:var(--tk-radius-md)}button:hover:not(:disabled){opacity:.8}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid var(--tk-text);outline-offset:2px}button:disabled{cursor:wait;opacity:.55}.primary{background:var(--tk-accent);border-color:var(--tk-accent);color:var(--tk-bg);font-weight:700}.notice{border-left:2px solid var(--tk-border-hi);padding:.75rem}.error,.danger,.blocked{color:var(--tk-danger,#ff9b9b)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:.8rem}.grid article{padding:1rem;border:1px solid var(--tk-border);border-radius:var(--tk-radius-md)}.off{opacity:.62}.switch{width:2.5rem;height:1.5rem;padding:.15rem;border-radius:10rem}.switch span{display:block;width:1rem;height:1rem;background:var(--tk-muted);border-radius:50%;transition:transform .2s}.switch.on{background:var(--tk-accent)}.switch.on span{background:var(--tk-bg);transform:translateX(1rem)}dl{display:grid;grid-template-columns:1fr 1fr;gap:.7rem;margin:1rem 0}dt{font-size:.68rem;text-transform:uppercase;color:var(--tk-muted)}dd{margin:.2rem 0 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.slot{align-items:center;padding:.6rem 0;border-top:1px solid var(--tk-border)}.slot small{display:block;font-size:.75rem}footer{align-items:center}.backdrop{position:fixed;z-index:30;inset:0;background:#0008;display:flex;justify-content:flex-end}.editor{width:min(850px,100%);height:100%;display:flex;flex-direction:column;background:var(--tk-bg);border-left:1px solid var(--tk-border-hi)}.editor>header,.editor>footer{padding:1rem;border-bottom:1px solid var(--tk-border)}.editor>footer{border-top:1px solid var(--tk-border);border-bottom:0;justify-content:flex-end}.editor-body{overflow:auto;padding:1rem}.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.85rem}.fields label{display:grid;gap:.35rem;font-size:.82rem;color:var(--tk-muted)}.fields .wide{grid-column:1/-1}.toggle{display:flex!important;align-items:center;gap:.5rem!important}.toggle input{width:auto;min-height:auto}details{margin-top:1.2rem;border-top:1px solid var(--tk-border);padding-top:.9rem}summary{cursor:pointer;font-weight:600}.empty{color:var(--tk-muted)}@media(max-width:680px){.actions{align-items:stretch}.actions>*{width:100%}.fields{grid-template-columns:1fr}.editor{width:100%}}
</style>
