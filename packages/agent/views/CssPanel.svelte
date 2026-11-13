<script>
  import { createEventDispatcher } from 'svelte';
  export let element = null; // { tag, classes, inline, computed, outerHtml, text }
  export let open = false;

  const dispatch = createEventDispatcher();

  let activeSection = 'spacing';
  let inlineMap = {};

  $: if (element) {
    inlineMap = parseInline(element.inline || '');
  }

  function parseInline(str) {
    const map = {};
    str.split(';').forEach(part => {
      const [k, ...vs] = part.split(':');
      if (k && vs.length) map[k.trim()] = vs.join(':').trim();
    });
    return map;
  }

  function val(prop) {
    return inlineMap[prop] ?? element?.computed?.[prop] ?? '';
  }

  function numVal(prop) {
    return parseFloat(val(prop)) || 0;
  }

  function apply(property, value) {
    dispatch('applyCSS', { property, value });
    inlineMap = { ...inlineMap, [property]: value };
  }

  function applyPx(property, value) {
    apply(property, value ? value + 'px' : '');
  }

  const sections = [
    { id: 'spacing',    label: 'Espaço' },
    { id: 'size',       label: 'Tamanho' },
    { id: 'typography', label: 'Texto' },
    { id: 'background', label: 'Fundo' },
    { id: 'border',     label: 'Borda' },
    { id: 'layout',     label: 'Layout' },
  ];

  const fonts = [
    'inherit','sans-serif','serif','monospace',
    'Ubuntu, sans-serif', 'Roboto, sans-serif', 'Open Sans, sans-serif',
    'Poppins, sans-serif', 'Lato, sans-serif', 'Montserrat, sans-serif',
    'Playfair Display, serif', 'Merriweather, serif', 'Georgia, serif',
    'Ubuntu Mono, monospace', 'Fira Code, monospace',
  ];

  const textAligns = ['left','center','right','justify'];
  const displays   = ['block','inline-block','inline','flex','grid','none'];
  const positions  = ['static','relative','absolute','fixed','sticky'];
  const flexDir    = ['row','column','row-reverse','column-reverse'];
  const justifies  = ['flex-start','center','flex-end','space-between','space-around','space-evenly'];
  const aligns     = ['stretch','flex-start','center','flex-end','baseline'];

  function shortColor(cssColor) {
    if (!cssColor) return '#000000';
    if (cssColor.startsWith('#')) return cssColor;
    const m = cssColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return '#000000';
    return '#' + [m[1],m[2],m[3]].map(n => parseInt(n).toString(16).padStart(2,'0')).join('');
  }
</script>

{#if open && element}
<div class="panel" role="complementary" aria-label="Editor de estilos">

  <!-- Element tag badge -->
  <div class="panel-header">
    <div class="el-info">
      <span class="el-tag">&lt;{element.tag}&gt;</span>
      {#if element.classes?.length}
        <span class="el-classes">.{element.classes.join(' .')}</span>
      {/if}
    </div>
    {#if element.text}
      <span class="el-text">"{element.text.slice(0,30)}{element.text.length > 30 ? '…' : ''}"</span>
    {/if}
  </div>

  <!-- Section tabs -->
  <div class="tabs">
    {#each sections as s}
      <button class="tab {activeSection === s.id ? 'active' : ''}" on:click={() => activeSection = s.id}>
        {s.label}
      </button>
    {/each}
  </div>

  <div class="body">

    <!-- ── SPACING ── -->
    {#if activeSection === 'spacing'}
      <div class="box-model">
        <div class="bm-label outer">MARGEM</div>
        <div class="bm-ring outer">
          <input class="bm-side top"    type="number" value={numVal('margin-top')}    on:change={e => applyPx('margin-top',    e.target.value)} title="Margem topo"/>
          <input class="bm-side right"  type="number" value={numVal('margin-right')}  on:change={e => applyPx('margin-right',  e.target.value)} title="Margem direita"/>
          <input class="bm-side bottom" type="number" value={numVal('margin-bottom')} on:change={e => applyPx('margin-bottom', e.target.value)} title="Margem baixo"/>
          <input class="bm-side left"   type="number" value={numVal('margin-left')}   on:change={e => applyPx('margin-left',   e.target.value)} title="Margem esquerda"/>
          <div class="bm-label inner">PADDING</div>
          <div class="bm-ring inner">
            <input class="bm-side top"    type="number" value={numVal('padding-top')}    on:change={e => applyPx('padding-top',    e.target.value)} title="Padding topo"/>
            <input class="bm-side right"  type="number" value={numVal('padding-right')}  on:change={e => applyPx('padding-right',  e.target.value)} title="Padding direita"/>
            <input class="bm-side bottom" type="number" value={numVal('padding-bottom')} on:change={e => applyPx('padding-bottom', e.target.value)} title="Padding baixo"/>
            <input class="bm-side left"   type="number" value={numVal('padding-left')}   on:change={e => applyPx('padding-left',   e.target.value)} title="Padding esquerda"/>
            <div class="bm-center">elemento</div>
          </div>
        </div>
        <div class="row mt-2">
          <label class="lbl">Margem uniforme</label>
          <input type="number" class="inp sm" placeholder="px" on:change={e => {
            ['margin-top','margin-right','margin-bottom','margin-left'].forEach(p => applyPx(p, e.target.value));
          }}/>
        </div>
        <div class="row mt-1">
          <label class="lbl">Padding uniforme</label>
          <input type="number" class="inp sm" placeholder="px" on:change={e => {
            ['padding-top','padding-right','padding-bottom','padding-left'].forEach(p => applyPx(p, e.target.value));
          }}/>
        </div>
      </div>
    {/if}

    <!-- ── SIZE ── -->
    {#if activeSection === 'size'}
      <div class="fields">
        <div class="field-row">
          <label>Largura</label>
          <input type="text" class="inp" value={val('width')} on:change={e => apply('width', e.target.value)} placeholder="auto"/>
        </div>
        <div class="field-row">
          <label>Altura</label>
          <input type="text" class="inp" value={val('height')} on:change={e => apply('height', e.target.value)} placeholder="auto"/>
        </div>
        <div class="field-row">
          <label>Mín. largura</label>
          <input type="text" class="inp" value={val('min-width')} on:change={e => apply('min-width', e.target.value)} placeholder="0"/>
        </div>
        <div class="field-row">
          <label>Mín. altura</label>
          <input type="text" class="inp" value={val('min-height')} on:change={e => apply('min-height', e.target.value)} placeholder="0"/>
        </div>
        <div class="field-row">
          <label>Máx. largura</label>
          <input type="text" class="inp" value={val('max-width')} on:change={e => apply('max-width', e.target.value)} placeholder="none"/>
        </div>
        <div class="field-row">
          <label>Overflow</label>
          <select class="sel" on:change={e => apply('overflow', e.target.value)}>
            {#each ['visible','hidden','auto','scroll'] as o}
              <option value={o} selected={val('overflow') === o}>{o}</option>
            {/each}
          </select>
        </div>
        <div class="field-row">
          <label>Opacidade</label>
          <input type="range" min="0" max="1" step="0.01" value={parseFloat(val('opacity')) || 1}
            on:input={e => apply('opacity', e.target.value)}/>
          <span class="val-badge">{Math.round((parseFloat(val('opacity')) || 1) * 100)}%</span>
        </div>
      </div>
    {/if}

    <!-- ── TYPOGRAPHY ── -->
    {#if activeSection === 'typography'}
      <div class="fields">
        <div class="field-row">
          <label>Cor</label>
          <input type="color" class="inp color" value={shortColor(val('color'))}
            on:input={e => apply('color', e.target.value)}/>
          <span class="val-badge mono">{shortColor(val('color'))}</span>
        </div>
        <div class="field-row">
          <label>Tamanho</label>
          <input type="number" class="inp sm" value={numVal('font-size')}
            on:change={e => applyPx('font-size', e.target.value)}/>
          <span class="unit">px</span>
        </div>
        <div class="field-row">
          <label>Peso</label>
          <select class="sel" on:change={e => apply('font-weight', e.target.value)}>
            {#each [100,200,300,400,500,600,700,800,900] as w}
              <option value={w} selected={parseInt(val('font-weight')) === w}>{w}</option>
            {/each}
          </select>
        </div>
        <div class="field-row">
          <label>Família</label>
          <select class="sel" on:change={e => apply('font-family', e.target.value)}>
            {#each fonts as f}
              <option value={f} selected={val('font-family').includes(f.split(',')[0])}>{f}</option>
            {/each}
          </select>
        </div>
        <div class="field-row">
          <label>Line height</label>
          <input type="number" class="inp sm" step="0.1" value={parseFloat(val('line-height')) || 1.5}
            on:change={e => apply('line-height', e.target.value)}/>
        </div>
        <div class="field-row">
          <label>Letter spacing</label>
          <input type="number" class="inp sm" step="0.5" value={numVal('letter-spacing')}
            on:change={e => applyPx('letter-spacing', e.target.value)}/>
          <span class="unit">px</span>
        </div>
        <div class="field-row">
          <label>Alinhamento</label>
          <div class="btn-group">
            {#each textAligns as a}
              <button class="tog {val('text-align') === a ? 'on' : ''}" on:click={() => apply('text-align', a)} title={a}>
                {#if a === 'left'}⬅{:else if a === 'center'}↔{:else if a === 'right'}➡{:else}≡{/if}
              </button>
            {/each}
          </div>
        </div>
        <div class="field-row">
          <label>Decoração</label>
          <select class="sel" on:change={e => apply('text-decoration', e.target.value)}>
            {#each ['none','underline','line-through','overline'] as d}
              <option value={d} selected={val('text-decoration').includes(d)}>{d}</option>
            {/each}
          </select>
        </div>
      </div>
    {/if}

    <!-- ── BACKGROUND ── -->
    {#if activeSection === 'background'}
      <div class="fields">
        <div class="field-row">
          <label>Cor de fundo</label>
          <input type="color" class="inp color" value={shortColor(val('background-color'))}
            on:input={e => apply('background-color', e.target.value)}/>
          <span class="val-badge mono">{shortColor(val('background-color'))}</span>
        </div>
        <div class="field-row">
          <label>Background</label>
          <input type="text" class="inp" value={val('background')}
            on:change={e => apply('background', e.target.value)}
            placeholder="url(...) / gradient / cor"/>
        </div>
        <div class="field-row">
          <label>Box shadow</label>
          <input type="text" class="inp" value={val('box-shadow')}
            on:change={e => apply('box-shadow', e.target.value)}
            placeholder="0 4px 12px rgba(0,0,0,0.1)"/>
        </div>
        <div class="field-row">
          <label>Mix blend</label>
          <select class="sel" on:change={e => apply('mix-blend-mode', e.target.value)}>
            {#each ['normal','multiply','screen','overlay','darken','lighten','color-dodge','color-burn','hard-light','soft-light','difference','exclusion'] as m}
              <option value={m}>{m}</option>
            {/each}
          </select>
        </div>
      </div>
    {/if}

    <!-- ── BORDER ── -->
    {#if activeSection === 'border'}
      <div class="fields">
        <div class="field-row">
          <label>Border radius</label>
          <input type="number" class="inp sm" value={numVal('border-radius')}
            on:change={e => applyPx('border-radius', e.target.value)}/>
          <span class="unit">px</span>
        </div>
        <div class="field-row">
          <label>Borda</label>
          <input type="text" class="inp" value={val('border')}
            on:change={e => apply('border', e.target.value)}
            placeholder="1px solid #000"/>
        </div>
        <div class="field-row">
          <label>Cor da borda</label>
          <input type="color" class="inp color" value={shortColor(val('border-color') || '#000000')}
            on:input={e => apply('border-color', e.target.value)}/>
        </div>
        <div class="field-row">
          <label>Espessura</label>
          <input type="number" class="inp sm" value={numVal('border-width')}
            on:change={e => applyPx('border-width', e.target.value)}/>
          <span class="unit">px</span>
        </div>
        <div class="field-row">
          <label>Estilo</label>
          <select class="sel" on:change={e => apply('border-style', e.target.value)}>
            {#each ['none','solid','dashed','dotted','double','groove','ridge'] as s}
              <option value={s} selected={val('border-style') === s}>{s}</option>
            {/each}
          </select>
        </div>
        <div class="field-row">
          <label>Outline</label>
          <input type="text" class="inp" value={val('outline')}
            on:change={e => apply('outline', e.target.value)}
            placeholder="none"/>
        </div>
      </div>
    {/if}

    <!-- ── LAYOUT ── -->
    {#if activeSection === 'layout'}
      <div class="fields">
        <div class="field-row">
          <label>Display</label>
          <select class="sel" on:change={e => apply('display', e.target.value)}>
            {#each displays as d}
              <option value={d} selected={val('display') === d}>{d}</option>
            {/each}
          </select>
        </div>
        <div class="field-row">
          <label>Position</label>
          <select class="sel" on:change={e => apply('position', e.target.value)}>
            {#each positions as p}
              <option value={p} selected={val('position') === p}>{p}</option>
            {/each}
          </select>
        </div>
        {#if ['absolute','fixed','sticky','relative'].includes(val('position'))}
          <div class="field-row">
            <label>Top</label>
            <input type="text" class="inp" value={val('top')} on:change={e => apply('top', e.target.value)} placeholder="auto"/>
          </div>
          <div class="field-row">
            <label>Left</label>
            <input type="text" class="inp" value={val('left')} on:change={e => apply('left', e.target.value)} placeholder="auto"/>
          </div>
          <div class="field-row">
            <label>Z-index</label>
            <input type="number" class="inp sm" value={parseInt(val('z-index')) || 0}
              on:change={e => apply('z-index', e.target.value)}/>
          </div>
        {/if}
        {#if val('display') === 'flex'}
          <div class="section-divider">Flex</div>
          <div class="field-row">
            <label>Direção</label>
            <select class="sel" on:change={e => apply('flex-direction', e.target.value)}>
              {#each flexDir as d}
                <option value={d} selected={val('flex-direction') === d}>{d}</option>
              {/each}
            </select>
          </div>
          <div class="field-row">
            <label>Justify</label>
            <select class="sel" on:change={e => apply('justify-content', e.target.value)}>
              {#each justifies as j}
                <option value={j} selected={val('justify-content') === j}>{j}</option>
              {/each}
            </select>
          </div>
          <div class="field-row">
            <label>Align</label>
            <select class="sel" on:change={e => apply('align-items', e.target.value)}>
              {#each aligns as a}
                <option value={a} selected={val('align-items') === a}>{a}</option>
              {/each}
            </select>
          </div>
          <div class="field-row">
            <label>Gap</label>
            <input type="number" class="inp sm" value={numVal('gap')}
              on:change={e => applyPx('gap', e.target.value)}/>
            <span class="unit">px</span>
          </div>
          <div class="field-row">
            <label>Flex wrap</label>
            <select class="sel" on:change={e => apply('flex-wrap', e.target.value)}>
              {#each ['nowrap','wrap','wrap-reverse'] as w}
                <option value={w}>{w}</option>
              {/each}
            </select>
          </div>
        {/if}
        {#if val('display') === 'grid'}
          <div class="section-divider">Grid</div>
          <div class="field-row">
            <label>Colunas</label>
            <input type="text" class="inp" value={val('grid-template-columns')}
              on:change={e => apply('grid-template-columns', e.target.value)}
              placeholder="repeat(3, 1fr)"/>
          </div>
          <div class="field-row">
            <label>Linhas</label>
            <input type="text" class="inp" value={val('grid-template-rows')}
              on:change={e => apply('grid-template-rows', e.target.value)}
              placeholder="auto"/>
          </div>
          <div class="field-row">
            <label>Gap</label>
            <input type="number" class="inp sm" value={numVal('gap')}
              on:change={e => applyPx('gap', e.target.value)}/>
            <span class="unit">px</span>
          </div>
        {/if}
        <div class="section-divider">Transform</div>
        <div class="field-row">
          <label>Transform</label>
          <input type="text" class="inp" value={val('transform')}
            on:change={e => apply('transform', e.target.value)}
            placeholder="rotate(0deg) scale(1)"/>
        </div>
        <div class="field-row">
          <label>Transition</label>
          <input type="text" class="inp" value={val('transition')}
            on:change={e => apply('transition', e.target.value)}
            placeholder="all 0.3s ease"/>
        </div>
      </div>
    {/if}

  </div>

  <!-- Inline style raw editor -->
  <div class="raw-section">
    <span class="raw-label">Style inline</span>
    <textarea class="raw-input" rows="3"
      value={element.inline || ''}
      on:change={e => {
        dispatch('applyRawStyle', { style: e.target.value });
      }}
      placeholder="color: red; font-size: 16px;"
    ></textarea>
  </div>

</div>
{/if}

<style>
  .panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: #0c0c0e;
    color: #d4d4d8;
    font-family: 'Ubuntu', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 11px;
    user-select: none;
    -webkit-user-select: none;
    touch-action: pan-y;
  }
  .panel-header {
    padding: 10px 12px 8px;
    border-bottom: 1px solid var(--w05, rgba(255,255,255,0.05));
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .el-info { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .el-tag {
    font-size: 11px; font-weight: 600; font-family: 'Ubuntu Mono', ui-monospace, monospace;
    background: var(--w15, rgba(255,255,255,0.15)); color: var(--accent, #f5f5f5);
    padding: 1px 6px; border-radius: 4px;
  }
  .el-classes { font-size: 10px; color: #71717a; font-family: 'Ubuntu Mono', ui-monospace, monospace; word-break: break-all; }
  .el-text { font-size: 10px; color: #52525b; font-style: italic; }

  .tabs {
    display: flex; overflow-x: auto; padding: 6px 8px 0;
    gap: 2px; border-bottom: 1px solid var(--w05, rgba(255,255,255,0.05));
    scrollbar-width: none; -webkit-overflow-scrolling: touch;
  }
  .tabs::-webkit-scrollbar { display: none; }
  .tab {
    flex-shrink: 0; background: transparent; border: none; cursor: pointer;
    color: #71717a; font-size: 10px; font-weight: 500; padding: 4px 8px 6px;
    border-bottom: 2px solid transparent; transition: color 0.1s, border-color 0.1s;
    font-family: inherit; touch-action: manipulation;
  }
  .tab:hover { color: #a1a1aa; }
  .tab.active { color: var(--accent, #f5f5f5); border-bottom-color: var(--accent, #f5f5f5); }

  .body {
    flex: 1; overflow-y: auto; padding: 10px 12px;
    scrollbar-width: thin; scrollbar-color: var(--w10, rgba(255,255,255,0.1)) transparent;
    -webkit-overflow-scrolling: touch;
  }

  /* Box model */
  .box-model { display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .bm-label { font-size: 9px; font-weight: 600; letter-spacing: 0.1em; color: #71717a; text-transform: uppercase; }
  .bm-label.outer { align-self: flex-start; margin-bottom: -2px; }
  .bm-label.inner { position: absolute; top: 4px; left: 50%; transform: translateX(-50%); color: #52525b; }
  .bm-ring {
    position: relative; width: 100%;
    border: 1px dashed var(--w10, rgba(255,255,255,0.1));
    border-radius: 6px; padding: 22px;
    display: flex; align-items: center; justify-content: center;
  }
  .bm-ring.inner { border-color: var(--w25, rgba(255,255,255,0.25)); background: var(--w04, rgba(255,255,255,0.04)); padding: 16px; }
  .bm-side {
    position: absolute; background: var(--w05, rgba(255,255,255,0.05));
    border: 1px solid var(--w08, rgba(255,255,255,0.08)); border-radius: 4px;
    color: #d4d4d8; font-size: 10px; font-family: 'Ubuntu Mono', ui-monospace, monospace;
    width: 36px; text-align: center; padding: 2px 0; outline: none;
    /* FIX: prevent iOS zoom */
    font-size: 16px;
    -moz-appearance: textfield;
  }
  .bm-side::-webkit-inner-spin-button { display: none; }
  .bm-side:focus { border-color: var(--w50, rgba(255,255,255,0.5)); }
  .bm-side.top    { top: 4px;    left: 50%; transform: translateX(-50%); }
  .bm-side.bottom { bottom: 4px; left: 50%; transform: translateX(-50%); }
  .bm-side.left   { left: 4px;   top: 50%;  transform: translateY(-50%); }
  .bm-side.right  { right: 4px;  top: 50%;  transform: translateY(-50%); }
  .bm-center {
    font-size: 9px; color: #52525b; text-align: center;
    font-style: italic;
  }

  /* Fields */
  .fields { display: flex; flex-direction: column; gap: 6px; }
  .field-row {
    display: flex; align-items: center; gap: 6px;
    min-height: 28px;
  }
  .field-row label {
    flex: 0 0 80px; font-size: 10px; color: #71717a; font-weight: 500;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .inp {
    flex: 1; background: var(--w05, rgba(255,255,255,0.05));
    border: 1px solid var(--w08, rgba(255,255,255,0.08)); border-radius: 5px;
    color: #d4d4d8; font-size: 16px; font-family: 'Ubuntu Mono', ui-monospace, monospace;
    padding: 3px 7px; outline: none; min-width: 0;
    transition: border-color 0.1s;
    /* FIX: prevent iOS zoom on focus */
    -webkit-text-size-adjust: 100%;
  }
  .inp:focus { border-color: var(--w40, rgba(255,255,255,0.4)); }
  .inp.sm { max-width: 60px; flex: 0 0 60px; }
  .inp.color { padding: 1px 2px; height: 26px; width: 40px; flex: 0 0 40px; border-radius: 4px; cursor: pointer; font-size: 11px; }
  .sel {
    flex: 1; background: var(--w05, rgba(255,255,255,0.05));
    border: 1px solid var(--w08, rgba(255,255,255,0.08)); border-radius: 5px;
    color: #d4d4d8; font-size: 16px; padding: 3px 5px; outline: none;
    min-width: 0;
  }
  .sel:focus { border-color: var(--w40, rgba(255,255,255,0.4)); }
  .unit { font-size: 10px; color: #52525b; flex-shrink: 0; }
  .val-badge {
    font-size: 10px; color: #71717a; flex-shrink: 0;
    background: var(--w04, rgba(255,255,255,0.04)); padding: 1px 5px; border-radius: 3px;
  }
  .val-badge.mono { font-family: 'Ubuntu Mono', ui-monospace, monospace; }

  .btn-group { display: flex; gap: 2px; }
  .tog {
    width: 28px; height: 24px; border: 1px solid var(--w08, rgba(255,255,255,0.08));
    background: var(--w04, rgba(255,255,255,0.04)); border-radius: 4px; cursor: pointer;
    color: #71717a; font-size: 11px; transition: all 0.1s;
    display: flex; align-items: center; justify-content: center;
    touch-action: manipulation;
  }
  .tog:hover { background: var(--w08, rgba(255,255,255,0.08)); color: #d4d4d8; }
  .tog.on { background: var(--w20, rgba(255,255,255,0.2)); border-color: var(--w40, rgba(255,255,255,0.4)); color: var(--accent, #f5f5f5); }

  .section-divider {
    font-size: 9px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase;
    color: #52525b; padding: 8px 0 4px; border-top: 1px solid var(--w05, rgba(255,255,255,0.05));
    margin-top: 4px;
  }

  input[type="range"] {
    flex: 1; accent-color: var(--accent, #d4d4d8); height: 3px;
    touch-action: pan-x;
  }

  .mt-1 { margin-top: 4px; }
  .mt-2 { margin-top: 8px; }
  .row { display: flex; align-items: center; gap: 6px; }
  .lbl { font-size: 10px; color: #71717a; flex: 0 0 110px; }

  .raw-section {
    border-top: 1px solid var(--w05, rgba(255,255,255,0.05));
    padding: 8px 12px 10px;
    display: flex; flex-direction: column; gap: 4px;
    flex-shrink: 0;
  }
  .raw-label { font-size: 9px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #52525b; }
  .raw-input {
    background: var(--w03, rgba(255,255,255,0.03)); border: 1px solid var(--w07, rgba(255,255,255,0.07));
    border-radius: 6px; color: #a1a1aa; font-size: 12px;
    font-family: 'Ubuntu Mono', ui-monospace, monospace; padding: 6px 8px;
    resize: none; outline: none; line-height: 1.6;
    transition: border-color 0.1s;
  }
  .raw-input:focus { border-color: var(--w35, rgba(255,255,255,0.35)); }
</style>