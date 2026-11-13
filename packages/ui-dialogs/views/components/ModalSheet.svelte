<script>
  import { createEventDispatcher, tick } from 'svelte';

  export let open = false;
  export let label = 'Information';
  export let size = 'compact';
  export let centered = false;

  const dispatch = createEventDispatcher();
  let dialog;

  $: if (open) tick().then(() => dialog?.focus());

  function close() { dispatch('close'); }
  function keydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  }
</script>

{#if open}
  <!-- Click outside and Escape always close a sheet. The body remains fully
       supplied by the consumer, so package, chat and artifact sheets share
       mechanics without forcing one data model. -->
  <div class:centered class="modal-sheet-backdrop" role="presentation" on:click={close} on:keydown={keydown}>
    <section bind:this={dialog} class:wide={size === 'wide'} class="modal-sheet" role="dialog" aria-modal="true" aria-label={label} tabindex="-1" on:click|stopPropagation>
      <button type="button" class="modal-sheet-close" aria-label={`Close ${label}`} on:click={close}>×</button>
      <slot></slot>
    </section>
  </div>
{/if}

<style>
  .modal-sheet-backdrop { position:fixed; inset:0; z-index:2147483646; display:grid; align-items:end; justify-items:center; padding:1rem 1rem max(1rem, env(safe-area-inset-bottom)); background:color-mix(in srgb, var(--tk-bg) 78%, transparent); backdrop-filter:blur(14px); }
  .modal-sheet-backdrop.centered { align-items:center; padding: max(1rem, env(safe-area-inset-top)) 1rem max(1rem, env(safe-area-inset-bottom)); }
  .modal-sheet { position:relative; width:min(100%, 23rem); max-height:calc(100dvh - 2rem); overflow:auto; border:1px solid color-mix(in srgb, var(--tk-border) 72%, transparent); border-radius:1.1rem; padding:1.15rem; background:color-mix(in srgb, var(--tk-surface) 96%, transparent); color:var(--tk-text); box-shadow:0 1.2rem 3.5rem color-mix(in srgb, var(--tk-bg) 65%, transparent); outline:none; }
  .modal-sheet.wide { width:min(100%, 42rem); }
  .modal-sheet-close { position:absolute; top:.55rem; right:.55rem; width:1.8rem; height:1.8rem; border:0; border-radius:999px; background:transparent; color:var(--tk-text-muted, var(--tk-text)); font:400 1.15rem/1 system-ui; cursor:pointer; }
  .modal-sheet-close:hover, .modal-sheet-close:focus-visible { background:var(--tk-surface-2); color:var(--tk-text); outline:none; }
</style>
