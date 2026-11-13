<script>
  export let selected = "auto";
  export let saving = false;
  export let options = [];
  export let onSelect = () => {};

  $: grouped = options.reduce((groups, option) => {
    if (option.id === "auto") return groups;
    const provider = option.providerLabel || option.provider || "Other";
    (groups[provider] ||= []).push(option);
    return groups;
  }, {});
</script>

<div class="model-selector" aria-label="Model selection">
  {#each options.filter((option) => option.id === "auto") as option (option.id)}
    <button class="model-row press" class:selected={selected === option.id} disabled={saving} on:click={() => onSelect(option.id)}>
      <span class="model-copy"><strong>{option.label}</strong><small>{option.description}</small></span>
    </button>
  {/each}

  {#each Object.entries(grouped) as [provider, models] (provider)}
    <div class="provider-group">
      <span class="provider-name">{provider}</span>
      {#each models as option (option.id)}
        <button class="model-row press" class:selected={selected === option.id} disabled={saving} on:click={() => onSelect(option.id)}>
          <span class="model-copy">
            <strong>{option.label}</strong>
            {#if option.purpose}<small>{option.purpose}{option.description ? ` · ${option.description}` : ""}</small>{/if}
          </span>
          {#if selected === option.id}
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true"><path d="M3.5 8.2 6.6 11l5.9-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
          {/if}
        </button>
      {/each}
    </div>
  {/each}
</div>

<style>
  .model-selector { display: grid; gap: 6px; }
  .provider-group { display: grid; gap: 3px; padding-top: 7px; border-top: 1px solid var(--hair-1, var(--tk-border)); }
  .provider-name { padding: 0 8px; color: var(--ink-3, var(--tk-muted)); font: 700 10px/1 var(--font-mono, var(--tk-mono)); letter-spacing: .06em; text-transform: uppercase; }
  .model-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; min-width: 0; padding: 8px; border: 0; border-radius: var(--r-sm, var(--tk-radius-md)); background: transparent; color: var(--ink-1, var(--tk-text)); text-align: left; cursor: pointer; }
  .model-row:hover, .model-row.selected { background: var(--hover-wash, var(--tk-surface-2)); }
  .model-row:disabled { cursor: wait; opacity: .6; }
  .model-copy { display: grid; gap: 2px; min-width: 0; }
  strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 500; }
  small { color: var(--ink-3, var(--tk-muted)); font-size: 11px; line-height: 1.3; }
</style>
