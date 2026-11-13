<script>
    import { renderers, getProps } from "../lib/renderers.js";
  
    export let type;        // "d2" | "mermaid" | "html" | "markmap" | ...
    export let source;      // conteúdo do bloco
    export let partial = false; // true = preview progressivo durante streaming
  
    let component = null;
  
    // Carrega o componente dinamicamente ao montar ou quando o tipo muda
    $: if (type && renderers[type]) {
      renderers[type]().then((m) => {
        component = m.default;
      });
    }
  
    // Props resolvidas pelo registry (propMap por tipo). Default: { source }.
    $: props = getProps(type, source);
  </script>
  
  {#if component}
    <div class="embedded-component-wrap" class:open-block-preview={partial}>
      <svelte:component this={component} {...props} />
      {#if partial}
        <div class="open-block-overlay">
          <span class="pulse-dots"><span /><span /><span /></span>
        </div>
      {/if}
    </div>
  {/if}
  
  <style>
    .embedded-component-wrap {
      position: relative;
      width: 100%;
    }
  
    .open-block-preview {
      opacity: 0.85;
      transition: opacity 0.4s ease;
    }
  
    .open-block-overlay {
      position: absolute;
      bottom: 8px;
      right: 8px;
      display: flex;
      align-items: center;
      gap: 4px;
      background: rgba(0, 0, 0, 0.55);
      border: 1px solid var(--w12, rgba(255, 255, 255, 0.12));
      border-radius: 12px;
      padding: 3px 8px;
      pointer-events: none;
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
    }
  
    .pulse-dots {
      display: inline-flex;
      gap: 3px;
      align-items: center;
    }
  
    .pulse-dots span {
      width: 3px;
      height: 3px;
      border-radius: 50%;
      background: var(--txt);
      opacity: 0.3;
      animation: dot-pulse 1.3s infinite;
    }
    .pulse-dots span:nth-child(2) { animation-delay: 0.18s; }
    .pulse-dots span:nth-child(3) { animation-delay: 0.36s; }
  
    @keyframes dot-pulse {
      0%, 80%, 100% { opacity: 0.15; transform: scale(0.8); }
      40%           { opacity: 1;    transform: scale(1.1); }
    }
  </style>