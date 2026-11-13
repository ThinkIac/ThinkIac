<script>
  import { onMount } from "svelte";
  import { fade } from "svelte/transition";

  let catalog = [];
  let loading = true;
  let query = "";

  let composableAgents = []; // [{pkg, name, description}]
  let availableTools = []; // [{name, description, package}] — vem do catálogo real da aurora
  let toolsLoadError = false;
  let availableAccesses = []; // [{id, model, provider, providerLabel, name}] — pools já configurados na aurora
  let providersLoadError = false;

  let selectedId = null; // id do catálogo selecionado na lista
  let detail = null; // especialista resolvido (GET /specialists/:id)
  let detailLoading = false;

  // ---- Formulário de edição/criação (só especialistas custom) ----
  const emptyForm = () => ({
    name: "",
    description: "",
    prompt: "",
    agents: [],
    toolsMode: "unrestricted", // "unrestricted" | "allowlist"
    tools: [],
    provider: "",
    model: "",
    fallbackModel: "",
  });
  let form = emptyForm();
  let editingId = null; // null = criando um novo
  let saving = false;
  let saveError = "";
  let toolQuery = "";
  let toolPackageFilter = "";
  let previewText = "";
  let previewing = false;


  async function fetchCatalog() {
    loading = true;
    try {
      const res = await fetch("/specialists/catalog");
      const json = await res.json();
      catalog = (json?.data ?? json)?.specialists ?? [];
    } catch (e) {
      console.error("Erro ao listar especialistas:", e);
    } finally {
      loading = false;
    }
  }

  async function fetchComposableAgents() {
    try {
      const res = await fetch("/specialists/agents");
      const json = await res.json();
      composableAgents = (json?.data ?? json)?.agents ?? [];
    } catch (e) {
      console.error("Erro ao listar AGENT.md disponíveis:", e);
    }
  }

  // O catálogo REAL de tools é da aurora (core/registry.js) — buscado direto
  // do cliente pra não criar uma dependência de código entre os dois pacotes.
  // Se a aurora não estiver instalada/no ar, a allowlist ainda funciona por
  // texto livre (ver toolQuery abaixo).
  async function fetchAvailableTools() {
    try {
      const res = await fetch("/agent/tools");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const unique = new Map();
      for (const t of (json?.data ?? json)?.tools ?? []) {
        // O host expõe `package`; os fallbacks mantêm compatibilidade com
        // versões anteriores do catálogo e ferramentas externas.
        const tool = {
          name: t.name,
          description: t.description || "",
          package: t.package || t.packageName || t.source?.package || "runtime",
        };
        // Alguns registries podem relatar a mesma exportação duas vezes.
        // Uma allowlist é por nome, portanto ela só deve aparecer uma vez.
        if (tool.name && !unique.has(tool.package + ":" + tool.name)) unique.set(tool.package + ":" + tool.name, tool);
      }
      availableTools = [...unique.values()];
    } catch (e) {
      toolsLoadError = true;
      console.warn("Catálogo de tools da aurora indisponível — allowlist segue por texto livre:", e.message);
    }
  }

  // Mesma rota que o Model selector da InputBar já usa pra listar os pools
  // configurados — reusar garante que "provider/modelo já configurados" no
  // especialista sejam exatamente os mesmos que a sessão normal enxerga.
  async function fetchAvailableProviders() {
    try {
      const res = await fetch("/classification/models");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const catalog = (json?.data ?? json) ?? {};
      availableAccesses = (catalog.accesses || [])
        .filter((access) => access.enabled && access.authenticated && access.available)
        .map((access) => ({
          id: access.id,
          model: access.model,
          provider: access.provider,
          providerLabel: access.metadata?.poolName || access.accessId || access.provider,
          name: access.name || access.model || access.accessId,
        }));
    } catch (e) {
      providersLoadError = true;
      console.warn("Catálogo de providers/modelos indisponível — segue por texto livre:", e.message);
    }
  }


  $: providerOptions = [...new Set(availableAccesses.map((a) => a.provider))];
  $: modelOptionsForProvider = form.provider
    ? availableAccesses.filter((a) => a.provider === form.provider)
    : availableAccesses;

  onMount(() => {
    fetchCatalog();
    fetchComposableAgents();
    fetchAvailableTools();
    fetchAvailableProviders();
  });

  $: filteredCatalog = (() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? catalog.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            (s.description || "").toLowerCase().includes(q),
        )
      : catalog;
    return list;
  })();
  $: genericList = filteredCatalog.filter((s) => s.kind === "generic");
  $: customList = filteredCatalog.filter((s) => s.kind === "custom");

  $: toolPackages = [...new Set(availableTools.map((tool) => tool.package))]
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
  $: filteredTools = (() => {
    const q = toolQuery.trim().toLowerCase();
    const byPackage = toolPackageFilter
      ? availableTools.filter((tool) => tool.package === toolPackageFilter)
      : availableTools;
    if (!q) return byPackage;
    return byPackage.filter(
      (t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q),
    );
  })();
  $: filteredToolGroups = toolPackages
    .map((pkg) => ({ package: pkg, tools: filteredTools.filter((tool) => tool.package === pkg) }))
    .filter((group) => group.tools.length);

  function packageMonogram(pkg) {
    return pkg.split(/[-_\s]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "R";
  }

  async function selectSpecialist(id) {
    selectedId = id;
    editingId = null;
    detail = null;
    detailLoading = true;
    try {
      const res = await fetch(`/specialists/catalog/${encodeURIComponent(id)}`);
      const json = await res.json();
      detail = (json?.data ?? json) ?? null;
    } catch (e) {
      console.error("Erro ao carregar especialista:", e);
    } finally {
      detailLoading = false;
    }
  }

  function startCreate() {
    selectedId = null;
    detail = null;
    editingId = "__new__";
    form = emptyForm();
    previewText = "";
    saveError = "";
  }

  function startEdit(resolved) {
    editingId = resolved.id;
    form = {
      name: resolved.name || "",
      description: resolved.description || "",
      prompt: resolved.prompt || "",
      agents: [...(resolved.agents || [])],
      toolsMode: resolved.tools ? "allowlist" : "unrestricted",
      tools: resolved.tools ? [...resolved.tools] : [],
      provider: resolved.provider || "",
      model: resolved.model || "",
      fallbackModel: resolved.fallbackModel || "",
    };
    previewText = resolved.composedPrompt || "";
    saveError = "";
  }

  function cancelEdit() {
    editingId = null;
    if (selectedId) selectSpecialist(selectedId);
  }

  function toggleAgent(pkg) {
    form.agents = form.agents.includes(pkg)
      ? form.agents.filter((p) => p !== pkg)
      : [...form.agents, pkg];
  }
  function moveAgent(pkg, delta) {
    const i = form.agents.indexOf(pkg);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= form.agents.length) return;
    const next = [...form.agents];
    [next[i], next[j]] = [next[j], next[i]];
    form.agents = next;
  }
  function toggleTool(name) {
    form.tools = form.tools.includes(name)
      ? form.tools.filter((t) => t !== name)
      : [...form.tools, name];
  }

  async function previewPrompt() {
    previewing = true;
    try {
      const res = await fetch("/specialists/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: form.prompt, agents: form.agents }),
      });
      const json = await res.json();
      previewText = (json?.data ?? json)?.composedPrompt || "";
    } catch (e) {
      console.error("Erro ao pré-visualizar prompt:", e);
    } finally {
      previewing = false;
    }
  }

  async function save() {
    if (!form.name.trim()) {
      saveError = "Name is required.";
      return;
    }
    saving = true;
    saveError = "";
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      prompt: form.prompt.trim() || null,
      agents: form.agents,
      tools: form.toolsMode === "allowlist" ? form.tools : null,
      provider: form.provider.trim() || null,
      model: form.model.trim() || null,
      fallbackModel: form.fallbackModel.trim() || null,
    };
    try {
      const isNew = editingId === "__new__";
      const res = await fetch(isNew ? "/specialists/catalog" : `/specialists/catalog/${encodeURIComponent(editingId)}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      const saved = json?.data ?? json;
      await fetchCatalog();
      editingId = null;
      await selectSpecialist(saved.id);
    } catch (e) {
      saveError = e.message;
    } finally {
      saving = false;
    }
  }

  async function remove(id) {
    if (!confirm("Delete this specialist? Sessions pinned to it fall back to none.")) return;
    try {
      const res = await fetch(`/specialists/catalog/${encodeURIComponent(id)}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      selectedId = null;
      detail = null;
      editingId = null;
      await fetchCatalog();
    } catch (e) {
      alert(`Could not delete: ${e.message}`);
    }
  }
</script>

<div class="sp-wrap">
  <aside class="sp-list">
    <div class="sp-list-head">
      <h1>Specialists</h1>
      <button class="sp-btn primary" on:click={startCreate}>New</button>
    </div>
    <input class="sp-search" type="text" placeholder="Search…" bind:value={query} />

    {#if loading}
      <p class="sp-muted">Loading…</p>
    {:else}
      {#if customList.length}
        <div class="sp-group-label">Custom</div>
        {#each customList as s (s.id)}
          <button
            class="sp-row"
            class:selected={selectedId === s.id}
            on:click={() => selectSpecialist(s.id)}
          >
            <span class="sp-row-name">{s.name}</span>
            {#if s.description}<span class="sp-row-desc">{s.description}</span>{/if}
          </button>
        {/each}
      {/if}

      {#if genericList.length}
        <div class="sp-group-label">From packages (read-only)</div>
        {#each genericList as s (s.id)}
          <button
            class="sp-row"
            class:selected={selectedId === s.id}
            on:click={() => selectSpecialist(s.id)}
          >
            <span class="sp-row-name">{s.name}</span>
            {#if s.description}<span class="sp-row-desc">{s.description}</span>{/if}
          </button>
        {/each}
      {/if}

      {#if !customList.length && !genericList.length}
        <p class="sp-muted">No specialist matches this search.</p>
      {/if}
    {/if}
  </aside>

  <main class="sp-detail">
    <header class="sp-page-head">
      <div>
        <span class="sp-eyebrow">CONFIGURAÇÃO</span>
        <h1>Especialistas</h1>
        <p>Perfis com instruções, ferramentas e automações próprias.</p>
      </div>
      <button class="sp-btn primary mobile-new" on:click={startCreate}>Novo especialista</button>
    </header>
    {#if editingId}
      <div class="sp-panel" transition:fade={{ duration: 120 }}>
        <div class="sp-panel-head">
          <h2>{editingId === "__new__" ? "Novo especialista" : "Editar especialista"}</h2>
          <div class="sp-actions">
            <button class="sp-btn" on:click={cancelEdit} disabled={saving}>Cancelar</button>
            <button class="sp-btn primary" on:click={save} disabled={saving}>
              {saving ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </div>
        {#if saveError}<p class="sp-error">{saveError}</p>{/if}

        <label class="sp-field">
          <span>Nome</span>
          <input type="text" bind:value={form.name} placeholder="Ex.: Triagem de suporte" />
        </label>

        <label class="sp-field">
          <span>Descrição</span>
          <input type="text" bind:value={form.description} placeholder="Uma linha para o catálogo e seletor de sessão" />
        </label>

        <label class="sp-field">
          <span>Instruções</span>
          <textarea rows="6" bind:value={form.prompt} placeholder="Papel, contexto e instruções deste especialista…"></textarea>
        </label>

        <div class="sp-field">
          <span>Compose with package AGENT.md (order matters)</span>
          <div class="sp-agent-list">
            {#each composableAgents as a (a.pkg)}
              <label class="sp-check-row">
                <input
                  type="checkbox"
                  checked={form.agents.includes(a.pkg)}
                  on:change={() => toggleAgent(a.pkg)}
                />
                <span class="sp-check-name">{a.name}</span>
                {#if a.description}<span class="sp-check-desc">{a.description}</span>{/if}
              </label>
            {/each}
          </div>
          {#if form.agents.length}
            <ol class="sp-order-list">
              {#each form.agents as pkg, i (pkg)}
                <li>
                  <span>{composableAgents.find((a) => a.pkg === pkg)?.name ?? pkg}</span>
                  <span class="sp-order-btns">
                    <button type="button" on:click={() => moveAgent(pkg, -1)} disabled={i === 0}>↑</button>
                    <button type="button" on:click={() => moveAgent(pkg, 1)} disabled={i === form.agents.length - 1}>↓</button>
                  </span>
                </li>
              {/each}
            </ol>
          {/if}
        </div>

        <div class="sp-field">
          <div class="sp-preview-head">
            <span>Composed prompt preview</span>
            <button class="sp-btn tiny" on:click={previewPrompt} disabled={previewing}>
              {previewing ? "…" : "Refresh preview"}
            </button>
          </div>
          <pre class="sp-preview">{previewText || "(empty — add a prompt or compose an AGENT.md)"}</pre>
        </div>

        <div class="sp-field">
          <span>Ferramentas</span>
          <div class="sp-tools-mode">
            <label>
              <input type="radio" name="toolsMode" value="unrestricted" bind:group={form.toolsMode} />
              Sem restrição, como uma sessão sem especialista
            </label>
            <label>
              <input type="radio" name="toolsMode" value="allowlist" bind:group={form.toolsMode} />
              Lista permitida, somente as ferramentas marcadas chegam a este especialista
            </label>
          </div>
          {#if form.toolsMode === "allowlist"}
            {#if toolsLoadError}
              <p class="sp-muted">Não foi possível carregar o catálogo de ferramentas. Informe abaixo os nomes exatos, um por linha.</p>
              <textarea
                rows="4"
                placeholder="tool_name_one&#10;tool_name_two"
                value={form.tools.join("\n")}
                on:change={(e) => (form.tools = e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))}
              ></textarea>
            {:else}
              <div class="sp-tools-intro">
                <div>
                  <strong>Escolha por pacote</strong>
                  <p>Veja o que cada ferramenta faz antes de liberá-la para este especialista.</p>
                </div>
                <span class="sp-selection-count">{form.tools.length} selecionada{form.tools.length === 1 ? "" : "s"}</span>
              </div>
              <input class="sp-search" type="search" placeholder="Buscar por nome ou descrição…" bind:value={toolQuery} />
              <div class="sp-package-filter" aria-label="Filtrar ferramentas por pacote">
                <button type="button" class:active={!toolPackageFilter} on:click={() => (toolPackageFilter = "")}>Todos <small>{availableTools.length}</small></button>
                {#each toolPackages as pkg (pkg)}
                  <button type="button" class:active={toolPackageFilter === pkg} on:click={() => (toolPackageFilter = toolPackageFilter === pkg ? "" : pkg)}>
                    <i aria-hidden="true">{packageMonogram(pkg)}</i>{pkg} <small>{availableTools.filter((tool) => tool.package === pkg).length}</small>
                  </button>
                {/each}
              </div>
              <div class="sp-tool-list scroll">
                {#each filteredToolGroups as group (group.package)}
                  <section class="sp-tool-package">
                    <header>
                      <span class="sp-package-icon" aria-hidden="true">{packageMonogram(group.package)}</span>
                      <div><strong>{group.package}</strong><span>{group.tools.length} ferramenta{group.tools.length === 1 ? "" : "s"}</span></div>
                    </header>
                    {#each group.tools as t (t.package + ":" + t.name)}
                      <label class="sp-check-row tool">
                        <input
                          type="checkbox"
                          checked={form.tools.includes(t.name)}
                          on:change={() => toggleTool(t.name)}
                        />
                        <span class="sp-tool-copy">
                          <span class="sp-check-name mono">{t.name}</span>
                          <span class="sp-check-desc">{t.description || "Sem descrição fornecida pelo pacote."}</span>
                        </span>
                      </label>
                    {/each}
                  </section>
                {:else}
                  <p class="sp-tool-empty">Nenhuma ferramenta encontrada com estes filtros.</p>
                {/each}
              </div>
            {/if}
          {/if}
        </div>

        {#if providersLoadError}
          <div class="sp-field-row">
            <label class="sp-field">
              <span>Provider</span>
              <input type="text" bind:value={form.provider} placeholder="auto" />
            </label>
            <label class="sp-field">
              <span>Model</span>
              <input type="text" bind:value={form.model} placeholder="auto" />
            </label>
            <label class="sp-field">
              <span>Fallback model</span>
              <input type="text" bind:value={form.fallbackModel} placeholder="none" />
            </label>
          </div>
          <p class="sp-muted">Could not load the configured providers/models — type them exactly as configured.</p>
        {:else}
          <div class="sp-field-row">
            <label class="sp-field">
              <span>Provider</span>
              <select bind:value={form.provider} on:change={() => (form.model = "")}>
                <option value="">auto</option>
                {#each providerOptions as provider (provider)}
                  <option value={provider}>{provider}</option>
                {/each}
              </select>
            </label>
            <label class="sp-field">
              <span>Model</span>
              <select bind:value={form.model}>
                <option value="">auto</option>
                {#each modelOptionsForProvider as access (access.id)}
                  <option value={access.model}>{access.name} ({access.providerLabel})</option>
                {/each}
              </select>
            </label>
            <label class="sp-field">
              <span>Fallback model</span>
              <select bind:value={form.fallbackModel}>
                <option value="">none</option>
                {#each modelOptionsForProvider as access (access.id)}
                  <option value={access.model}>{access.name} ({access.providerLabel})</option>
                {/each}
              </select>
            </label>
          </div>
          <p class="sp-muted">Provider/model list comes from the aurora pools already configured and authenticated. Leave "auto" to keep the session's normal routing.</p>
        {/if}
      </div>
    {:else if detailLoading}
      <p class="sp-muted">Loading…</p>
    {:else if detail}
      <div class="sp-panel" transition:fade={{ duration: 120 }}>
        <div class="sp-panel-head">
          <h2>{detail.name}</h2>
          {#if detail.kind === "custom"}
            <div class="sp-actions">
              <button class="sp-btn" on:click={() => startEdit(detail)}>Edit</button>
              <button class="sp-btn danger" on:click={() => remove(detail.id)}>Delete</button>
            </div>
          {:else}
            <span class="sp-badge">from package</span>
          {/if}
        </div>
        {#if detail.description}<p class="sp-desc">{detail.description}</p>{/if}

        {#if detail.agents?.length}
          <p class="sp-meta"><strong>Composed AGENT.md:</strong> {detail.agents.join(" → ")}</p>
        {/if}
        <p class="sp-meta">
          <strong>Tools:</strong>
          {detail.tools ? `${detail.tools.length} allowed (${detail.tools.join(", ")})` : "unrestricted"}
        </p>
        {#if detail.model}
          <p class="sp-meta">
            <strong>Model:</strong> {detail.provider ? `${detail.provider} / ` : ""}{detail.model}
            {#if detail.fallbackModel}<span> (fallback: {detail.fallbackModel})</span>{/if}
          </p>
        {/if}

        <div class="sp-field">
          <span>Composed prompt</span>
          <pre class="sp-preview">{detail.composedPrompt || "(empty)"}</pre>
        </div>
      </div>
    {:else}
      <div class="sp-empty"><strong>Escolha um especialista</strong><span>Ou crie um perfil para combinar instruções, ferramentas e um modelo.</span><button class="sp-btn" on:click={startCreate}>Criar especialista</button></div>
    {/if}
  </main>

</div>

<style>
  .sp-wrap {
    --ink-1: var(--tk-text, #f5f5f5);
    --ink-2: var(--tk-muted, #888888);
    --ink-3: var(--tk-muted-2, rgba(136, 136, 136, .5));
    --hair-1: var(--tk-border, rgba(255,255,255,.09));
    --hair-2: var(--tk-border-hi, rgba(255,255,255,.16));
    --hover-wash: var(--tk-surface-2, #1f1f1f);
    --press-wash: var(--tk-surface-2, #1f1f1f);
    --sheet: var(--tk-bg, #111111);
    --raised: var(--tk-surface, #181818);
    --r-sm: 8px;
    --r-md: 12px;
    --accent: var(--tk-accent, #f5f5f5);
    --on-accent: var(--tk-on-accent, #111111);
    --tk-font: 'Ubuntu', system-ui, sans-serif;

    display: grid;
    grid-template-columns: 240px minmax(0, 1fr) 300px;
    gap: 0;
    height: 100%;
    min-height: 100vh;
    color: var(--ink-1);
    background: var(--sheet);
    font: 400 13px/1.45 var(--tk-font);
  }

  .sp-list {
    border-right: 1px solid var(--hair-1);
    padding: 18px 12px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .sp-list-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .sp-list-head h1 {
    font-size: 14px;
    font-weight: 700;
    margin: 0;
  }
  .sp-group-label {
    margin-top: 8px;
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-3);
  }
  .sp-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
    text-align: left;
    padding: 8px 9px;
    border: 1px solid transparent;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--ink-1);
    cursor: pointer;
    font: inherit;
  }
  .sp-row:hover {
    background: var(--hover-wash);
  }
  .sp-row.selected {
    background: var(--press-wash);
    border-color: var(--hair-2);
  }
  .sp-row-name {
    font-size: 12.5px;
    font-weight: 600;
  }
  .sp-row-desc {
    font-size: 11px;
    color: var(--ink-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sp-search {
    width: 100%;
    box-sizing: border-box;
    padding: 7px 9px;
    font: inherit;
    font-size: 12.5px;
    color: var(--ink-1);
    background: var(--raised);
    border: 1px solid var(--hair-1);
    border-radius: var(--r-sm);
    outline: none;
  }
  .sp-search:focus {
    border-color: var(--hair-2);
  }

  .sp-detail {
    padding: 28px clamp(20px, 4vw, 52px) 48px;
    overflow-y: auto;
  }
  .sp-panel {
    max-width: 780px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .sp-panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .sp-panel-head h2 {
    font-size: 17px;
    font-weight: 700;
    margin: 0;
  }
  .sp-actions {
    display: flex;
    gap: 8px;
  }
  .sp-badge {
    font-size: 10.5px;
    color: var(--ink-3);
    border: 1px solid var(--hair-1);
    border-radius: 5px;
    padding: 2px 6px;
  }
  .sp-desc {
    margin: -8px 0 0;
    color: var(--ink-2);
  }
  .sp-meta {
    margin: 0;
    font-size: 12px;
    color: var(--ink-2);
  }
  .sp-meta strong {
    color: var(--ink-1);
    font-weight: 600;
  }

  .sp-btn {
    padding: 7px 12px;
    font: inherit;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--ink-1);
    background: var(--raised);
    border: 1px solid var(--hair-1);
    border-radius: var(--r-sm);
    cursor: pointer;
  }
  .sp-btn:hover {
    background: var(--hover-wash);
  }
  .sp-btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
  }
  .sp-btn.danger {
    color: #f87171;
    border-color: rgba(248, 113, 113, 0.35);
  }
  .sp-btn.tiny {
    padding: 4px 8px;
    font-size: 11px;
  }
  .sp-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .sp-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .sp-field > span:first-child {
    font-size: 11px;
    font-weight: 600;
    color: var(--ink-2);
  }
  .sp-field-row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }
  .sp-field input[type="text"],
  .sp-field select,
  .sp-field textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    font: inherit;
    font-size: 12.5px;
    color: var(--ink-1);
    background: var(--raised);
    border: 1px solid var(--hair-1);
    border-radius: var(--r-sm);
    outline: none;
    resize: vertical;
  }
  .sp-field input[type="text"]:focus,
  .sp-field select:focus,
  .sp-field textarea:focus {
    border-color: var(--hair-2);
  }

  .sp-preview-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .sp-preview {
    margin: 0;
    padding: 10px 12px;
    max-height: 260px;
    overflow: auto;
    white-space: pre-wrap;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--ink-2);
    background: var(--raised);
    border: 1px solid var(--hair-1);
    border-radius: var(--r-md);
  }

  .sp-agent-list,
  .sp-tool-list {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--hair-1);
    border-radius: var(--r-md);
    overflow: hidden;
  }
  .sp-tool-list.scroll {
    max-height: 420px;
    overflow-y: auto;
  }
  .sp-tools-intro { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
  .sp-tools-intro strong { font-size:13px; }
  .sp-tools-intro p { margin:2px 0 0; color:var(--ink-2); font-size:11.5px; }
  .sp-selection-count { flex:none; padding:3px 7px; border:1px solid var(--hair-1); border-radius:999px; color:var(--ink-2); font-size:10.5px; white-space:nowrap; }
  .sp-package-filter { display:flex; gap:5px; overflow-x:auto; padding:1px 0 3px; scrollbar-width:thin; }
  .sp-package-filter button { display:inline-flex; align-items:center; gap:5px; flex:none; padding:5px 8px; border:1px solid var(--hair-1); border-radius:999px; color:var(--ink-2); background:transparent; font:500 11px var(--tk-font); cursor:pointer; }
  .sp-package-filter button:hover, .sp-package-filter button.active { color:var(--ink-1); border-color:var(--hair-2); background:var(--hover-wash); }
  .sp-package-filter i { display:grid; place-items:center; width:15px; height:15px; border-radius:4px; color:var(--on-accent); background:var(--accent); font:700 7px/1 var(--tk-font); font-style:normal; }
  .sp-package-filter small { color:var(--ink-3); font:inherit; }
  .sp-tool-package + .sp-tool-package { border-top:1px solid var(--hair-1); }
  .sp-tool-package header { display:flex; align-items:center; gap:8px; padding:10px; color:var(--ink-1); background:color-mix(in srgb, var(--raised) 78%, var(--sheet)); }
  .sp-tool-package header strong { display:block; font-size:12px; line-height:1.2; }
  .sp-tool-package header span:not(.sp-package-icon) { display:block; margin-top:1px; color:var(--ink-3); font-size:10px; }
  .sp-package-icon { display:grid; place-items:center; flex:none; width:25px; height:25px; border:1px solid var(--hair-2); border-radius:7px; color:var(--ink-1); background:var(--sheet); font:700 9px/1 var(--tk-font); }
  .sp-check-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 7px 10px;
    font-size: 12px;
    cursor: pointer;
  }
  .sp-check-row:hover {
    background: var(--hover-wash);
  }
  .sp-check-row + .sp-check-row {
    border-top: 1px solid var(--hair-1);
  }
  .sp-check-row.tool { align-items:flex-start; padding:9px 10px; }
  .sp-check-row.tool + .sp-check-row.tool { border-top:1px solid var(--hair-1); }
  .sp-tool-copy { display:flex; min-width:0; flex-direction:column; gap:2px; }
  .sp-check-name {
    font-weight: 600;
  }
  .sp-check-name.mono {
    font-family: var(--font-mono, ui-monospace, monospace);
  }
  .sp-check-desc {
    color: var(--ink-3);
    font-size: 11px;
  }
  .sp-tool-empty { margin:0; padding:18px 12px; color:var(--ink-3); font-size:12px; text-align:center; }

  .sp-order-list {
    margin: 8px 0 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .sp-order-list li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 9px;
    font-size: 12px;
    background: var(--raised);
    border: 1px solid var(--hair-1);
    border-radius: var(--r-sm);
  }
  .sp-order-btns button {
    width: 22px;
    height: 22px;
    border: 1px solid var(--hair-1);
    background: transparent;
    color: var(--ink-2);
    border-radius: 5px;
    cursor: pointer;
  }
  .sp-order-btns button:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .sp-tools-mode {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 12px;
    color: var(--ink-2);
  }
  .sp-tools-mode label {
    display: flex;
    align-items: center;
    gap: 7px;
    cursor: pointer;
  }

  .sp-muted {
    color: var(--ink-3);
    font-size: 12px;
  }
  .sp-error {
    color: #f87171;
    font-size: 12px;
    margin: -6px 0 0;
  }
  .sp-trigger-card {
    padding: 16px;
    border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--hair-1));
    border-radius: var(--r-md);
    background: var(--raised);
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .sp-section-head, .sp-trigger-summary { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
  .sp-section-head h3 { margin: 3px 0 4px; font-size: 14px; }
  .sp-section-head p { margin: 0; max-width: 500px; color: var(--ink-2); line-height: 1.45; font-size: 12px; }
  .sp-kicker { display: block; color: var(--accent); font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  .sp-switch { padding: 6px 10px; border: 1px solid var(--hair-2); border-radius: 999px; background: transparent; color: var(--ink-2); font: inherit; font-size: 11px; cursor: pointer; }
  .sp-switch.active { color: var(--on-accent); background: var(--accent); border-color: var(--accent); }
  .sp-event-history { border-top: 1px solid var(--hair-1); padding-top: 10px; }
  .sp-event-row { display: flex; width: 100%; justify-content: space-between; padding: 7px 0; border: 0; border-bottom: 1px solid var(--hair-1); background: transparent; color: var(--ink-2); cursor: pointer; text-align: left; }
  .sp-event-row:hover { color: var(--ink-1); }
  .sp-event-row code { color: var(--ink-1); font-size: 11px; }
  .sp-event-row span { font-size: 10px; }
  .sp-trigger-summary { padding: 12px; border: 1px solid var(--hair-1); border-radius: var(--r-sm); background: var(--raised); color: var(--ink-2); font-size: 11px; }
  .sp-trigger-summary strong { display: block; margin-top: 4px; color: var(--ink-1); font-family: var(--font-mono, ui-monospace, monospace); font-size: 12px; }

  .sp-page-head { display:flex; align-items:flex-end; justify-content:space-between; gap:20px; max-width:780px; margin:0 0 30px; padding-bottom:20px; border-bottom:1px solid var(--hair-1); }
  .sp-page-head h1 { margin:2px 0 4px; font-size:26px; letter-spacing:-.035em; line-height:1.1; }
  .sp-page-head p { margin:0; color:var(--ink-2); }
  .sp-eyebrow { display:block; color:var(--ink-3); font:600 10px/1 var(--font-mono, ui-monospace, monospace); letter-spacing:.09em; }
  .mobile-new { display:inline-block; }
  .sp-empty { max-width:500px; min-height:180px; display:flex; flex-direction:column; align-items:flex-start; justify-content:center; gap:9px; color:var(--ink-2); }
  .sp-empty strong { color:var(--ink-1); font-size:16px; }
  .sp-empty .sp-btn { margin-top:8px; }
  .sp-template-help { margin:0; padding:9px 10px; border-radius:var(--r-sm); background:var(--sheet); }
  .sp-template-help code { color:var(--ink-1); }

  .sp-activity { min-width:0; padding:22px 16px; border-left:1px solid var(--hair-1); background:var(--raised); overflow-y:auto; }
  .sp-activity-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
  .sp-activity h2 { margin:3px 0 0; font-size:14px; }
  .sp-activity-copy { margin:12px 0; color:var(--ink-2); font-size:12px; line-height:1.45; }
  .sp-icon-btn { width:28px; height:28px; padding:0; border:1px solid var(--hair-1); border-radius:var(--r-sm); background:transparent; color:var(--ink-2); font:16px/1 var(--tk-font); cursor:pointer; }
  .sp-icon-btn:hover { color:var(--ink-1); border-color:var(--hair-2); }
  .sp-icon-btn:disabled { opacity:.45; cursor:default; }
  .sp-live { display:flex; align-items:center; gap:6px; margin:0 0 14px; color:var(--ink-2); font-size:11px; }
  .sp-live i { width:6px; height:6px; border-radius:50%; background:#56b984; box-shadow:0 0 0 3px color-mix(in srgb, #56b984 15%, transparent); }
  .sp-live i.offline { background:#cf6c6c; box-shadow:0 0 0 3px color-mix(in srgb, #cf6c6c 15%, transparent); }
  .sp-event-feed { display:flex; flex-direction:column; gap:7px; }
  .sp-event-card { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:4px 8px; width:100%; padding:10px; border:1px solid var(--hair-1); border-radius:var(--r-sm); background:var(--sheet); color:var(--ink-2); text-align:left; cursor:pointer; font:inherit; transition:border-color 160ms ease-out, transform 160ms ease-out; }
  .sp-event-card:hover { border-color:var(--hair-2); transform:translateY(-1px); }
  .sp-event-card code { overflow:hidden; color:var(--ink-1); text-overflow:ellipsis; white-space:nowrap; font:600 11px var(--font-mono, ui-monospace, monospace); }
  .sp-event-card span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:10px; }
  .sp-event-card time { grid-column:2; grid-row:1 / span 2; align-self:center; color:var(--ink-3); font:10px var(--font-mono, ui-monospace, monospace); }
  .sp-event-empty { padding:16px 4px; color:var(--ink-3); font-size:12px; line-height:1.5; }

  @media (max-width: 720px) {
    .sp-wrap {
      grid-template-columns: 1fr;
    }
    .sp-list {
      border-right: none;
      border-bottom: 1px solid var(--hair-1);
      max-height: 40vh;
    }
    .sp-field-row {
      grid-template-columns: 1fr;
    }
    .sp-detail { padding:20px 16px 30px; }
    .sp-page-head { margin-bottom:22px; align-items:flex-start; }
    .sp-page-head h1 { font-size:23px; }
    .mobile-new { display:inline-block; }
    .sp-activity { border-left:0; border-top:1px solid var(--hair-1); max-height:48vh; }
  }

  @media (min-width: 721px) { .sp-list-head .primary { display:none; } }
</style>
