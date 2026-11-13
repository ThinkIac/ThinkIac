<script>
  import { createEventDispatcher } from 'svelte'

  export let agents = []
  export let selected = 'agent'
  export let disabled = false

  const dispatch = createEventDispatcher()

  function select(event) {
    dispatch('selectAgent', event.currentTarget.value)
  }
</script>

<label class="agent-selector" title="Agent for this session">
  <span class="agent-mark" aria-hidden="true"></span>
  <select value={selected} on:change={select} {disabled} aria-label="Agent for this session">
    {#each agents as agent (agent.id)}
      <option value={agent.id} disabled={!agent.available}>
        {agent.name}{agent.available ? '' : ' — em breve'}
      </option>
    {/each}
  </select>
  <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M5 6.5l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
</label>

<style>
  .agent-selector { min-width:0; height:30px; display:flex; align-items:center; gap:6px; padding:0 7px; border:1px solid var(--tk-border); border-radius:var(--tk-radius-md); background:var(--tk-surface); color:var(--tk-muted); }
  .agent-selector:focus-within { border-color:var(--tk-border-hi); color:var(--tk-text); }
  .agent-mark { width:7px; height:7px; flex:0 0 auto; border-radius:50%; background:currentColor; opacity:.8; }
  select { min-width:0; max-width:112px; border:0; outline:0; appearance:none; background:transparent; color:inherit; font:500 11px var(--tk-font); cursor:pointer; }
  select:disabled { cursor:default; opacity:.55; }
  option { background:var(--tk-surface); color:var(--tk-text); }
  svg { width:12px; height:12px; flex:0 0 auto; }
  @media (max-width:520px) {
    .agent-selector { max-width:96px; }
    select { max-width:64px; }
  }
</style>
