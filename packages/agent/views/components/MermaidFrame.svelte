<script>
    import { onMount, tick } from "svelte";
  
    export let source = "";
  
    let rendered = "";
    let error = null;
    let mermaid;
    let renderId = 0;
  
    // --- Estado de zoom/pan ---
    let scale = 1;
    let translateX = 0;
    let translateY = 0;
    let isDragging = false;
    let startX = 0;
    let startY = 0;
  
    // dimensões "naturais" do SVG (vindas do viewBox)
    let baseWidth = 0;
    let baseHeight = 0;
  
    // pinça (touch)
    let pinchStartDist = 0;
    let pinchStartScale = 1;
  
    let containerEl;
    let svgWrapperEl;
  
    const MIN_SCALE = 0.1;
    const MAX_SCALE = 6;
  
    function clampScale(v) {
      return Math.min(MAX_SCALE, Math.max(MIN_SCALE, v));
    }
  
    // Aplica o tamanho real ao SVG (mantém ele nítido em qualquer zoom)
    function applyScale() {
      const svgEl = svgWrapperEl?.querySelector("svg");
      if (!svgEl || !baseWidth || !baseHeight) return;
  
      svgEl.style.width = `${baseWidth * scale}px`;
      svgEl.style.height = `${baseHeight * scale}px`;
    }
  
    // Calcula tamanho natural do SVG e ajusta o zoom inicial pra caber no container
    function captureBaseSize() {
      const svgEl = svgWrapperEl?.querySelector("svg");
      if (!svgEl || !containerEl) return;
  
      let w, h;
      const viewBox = svgEl.getAttribute("viewBox");
      if (viewBox) {
        const parts = viewBox.split(/\s+/).map(Number);
        w = parts[2];
        h = parts[3];
      } else {
        const bbox = svgEl.getBBox();
        w = bbox.width;
        h = bbox.height;
      }
  
      baseWidth = w;
      baseHeight = h;
  
      // fit-to-container: começa mostrando o diagrama inteiro
      const containerW = containerEl.clientWidth;
      const containerH = containerEl.clientHeight;
      const fitScale = Math.min(containerW / baseWidth, containerH / baseHeight, 1);
  
      scale = fitScale;
      applyScale();
  
      // centraliza
      translateX = (containerW - baseWidth * scale) / 2;
      translateY = (containerH - baseHeight * scale) / 2;
    }
  
    function handleWheel(e) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      const newScale = clampScale(scale + delta * scale);
  
      const rect = containerEl.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
  
      const scaleRatio = newScale / scale;
      translateX = mouseX - (mouseX - translateX) * scaleRatio;
      translateY = mouseY - (mouseY - translateY) * scaleRatio;
  
      scale = newScale;
      applyScale();
    }
  
    function handlePointerDown(e) {
      if (e.pointerType === "touch" && !e.isPrimary) return;
      isDragging = true;
      startX = e.clientX - translateX;
      startY = e.clientY - translateY;
      containerEl.style.cursor = "grabbing";
    }
  
    function handlePointerMove(e) {
      if (!isDragging) return;
      translateX = e.clientX - startX;
      translateY = e.clientY - startY;
    }
  
    function handlePointerUp() {
      isDragging = false;
      if (containerEl) containerEl.style.cursor = "grab";
    }
  
    // --- Pinça (touch) ---
    function getTouchDist(touches) {
      const [a, b] = touches;
      return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
    }
  
    function getTouchMidpoint(touches) {
      const [a, b] = touches;
      return {
        x: (a.clientX + b.clientX) / 2,
        y: (a.clientY + b.clientY) / 2,
      };
    }
  
    function handleTouchStart(e) {
      if (e.touches.length === 2) {
        isDragging = false;
        pinchStartDist = getTouchDist(e.touches);
        pinchStartScale = scale;
      }
    }
  
    function handleTouchMove(e) {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dist = getTouchDist(e.touches);
        const ratio = dist / pinchStartDist;
        const newScale = clampScale(pinchStartScale * ratio);
  
        const rect = containerEl.getBoundingClientRect();
        const mid = getTouchMidpoint(e.touches);
        const mouseX = mid.x - rect.left;
        const mouseY = mid.y - rect.top;
  
        const scaleRatio = newScale / scale;
        translateX = mouseX - (mouseX - translateX) * scaleRatio;
        translateY = mouseY - (mouseY - translateY) * scaleRatio;
  
        scale = newScale;
        applyScale();
      }
    }
  
    // Duplo clique/duplo toque pra refazer o "fit to view"
    function handleDoubleClick() {
      captureBaseSize();
    }
  
    async function renderDiagram(src) {
      if (!src?.trim() || !mermaid) {
        rendered = "";
        return;
      }
  
      const currentRenderId = ++renderId;
      error = null;
  
      const uid = "mermaid-" + Math.random().toString(36).slice(2, 11);
  
      try {
        await mermaid.parse(src.trim());
        const { svg } = await mermaid.render(uid, src.trim());
  
        if (currentRenderId === renderId) {
          rendered = svg;
          await tick();
          captureBaseSize();
        }
      } catch (e) {
        if (currentRenderId === renderId) {
          error = e?.message ?? "Erro ao renderizar diagrama";
          rendered = "";
        }
  
        const orphanNode = document.getElementById(uid);
        if (orphanNode) orphanNode.remove();
  
        const orphanErrorNode = document.getElementById(`d${uid}`);
        if (orphanErrorNode) orphanErrorNode.remove();
      }
    }
  
    onMount(async () => {
      const mod = await import("mermaid");
      mermaid = mod.default;
      mermaid.initialize({
        startOnLoad: false,
        theme: "dark",
        themeVariables: {
          darkMode: true,
          background: "transparent",
          primaryColor: "#2a2a2a",
          primaryTextColor: "#e0e0e0",
          primaryBorderColor: "var(--w15, rgba(255,255,255,0.15))",
          lineColor: "var(--w25, rgba(255,255,255,0.25))",
          secondaryColor: "#1a1a1a",
          tertiaryColor: "#111",
          edgeLabelBackground: "transparent",
          fontFamily: "inherit",
          fontSize: "13px",
        },
        securityLevel: "loose",
      });
  
      await renderDiagram(source);
    });
  
    $: if (mermaid && source !== undefined) {
      renderDiagram(source);
    }
  </script>
  
  <div class="mermaid-wrap">
    {#if error}
      <pre class="mermaid-error">{error}</pre>
    {:else if rendered}
      <div
        class="mermaid-viewport"
        bind:this={containerEl}
        on:wheel={handleWheel}
        on:pointerdown={handlePointerDown}
        on:pointermove={handlePointerMove}
        on:pointerup={handlePointerUp}
        on:pointerleave={handlePointerUp}
        on:touchstart={handleTouchStart}
        on:touchmove={handleTouchMove}
        on:dblclick={handleDoubleClick}
      >
        <div
          class="mermaid-pan"
          style="transform: translate({translateX}px, {translateY}px);"
        >
          <div class="mermaid-svg" bind:this={svgWrapperEl}>
            {@html rendered}
          </div>
        </div>
      </div>
    {:else}
      <div class="mermaid-loading">
        <span class="pulse-dots"><span /><span /><span /></span>
      </div>
    {/if}
  </div>
  
  <style>
    .mermaid-wrap {
      width: 100%;
      margin: 10px 0;
      border: 1px solid var(--border, var(--w15, rgba(255, 255, 255, 0.15)));
      border-radius: 10px;
      background: rgba(0, 0, 0, 0.3);
      overflow: hidden;
    }
  
    .mermaid-viewport {
      width: 100%;
      height: 420px;
      overflow: hidden;
      cursor: grab;
      position: relative;
      touch-action: none;
    }
  
    .mermaid-pan {
      display: inline-block;
      will-change: transform;
    }
  
    .mermaid-svg {
      display: inline-block;
    }
  
    :global(.mermaid-svg svg) {
      display: block;
      border-radius: 6px;
    }
  
    .mermaid-error {
      font-family: var(--font-mono, monospace);
      font-size: 11px;
      color: #ff6b6b;
      white-space: pre-wrap;
      word-break: break-all;
      margin: 16px;
    }
  
    .mermaid-loading {
      display: flex;
      justify-content: center;
      padding: 20px 0;
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
      background: var(--txt, #fff);
      opacity: 0.3;
      animation: dot-pulse 1.3s infinite;
    }
    .pulse-dots span:nth-child(2) { animation-delay: 0.18s; }
    .pulse-dots span:nth-child(3) { animation-delay: 0.36s; }
  
    @keyframes dot-pulse {
      0%, 80%, 100% { opacity: 0.15; transform: scale(0.8); }
      40% { opacity: 1; transform: scale(1.1); }
    }
  </style>