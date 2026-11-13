<script>
  // Ícone de uma entrada da InputBar. Existe porque a mesma decisão de
  // desenho — svg nativo, ícone do pacote, ou monograma — aparece na barra,
  // na caixa de excedentes e no editor; duplicar a cadeia de {#if} nos três
  // lugares garantiria que um dia eles divergissem.
  //
  // Nativas trazem o traço aqui; de pacote usam o ícone do próprio pacote.
  // Sem ícone, monograma do label — o DESIGN.md proíbe emoji na UI.
  export let entry;
  export let size = 17;

  function monogram(e) {
    const txt = (e?.label || "?").trim();
    const partes = txt.split(/\s+/).filter(Boolean);
    if (partes.length >= 2) return (partes[0][0] + partes[1][0]).toUpperCase();
    return txt.slice(0, 2).toUpperCase();
  }
</script>

{#if entry.native === "attach"}
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
       stroke-linecap="round" stroke-linejoin="round" width={size} height={size}>
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
  </svg>
{:else if entry.native === "voice"}
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
       stroke-linecap="round" stroke-linejoin="round" width={size} height={size}>
    <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
    <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4" />
  </svg>
{:else if entry.native === "location"}
  <svg viewBox="0 0 24 24" fill="none" width={size} height={size} aria-hidden="true">
    <path d="M12 21s6-5.1 6-11a6 6 0 10-12 0c0 5.9 6 11 6 11z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    <circle cx="12" cy="10" r="2.1" stroke="currentColor" stroke-width="1.6"/>
  </svg>
{:else if entry.command === "toggle-listen-session"}
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
       stroke-linecap="round" stroke-linejoin="round" width={size} height={size}>
    <path d="M4 13v-2a8 8 0 0116 0v2" />
    <path d="M4 12h2.5v7H6a2 2 0 01-2-2v-5zM20 12h-2.5v7h.5a2 2 0 002-2v-5z" />
  </svg>
{:else if entry.native === "approval"}
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
       stroke-linecap="round" stroke-linejoin="round" width={size} height={size}>
    <path d="M12 3l7 3v5c0 4.2-2.8 7.6-7 10-4.2-2.4-7-5.8-7-10V6l7-3z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
{:else if entry.iconSvg}
  <span class="entry-icon">{@html entry.iconSvg}</span>
{:else if entry.icon}
  <img class="entry-icon" src={entry.icon} alt="" />
{:else}
  <span class="entry-mono">{monogram(entry)}</span>
{/if}

<style>
  .entry-icon {
    display: inline-flex;
    width: 17px;
    height: 17px;
    align-items: center;
    justify-content: center;
  }
  .entry-icon :global(svg) {
    width: 100%;
    height: 100%;
  }
  .entry-mono {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.02em;
    line-height: 1;
  }
</style>
