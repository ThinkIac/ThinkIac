<script>
  export let selected = "none";
  export let saving = false;
  export let options = []; // [{id, kind: "generic"|"custom", name, description}]
  export let onSelect = () => {};

  let query = "";

  $: filtered = (() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.name.toLowerCase().includes(q) ||
        (o.description || "").toLowerCase().includes(q),
    );
  })();
  $: customOptions = filtered.filter((o) => o.kind === "custom");
  $: genericOptions = filtered.filter((o) => o.kind === "generic");
</script>

<div class="specialist-selector" aria-label="Specialist selection">
  <input
    class="specialist-search"
    type="text"
    placeholder="Search specialists…"
    bind:value={query}
  />

  <button
    class="specialist-row press"
    class:selected={selected === "none"}
    disabled={saving}
    on:click={() => onSelect("none")}
  >
    <span class="specialist-copy"><strong>None</strong>
      <small>No extra prompt, no tool restriction, normal model routing.</small></span>
  </button>

  {#if customOptions.length}
    <div class="specialist-group">
      <span class="specialist-group-name">Custom</span>
      {#each customOptions as option (option.id)}
        <button
          class="specialist-row press"
          class:selected={selected === option.id}
          disabled={saving}
          on:click={() => onSelect(option.id)}
        >
          <span class="specialist-copy">
            <strong>{option.name}</strong>
            {#if option.description}<small>{option.description}</small>{/if}
          </span>
          {#if selected === option.id}
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true"><path d="M3.5 8.2 6.6 11l5.9-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
          {/if}
        </button>
      {/each}
    </div>
  {/if}

  {#if genericOptions.length}
    <div class="specialist-group">
      <span class="specialist-group-name">From packages</span>
      {#each genericOptions as option (option.id)}
        <button
          class="specialist-row press"
          class:selected={selected === option.id}
          disabled={saving}
          on:click={() => onSelect(option.id)}
        >
          <span class="specialist-copy">
            <strong>{option.name}</strong>
            {#if option.description}<small>{option.description}</small>{/if}
          </span>
          {#if selected === option.id}
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true"><path d="M3.5 8.2 6.6 11l5.9-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
          {/if}
        </button>
      {/each}
    </div>
  {/if}

  {#if query.trim() && !customOptions.length && !genericOptions.length}
    <p class="specialist-empty">No specialist matches "{query.trim()}".</p>
  {/if}
</div>

<style>
  .specialist-selector { display: grid; gap: 2px; }
  .specialist-search {
    width: 100%;
    box-sizing: border-box;
    padding: 7px 9px;
    font: inherit;
    font-size: 12px;
    color: var(--ink-1, var(--tk-text));
    background: transparent;
    border: 0;
    border-bottom: 1px solid var(--hair-1, var(--tk-border));
    border-radius: 0;
    outline: none;
  }
  .specialist-search:focus { border-color: var(--hair-2, var(--tk-border-hi, var(--tk-border))); }
  .specialist-group { display: grid; gap: 1px; padding-top: 5px; }
  .specialist-group-name { padding: 0 8px; color: var(--ink-3, var(--tk-muted)); font: 700 10px/1 var(--font-mono, var(--tk-mono)); letter-spacing: .06em; text-transform: uppercase; }
  .specialist-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; min-width: 0; padding: 7px 8px; border: 0; border-radius: 4px; background: transparent; color: var(--ink-1, var(--tk-text)); text-align: left; cursor: pointer; }
  .specialist-row:hover, .specialist-row.selected { background: var(--hover-wash, var(--tk-surface-2)); }
  .specialist-row:disabled { cursor: wait; opacity: .6; }
  .specialist-copy { display: grid; gap: 2px; min-width: 0; }
  strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 500; }
  small { color: var(--ink-3, var(--tk-muted)); font-size: 11px; line-height: 1.3; }
  .specialist-empty { margin: 4px 8px; color: var(--ink-3, var(--tk-muted)); font-size: 11px; }
</style>
