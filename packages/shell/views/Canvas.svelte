<script>
  import { createEventDispatcher } from 'svelte';
  import CssPanel from './CssPanel.svelte';

  export let html = '';
  export let open = false;

  const dispatch = createEventDispatcher();

  // ── UI state ────────────────────────────────────────────────────────────────
  let activeTab       = 'preview';
  let copied          = false;
  let editableMode    = false;
  let showCssPanel    = false;
  let selectedElement = null;

  // ── Multi-page ───────────────────────────────────────────────────────────────
  // pages: array of { title, html }
  let pages        = [];
  let activePage   = 0;
  let isMultiPage  = false;

  // ── Surge ───────────────────────────────────────────────────────────────────
  let healthOk     = false;
  let isPublishing = false;
  let publishUrl   = '';
  let publishError = '';

  // ── AI Adjust ───────────────────────────────────────────────────────────────
  let showAiPrompt   = false;
  let aiPromptText   = '';
  let isAiProcessing = false;
  let aiContextData  = null;

  // ── Video from Canvas ───────────────────────────────────────────────────────
  let showVideoPrompt  = false;
  let videoPromptText  = '';
  let videoWithProtocol = true;
  let videoProject     = null;
  let videoGeneration  = null;
  let videoError       = '';
  let isVideoProcessing = false;
  let videoPollTimer;

  // ── Responsive presets ──────────────────────────────────────────────────────
  let modalWidth = 1024;
  let isResizing = false;
  const presets  = [
    { id: 'desktop', w: 1280, title: 'Desktop' },
    { id: 'tablet',  w: 768,  title: 'Tablet' },
    { id: 'mobile',  w: 375,  title: 'Mobile' },
  ];

  // ── Iframe ──────────────────────────────────────────────────────────────────
  let iframeEl     = null;
  let iframeSrcdoc = '';
  let isFromIframe = false;
  let iframeTimer;

  // ── History ─────────────────────────────────────────────────────────────────
  let history      = [];
  let historyIndex = -1;
  let isNavHistory = false;
  let showHistory  = false;
  let wasOpen      = false;

  // ── Derived ─────────────────────────────────────────────────────────────────
  $: canUndo = historyIndex > 0;
  $: canRedo = historyIndex < history.length - 1;
  $: currentPreset = presets.find(p => p.w === modalWidth)?.id ?? 'custom';

  // ── Parse multi-page HTML ────────────────────────────────────────────────────
  function parsePages(raw) {
    if (!raw) return [];
    // Match all <html>...</html> blocks
    const matches = [...raw.matchAll(/<html[\s\S]*?<\/html>/gi)];
    if (matches.length <= 1) return null; // not multi-page

    return matches.map((m, i) => {
      const src = m[0];
      // Try to extract <title>
      const titleMatch = src.match(/<title[^>]*>(.*?)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : `Page ${i + 1}`;
      return { title, html: '<!DOCTYPE html>\n' + src };
    });
  }

  // Build unified single-page SPA from pages array
  function buildUnifiedSPA(pagesArr) {
    // Extract body content and styles from each page
    const sections = pagesArr.map((p, i) => {
      const bodyMatch = p.html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      const styleMatches = [...p.html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)];
      const styles = styleMatches.map(m => m[1]).join('\n');
      const body = bodyMatch ? bodyMatch[1] : p.html;
      return { title: p.title, body, styles, id: `page-${i}` };
    });

    const allStyles = sections.map(s => `
/* === ${s.title} === */
#${s.id} { display: none; }
#${s.id}.active { display: block; }
${s.styles}
    `).join('\n');

    const allBodies = sections.map(s => `
<div id="${s.id}" class="spa-page${s === sections[0] ? ' active' : ''}">
${s.body}
</div>
    `).join('\n');

    const navItems = sections.map((s, i) =>
      `<button onclick="window.__spaNav(${i})" id="spa-nav-${i}" class="${i === 0 ? 'active' : ''}">${s.title}</button>`
    ).join('\n');

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
* { box-sizing: border-box; }
body { margin: 0; }
#__spa-nav {
  position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
  display: flex; gap: 4px; padding: 6px 10px;
  background: rgba(9,9,11,0.92); backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--w08, rgba(255,255,255,0.08));
  overflow-x: auto; scrollbar-width: none;
}
#__spa-nav::-webkit-scrollbar { display: none; }
#__spa-nav button {
  background: var(--w06, rgba(255,255,255,0.06)); border: 1px solid var(--w10, rgba(255,255,255,0.1));
  border-radius: 8px; color: #a1a1aa; cursor: pointer;
  font-size: 11px; font-weight: 500; padding: 4px 12px;
  white-space: nowrap; transition: all 0.15s; font-family: inherit;
}
#__spa-nav button:hover { background: var(--w10, rgba(255,255,255,0.1)); color: #fff; }
#__spa-nav button.active { background: rgba(255,255,255,0.18); border-color: rgba(255,255,255,0.32); color: #e4e4e7; }
#__spa-content { padding-top: 40px; }
${allStyles}
</style>
</head>
<body>
<nav id="__spa-nav">
${navItems}
</nav>
<div id="__spa-content">
${allBodies}
</div>
<script>
window.__spaNav = function(idx) {
  document.querySelectorAll('.spa-page').forEach((el, i) => {
    el.classList.toggle('active', i === idx);
  });
  document.querySelectorAll('#__spa-nav button').forEach((btn, i) => {
    btn.classList.toggle('active', i === idx);
  });
};
// Intercept internal links between pages
document.addEventListener('click', function(e) {
  const a = e.target.closest('a[href]');
  if (!a) return;
  const href = a.getAttribute('href');
  const m = href && href.match(/^#?page-(\d+)$/);
  if (m) { e.preventDefault(); window.__spaNav(parseInt(m[1])); }
});
<\/script>
</body>
</html>`;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────
  const API_BASE = '/surge-pkg';

  $: if (open)  checkHealth();
  $: if (!open) resetTransientState();

  // Cada abertura começa com um ponto de retorno próprio. Isto evita que o
  // desfazer de um Canvas interfira no próximo artefato aberto.
  $: if (open && !wasOpen) {
    wasOpen = true;
    history = html ? [{ html, label: 'Estado inicial', ts: Date.now(), size: html.length }] : [];
    historyIndex = history.length - 1;
  }
  $: if (!open && wasOpen) wasOpen = false;

  $: if (html && !isFromIframe) {
    const parsed = parsePages(html);
    if (parsed && parsed.length > 1) {
      isMultiPage = true;
      pages = parsed;
      // Show active page in preview
      iframeSrcdoc = buildSrcdoc(pages[activePage].html);
    } else {
      isMultiPage = false;
      pages = [];
      iframeSrcdoc = buildSrcdoc(html);
    }
  }

  $: if (iframeEl) {
    sendToIframe({ type: 'SET_EDITABLE', enabled: editableMode });
  }

  // When active page changes, rebuild iframe
  function switchPage(idx) {
    activePage = idx;
    editableMode = false;
    showCssPanel = false;
    selectedElement = null;
    iframeSrcdoc = buildSrcdoc(pages[idx].html);
  }

  // Update current page html and rebuild unified output
  function updatePageHtml(idx, newHtml) {
    pages = pages.map((p, i) => i === idx ? { ...p, html: newHtml } : p);
    // Rebuild unified html export (concatenation with newlines)
    html = pages.map(p => p.html).join('\n\n');
  }

  // ── History helpers ──────────────────────────────────────────────────────────
  function pushHistory(value, label = 'Change') {
    if (isNavHistory) return;
    if (history[historyIndex]?.html === value) return;
    if (historyIndex < history.length - 1) {
      history = history.slice(0, historyIndex + 1);
    }
    history = [...history, { html: value, label, ts: Date.now(), size: value.length }];
    if (history.length > 50) history = history.slice(1);
    historyIndex = history.length - 1;
  }

  function jumpHistory(idx) {
    if (idx < 0 || idx >= history.length) return;
    isNavHistory = true;
    historyIndex = idx;
    html = history[idx].html;
    iframeSrcdoc = buildSrcdoc(html);
    showHistory  = false;
    setTimeout(() => { isNavHistory = false; }, 120);
  }

  function undo() { jumpHistory(historyIndex - 1); }
  function redo() { jumpHistory(historyIndex + 1); }

  function formatTs(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  function fmtSize(n) {
    return n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' KB';
  }

  // ── Iframe helpers ───────────────────────────────────────────────────────────
  function sendToIframe(msg) {
    iframeEl?.contentWindow?.postMessage(msg, '*');
  }

  function buildSrcdoc(sourceHtml) {
    if (!sourceHtml) return '';
    const script = `<script>(${EDITOR_ENGINE_FN})();<\/script>`;
    if (sourceHtml.includes('</body>')) {
      return sourceHtml.replace('</body>', script + '</body>');
    }
    return sourceHtml + script;
  }

  // ── Window messages from iframe ──────────────────────────────────────────────
  function handleMessage(event) {
    if (!event.data?.type) return;
    const { type, ...payload } = event.data;

    switch (type) {
      case 'HTML_CHANGE':
        isFromIframe = true;
        if (isMultiPage) {
          updatePageHtml(activePage, payload.html);
          pushHistory(html, labelFromIframe(payload.label));
        } else {
          html = payload.html;
          pushHistory(html, labelFromIframe(payload.label));
        }
        clearTimeout(iframeTimer);
        iframeTimer = setTimeout(() => { isFromIframe = false; }, 800);
        break;

      case 'ELEMENT_SELECTED':
        selectedElement = payload.data;
        showCssPanel    = true;
        break;

      case 'ELEMENT_DESELECTED':
        selectedElement = null;
        showCssPanel    = false;
        break;

      case 'AI_EDIT_REQUEST':
        aiContextData = payload;
        showAiPrompt  = true;
        break;

      case 'OPEN_CSS_PANEL':
        showCssPanel = true;
        break;

      case 'NAVIGATE_PAGE':
        if (isMultiPage && payload.index >= 0 && payload.index < pages.length) {
          switchPage(payload.index);
        }
        break;
    }
  }

  function labelFromIframe(raw) {
    const map = {
      'text-edit':    'Text edit',
      'css-edit':     'CSS edit',
      'delete':       'Elemento deletado',
      'link-edit':    'Link editado',
      'attr-edit':    'Atributo editado',
      'html-replace': 'HTML replaced',
    };
    return map[raw] ?? 'Change';
  }

  // ── CSS Panel events ─────────────────────────────────────────────────────────
  function handleApplyCSS({ detail }) {
    const camel = detail.property.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    sendToIframe({ type: 'APPLY_CSS', property: camel, value: detail.value });
  }

  function handleApplyRawStyle({ detail }) {
    sendToIframe({ type: 'APPLY_ATTRIBUTE', attribute: 'style', value: detail.style });
  }

  // ── AI Adjust ───────────────────────────────────────────────────────────────
  async function handleAiAdjust() {
    if (!aiPromptText.trim() || isAiProcessing) return;
    isAiProcessing = true;

    const promptSnapshot  = aiPromptText;
    const contextSnapshot = aiContextData ?? null;

    dispatch('aiAdjust', {
      prompt:      promptSnapshot,
      currentHtml: html,
      context:     contextSnapshot,
    });

    setTimeout(() => {
      const current = isMultiPage ? pages[activePage].html : html;
      const newHtml = applyFakeAiEdit(current, promptSnapshot, contextSnapshot);
      if (isMultiPage) {
        updatePageHtml(activePage, newHtml);
        iframeSrcdoc = buildSrcdoc(pages[activePage].html);
      } else {
        html = newHtml;
      }
      pushHistory(html, 'Ajuste com IA (simulado)');
      isAiProcessing = false;
      showAiPrompt   = false;
      aiPromptText   = '';
      aiContextData  = null;
    }, 1500);
  }

  function applyFakeAiEdit(sourceHtml, prompt, context) {
    if (!sourceHtml) return sourceHtml;
    const note = `<!-- IA (simulada): "${prompt.replace(/-->/g, '--&gt;')}" -->`;
    if (context?.outerHtml) {
      const idx = sourceHtml.indexOf(context.outerHtml);
      if (idx !== -1) {
        return sourceHtml.slice(0, idx) + note + '\n' + context.outerHtml + sourceHtml.slice(idx + context.outerHtml.length);
      }
    }
    if (sourceHtml.includes('</body>')) return sourceHtml.replace('</body>', note + '\n</body>');
    return sourceHtml + '\n' + note;
  }

  const canvasVideoProtocol = {
    name: 'Video created from Canvas',
    purpose: 'Transform a short instruction into coherent, reviewable visual scenes.',
    rules: [
      'Each scene must visually represent the user instruction.',
      'The sequence must have a beginning, middle, and ending.',
      'Rendering starts only after explicit approval.'
    ],
    stages: [
      { name: 'Abertura', goal: 'Apresentar o assunto', actions: ['Estabelecer personagem, objeto ou ambiente'], checks: ['O assunto fica claro nos primeiros segundos'] },
      { name: 'Action', goal: 'Show the main change', actions: ['Animate a concrete action'], checks: ['The action can be understood without text'] },
      { name: 'Fechamento', goal: 'Concluir a ideia', actions: ['Mostrar o resultado final'], checks: ['A cena final conclui a narrativa'] }
    ]
  };

  async function videoPost(path, body) {
    const response = await fetch(`/video-studio/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not complete the video operation.');
    return data;
  }

  async function prepareCanvasVideo() {
    if (!videoPromptText.trim() || isVideoProcessing) return;
    isVideoProcessing = true;
    videoError = '';
    try {
      const result = await videoPost('prepare', {
        request: videoPromptText.trim(),
        intent: 'Create video from Canvas',
        interactive: videoWithProtocol,
        protocols: videoWithProtocol ? [canvasVideoProtocol] : []
      });
      if (result.status !== 'ready_for_review') throw new Error('The script needs more detail before review. Try describing the action, setting, and style.');
      videoProject = result.project;
    } catch (error) { videoError = error.message; }
    finally { isVideoProcessing = false; }
  }

  async function generateCanvasVideo() {
    if (!videoProject || isVideoProcessing) return;
    isVideoProcessing = true;
    videoError = '';
    try {
      await videoPost('approve', { projectId: videoProject.id });
      const result = await videoPost('generate', { projectId: videoProject.id });
      videoGeneration = result.generation;
      clearInterval(videoPollTimer);
      videoPollTimer = setInterval(refreshCanvasVideo, 3000);
      await refreshCanvasVideo();
    } catch (error) { videoError = error.message; }
    finally { isVideoProcessing = false; }
  }

  async function refreshCanvasVideo() {
    if (!videoGeneration?.id) return;
    try {
      const result = await videoPost('refresh', { generationId: videoGeneration.id });
      videoGeneration = { ...videoGeneration, ...result };
      if (result.status === 'completed' || result.status === 'failed') clearInterval(videoPollTimer);
    } catch (error) { videoError = error.message; clearInterval(videoPollTimer); }
  }

  function closeVideoPrompt() {
    clearInterval(videoPollTimer);
    showVideoPrompt = false;
    videoPromptText = '';
    videoProject = null;
    videoGeneration = null;
    videoError = '';
  }

  // ── Export unified SPA ───────────────────────────────────────────────────────
  function exportUnified() {
    if (!isMultiPage) return html;
    return buildUnifiedSPA(pages);
  }

  // ── Publish ──────────────────────────────────────────────────────────────────
  async function checkHealth() {
    try {
      const res  = await fetch(`${API_BASE}/health`);
      const data = await res.json();
      healthOk   = data.status === 'ok' && data.configured;
    } catch { healthOk = false; }
  }

  async function handlePublish() {
    if (!html || isPublishing) return;
    isPublishing = true;
    publishError = '';
    publishUrl   = '';
    try {
      const payload = isMultiPage ? buildUnifiedSPA(pages) : html;
      const res  = await fetch(`${API_BASE}/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: payload }),
      });
      const data = await res.json();
      if (data.success) publishUrl = data.url;
      else publishError = data.error || 'Unknown error.';
    } catch { publishError = 'Could not connect to the server.'; }
    finally   { isPublishing = false; }
  }

  // ── Resize ───────────────────────────────────────────────────────────────────
  function startResize(e) {
    e.preventDefault();
    isResizing = true;
    window.addEventListener('pointermove', onResize);
    window.addEventListener('pointerup',   stopResize);
  }
  function onResize(e) {
    if (!isResizing) return;
    const w = Math.abs(window.innerWidth / 2 - e.clientX) * 2;
    modalWidth = Math.max(320, Math.min(w, window.innerWidth - 80));
  }
  function stopResize() {
    isResizing = false;
    window.removeEventListener('pointermove', onResize);
    window.removeEventListener('pointerup',   stopResize);
  }

  // ── Misc ─────────────────────────────────────────────────────────────────────
  async function copy() {
    try {
      await navigator.clipboard.writeText(isMultiPage ? buildUnifiedSPA(pages) : html);
      copied = true;
      setTimeout(() => copied = false, 1800);
    } catch {}
  }

  function close() {
    resetTransientState();
    dispatch('close');
  }

  function resetTransientState() {
    publishUrl      = '';
    publishError    = '';
    showAiPrompt    = false;
    aiContextData   = null;
    showHistory     = false;
    showCssPanel    = false;
    selectedElement = null;
    editableMode    = false;
    isMultiPage     = false;
    pages           = [];
    activePage      = 0;
    clearInterval(videoPollTimer);
    videoProject = null;
    videoGeneration = null;
    showVideoPrompt = false;
    videoError = '';
    history = [];
    historyIndex = -1;
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') { close(); return; }
    if (!open) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
  }

  // ── Code editor helpers ──────────────────────────────────────────────────────
  const VOID_TAGS = new Set([
    'area','base','br','col','embed','hr','img','input','link',
    'meta','param','source','track','wbr',
  ]);

  function handleCodeKeydown(e) {
    if (e.key !== '>') return;
    const ta  = e.target;
    const pos = ta.selectionStart;
    if (pos !== ta.selectionEnd) return;
    const before = ta.value.slice(0, pos);
    if (/\/\s*$/.test(before)) return;
    const openMatch = before.match(/<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^<>]*)?)$/);
    if (!openMatch) return;
    const tagName = openMatch[1];
    if (VOID_TAGS.has(tagName.toLowerCase())) return;
    const after       = ta.value.slice(pos);
    const closeTag    = `</${tagName}>`;
    const alreadyClosed = after.trimStart().toLowerCase().startsWith(closeTag.toLowerCase());
    e.preventDefault();
    const newValue = alreadyClosed ? (before + '>' + after) : (before + '>' + closeTag + after);
    ta.value = newValue;
    ta.setSelectionRange(pos + 1, pos + 1);
    if (isMultiPage) {
      updatePageHtml(activePage, newValue);
    } else {
      html = newValue;
    }
  }

  // Current HTML being edited in code tab
  $: codeHtml = isMultiPage ? (pages[activePage]?.html ?? '') : html;

  function handleCodeInput(e) {
    const val = e.target.value;
    if (isMultiPage) {
      updatePageHtml(activePage, val);
    } else {
      html = val;
    }
  }

  // ── EditorEngine ─────────────────────────────────────────────────────────────
  // FIX: focus is preserved by using mousedown instead of click for selection,
  //      and by re-focusing the iframe after CSS/text edits via a postMessage ack.
  //      The srcdoc is NOT rebuilt on every HTML_CHANGE — only the parent html
  //      prop changes; the iframe itself stays alive and simply posts diffs up.
  const EDITOR_ENGINE_FN = `function () {
  let editable = false;
  let selectedEl = null;
  let lastHtml = '';
  let selectionBox = null;
  let toolbar = null;
  let blurTimer = null;
  let _suppressNextBlur = false;

  const style = document.createElement('style');
  style.id = '_ee_style';
  style.textContent = \`
    body._ee_editable button:empty, body._ee_editable a:empty, body._ee_editable [role="button"]:empty {
      min-width: 48px !important; min-height: 28px !important; display: inline-flex !important;
      align-items: center; justify-content: center;
    }
    body._ee_editable button, body._ee_editable a, body._ee_editable [role="button"] {
      min-width: 40px !important; min-height: 24px !important;
    }
    body._ee_editable *:empty:not(br):not(img):not(input):not(select):not(textarea):not(hr):not(iframe):not(svg):not(path):not(circle):not(rect):not(#_ee_selbox):not(#_ee_toolbar):not(#_ee_toolbar *) {
      min-width: 32px !important; min-height: 20px !important; display: inline-block !important;
      background: rgba(255,255,255,0.06) !important; border: 1px dashed rgba(255,255,255,0.35) !important; border-radius: 3px;
    }
    #_ee_selbox {
      position: fixed; pointer-events: none; z-index: 2147483640;
      border: 2px solid #e4e4e7; border-radius: 4px;
      box-shadow: 0 0 0 1px rgba(255,255,255,0.2), inset 0 0 0 1px rgba(255,255,255,0.1);
      transition: top 0.08s, left 0.08s, width 0.08s, height 0.08s; display: none;
    }
    #_ee_selbox._active { display: block; }
    body._ee_editable *:not(#_ee_selbox):not(#_ee_toolbar):not(#_ee_toolbar *):not(#_ee_linkpop):not(#_ee_linkpop *):hover {
      outline: 1px dashed rgba(255,255,255,0.4) !important; outline-offset: 1px !important; cursor: pointer !important;
    }
    #_ee_toolbar {
      position: fixed; z-index: 2147483647; display: none; align-items: center; gap: 2px;
      background: #09090b; border: 1px solid var(--w12, rgba(255,255,255,0.12)); padding: 3px; border-radius: 10px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(255,255,255,0.04);
      font-family: 'Ubuntu', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    #_ee_toolbar._show { display: flex; }
    #_ee_toolbar .sep { width: 1px; height: 14px; background: var(--w10, rgba(255,255,255,0.1)); margin: 0 2px; }
    #_ee_toolbar button {
      background: transparent; border: none; color: #a1a1aa; cursor: pointer; font-size: 11px; font-weight: 500;
      padding: 4px 7px; border-radius: 7px; display: flex; align-items: center; gap: 4px; transition: background 0.1s, color 0.1s;
    }
    #_ee_toolbar button:hover { background: var(--w08, rgba(255,255,255,0.08)); color: #fff; }
    #_ee_toolbar button._del:hover { background: rgba(239,68,68,0.18); color: #f87171; }
    #_ee_toolbar button._ai:hover  { background: rgba(99,102,241,0.2);  color: #a5b4fc; }
    #_ee_toolbar button._css:hover { background: rgba(20,184,166,0.18); color: #5eead4; }
    #_ee_toolbar button._link:hover{ background: rgba(59,130,246,0.18); color: #93c5fd; }
    #_ee_toolbar, #_ee_toolbar * { outline: none !important; }
    #_ee_linkpop {
      position: fixed; z-index: 2147483646; background: #09090b; border: 1px solid var(--w12, rgba(255,255,255,0.12));
      border-radius: 10px; box-shadow: 0 8px 32px rgba(0,0,0,0.7); padding: 10px 12px;
      display: none; flex-direction: column; gap: 8px; min-width: 260px;
      font-family: 'Ubuntu', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    #_ee_linkpop._show { display: flex; }
    #_ee_linkpop label { font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #71717a; }
    #_ee_linkpop input {
      background: var(--w05, rgba(255,255,255,0.05)); border: 1px solid var(--w10, rgba(255,255,255,0.1)); border-radius: 6px;
      color: #e4e4e7; font-size: 12px; font-family: 'Ubuntu Mono', ui-monospace, monospace; outline: none; padding: 6px 10px; width: 100%;
    }
    #_ee_linkpop input:focus { border-color: rgba(255,255,255,0.5); }
    #_ee_linkpop .row { display: flex; gap: 6px; }
    #_ee_linkpop button { border: none; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 600; padding: 5px 12px; }
    #_ee_linkpop .confirm { background: #e4e4e7; color: #111; flex: 1; }
    #_ee_linkpop .confirm:hover { background: #fafafa; }
    #_ee_linkpop .cancel { background: var(--w06, rgba(255,255,255,0.06)); color: #a1a1aa; }
    #_ee_linkpop .cancel:hover { background: var(--w10, rgba(255,255,255,0.1)); color: #fff; }
    /* Mobile text editing toolbar */
    @media (max-width: 480px) {
      #_ee_toolbar { padding: 4px; border-radius: 12px; }
      #_ee_toolbar button { padding: 6px 10px; font-size: 12px; }
    }
  \`;
  document.head.appendChild(style);

  selectionBox = document.createElement('div');
  selectionBox.id = '_ee_selbox';
  document.body.appendChild(selectionBox);

  function updateSelBox(el) {
    if (!el) { selectionBox.classList.remove('_active'); return; }
    const r = el.getBoundingClientRect();
    selectionBox.style.top    = (r.top  - 2) + 'px';
    selectionBox.style.left   = (r.left - 2) + 'px';
    selectionBox.style.width  = (r.width + 4) + 'px';
    selectionBox.style.height = (r.height + 4) + 'px';
    selectionBox.classList.add('_active');
  }

  toolbar = document.createElement('div');
  toolbar.id = '_ee_toolbar';
  toolbar.contentEditable = false;
  toolbar.innerHTML = \`
    <button class="_ai" title="Edit with AI">
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6">
        <path d="M2 14L7.5 8.5M7.5 8.5L10 6C10.8 5.2 12 4 13 3M7.5 8.5L9.5 10.5" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="13" cy="3" r="1.5" fill="currentColor" stroke="none"/>
      </svg>AI
    </button>
    <div class="sep"></div>
    <button class="_css" title="Edit CSS">
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M2 4h12M4 8h8M6 12h4" stroke-linecap="round"/>
      </svg>CSS
    </button>
    <div class="sep"></div>
    <button class="_link" title="Edit link" style="display:none">
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M7 9a3.5 3.5 0 0 0 5 0l2-2a3.536 3.536 0 0 0-5-5L8 3" stroke-linecap="round"/>
        <path d="M9 7a3.5 3.5 0 0 0-5 0L2 9a3.536 3.536 0 0 0 5 5L8 13" stroke-linecap="round"/>
      </svg>Link
    </button>
    <div class="sep _link-sep" style="display:none"></div>
    <button class="_del" title="Delete">
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6">
        <path d="M4 4l8 8M12 4l-8 8" stroke-linecap="round"/>
      </svg>
    </button>
  \`;
  document.body.appendChild(toolbar);

  const linkPop = document.createElement('div');
  linkPop.id = '_ee_linkpop';
  linkPop.contentEditable = false;
  linkPop.innerHTML = \`
    <label>URL / Link</label>
    <input type="text" id="_ee_linkinput" placeholder="https://... or #anchor" />
    <div class="row"><button class="confirm">Apply</button><button class="cancel">Cancel</button></div>
  \`;
  document.body.appendChild(linkPop);

  function getPageStyles() {
    return Array.from(document.querySelectorAll('style')).filter(s => s.id !== '_ee_style').map(s => s.textContent).join('\\n');
  }

  function getComputedSnap(el) {
    const c = window.getComputedStyle(el);
    const props = ['display','position','width','height','min-width','min-height','max-width','max-height',
      'margin','margin-top','margin-right','margin-bottom','margin-left',
      'padding','padding-top','padding-right','padding-bottom','padding-left',
      'font-family','font-size','font-weight','font-style','line-height','letter-spacing','text-align','color','text-decoration',
      'background','background-color','border','border-radius','border-width','border-style','border-color','box-shadow',
      'opacity','overflow','flex','flex-direction','flex-wrap','justify-content','align-items','gap',
      'grid-template-columns','grid-template-rows','transform','transition','z-index','top','left','right','bottom'];
    const out = {};
    props.forEach(p => { out[p] = c.getPropertyValue(p); });
    return out;
  }

  function getCleanHtml() {
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll('#_ee_style, #_ee_selbox, #_ee_toolbar, #_ee_linkpop').forEach(n => n.remove());
    clone.querySelectorAll('script').forEach(s => {
      if (s.textContent && s.textContent.indexOf('_ee_style') !== -1) s.remove();
    });
    const cloneBody = clone.querySelector('body');
    if (cloneBody) {
      cloneBody.removeAttribute('contenteditable');
      cloneBody.classList.remove('_ee_editable');
      if (!cloneBody.getAttribute('class')) cloneBody.removeAttribute('class');
      cloneBody.style.removeProperty('outline');
      if (!cloneBody.getAttribute('style')) cloneBody.removeAttribute('style');
    }
    return '<!DOCTYPE html>\\n' + clone.outerHTML;
  }

  function sync(label) {
    const h = getCleanHtml();
    if (h === lastHtml) return;
    lastHtml = h;
    window.parent.postMessage({ type: 'HTML_CHANGE', html: h, label }, '*');
  }

  function positionToolbar(el) {
    const r = el.getBoundingClientRect();
    const tbH = 36;
    const top  = r.top > tbH + 8 ? r.top - tbH - 4 : r.bottom + 4;
    const left = Math.max(4, Math.min(r.left, window.innerWidth - toolbar.offsetWidth - 4));
    toolbar.style.top  = top + 'px';
    toolbar.style.left = left + 'px';
  }

  function selectElement(el) {
    if (!editable) return;
    if (!el || el === document.body || el === document.documentElement) { deselectElement(); return; }
    selectedEl = el;
    updateSelBox(el);
    positionToolbar(el);
    toolbar.classList.add('_show');
    const isLink = ['a','button'].includes(el.tagName?.toLowerCase()) || el.getAttribute('role') === 'button';
    toolbar.querySelector('._link').style.display      = isLink ? 'flex' : 'none';
    toolbar.querySelector('._link-sep').style.display  = isLink ? 'block' : 'none';
    window.parent.postMessage({
      type: 'ELEMENT_SELECTED',
      data: {
        tag: el.tagName.toLowerCase(),
        classes: Array.from(el.classList).filter(c => !c.startsWith('_ee_')),
        inline: el.getAttribute('style') || '',
        computed: getComputedSnap(el),
        outerHtml: el.outerHTML,
        text: el.innerText?.slice(0, 80) || '',
      }
    }, '*');
  }

  function deselectElement() {
    selectedEl = null;
    selectionBox.classList.remove('_active');
    toolbar.classList.remove('_show');
    linkPop.classList.remove('_show');
    window.parent.postMessage({ type: 'ELEMENT_DESELECTED' }, '*');
  }

  // FIX: use mousedown to select (fires before blur) so editable elements
  // don't lose their contenteditable focus on click.
  document.addEventListener('mousedown', (e) => {
    if (!editable) return;
    if (e.target.closest('#_ee_toolbar') || e.target.closest('#_ee_linkpop') || e.target.closest('#_ee_selbox')) {
      _suppressNextBlur = true;
      return;
    }
    if (e.target === document.body || e.target === document.documentElement) { deselectElement(); return; }
    e.preventDefault();
    // If clicking on an already selected editable text node, allow native focus
    if (selectedEl === e.target) {
      _suppressNextBlur = false;
      return;
    }
    selectElement(e.target);
  }, true);

  // Touch support for mobile
  document.addEventListener('touchend', (e) => {
    if (!editable) return;
    if (e.target.closest('#_ee_toolbar') || e.target.closest('#_ee_linkpop')) return;
    if (e.target === document.body || e.target === document.documentElement) { deselectElement(); return; }
    selectElement(e.target);
  }, { passive: true });

  window.addEventListener('scroll', () => { if (selectedEl) { updateSelBox(selectedEl); positionToolbar(selectedEl); } }, true);
  window.addEventListener('resize', () => { if (selectedEl) { updateSelBox(selectedEl); positionToolbar(selectedEl); } });

  toolbar.querySelector('._ai').addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  toolbar.querySelector('._ai').addEventListener('click', () => {
    if (!selectedEl) return;
    window.parent.postMessage({ type: 'AI_EDIT_REQUEST', outerHtml: selectedEl.outerHTML, inlineCss: selectedEl.getAttribute('style') || '', computedCss: getComputedSnap(selectedEl), pageStyles: getPageStyles() }, '*');
  });

  toolbar.querySelector('._css').addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  toolbar.querySelector('._css').addEventListener('click', () => {
    if (selectedEl) { selectElement(selectedEl); window.parent.postMessage({ type: 'OPEN_CSS_PANEL' }, '*'); }
  });

  toolbar.querySelector('._link').addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  toolbar.querySelector('._link').addEventListener('click', () => {
    if (!selectedEl) return;
    const input = linkPop.querySelector('#_ee_linkinput');
    input.value = selectedEl.getAttribute('href') || selectedEl.getAttribute('data-href') || '';
    const r = selectedEl.getBoundingClientRect();
    const top = r.bottom + 6 + linkPop.offsetHeight > window.innerHeight
      ? r.top - linkPop.offsetHeight - 6
      : r.bottom + 6;
    linkPop.style.top  = Math.max(4, top) + 'px';
    linkPop.style.left = Math.max(4, Math.min(r.left, window.innerWidth - 280)) + 'px';
    linkPop.classList.add('_show');
    toolbar.classList.remove('_show');
    setTimeout(() => input.focus(), 40);
  });

  toolbar.querySelector('._del').addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  toolbar.querySelector('._del').addEventListener('click', () => {
    if (selectedEl && selectedEl !== document.body) { selectedEl.remove(); deselectElement(); sync('delete'); }
  });

  linkPop.querySelector('.confirm').addEventListener('click', () => {
    if (!selectedEl) { linkPop.classList.remove('_show'); return; }
    const val = linkPop.querySelector('#_ee_linkinput').value.trim();
    if (selectedEl.tagName?.toLowerCase() === 'a') { selectedEl.href = val; selectedEl.setAttribute('href', val); }
    else { selectedEl.setAttribute('data-href', val); selectedEl.setAttribute('onclick', "window.location.href='" + val + "'"); }
    linkPop.classList.remove('_show');
    selectElement(selectedEl);
    sync('link-edit');
  });
  linkPop.querySelector('.cancel').addEventListener('click', () => {
    linkPop.classList.remove('_show');
    if (selectedEl) selectElement(selectedEl);
  });

  // FIX: blur handling — suppress when toolbar is being interacted with
  document.addEventListener('blur', (e) => {
    if (!editable) return;
    if (_suppressNextBlur) { _suppressNextBlur = false; return; }
    clearTimeout(blurTimer);
    blurTimer = setTimeout(() => {
      sync('text-edit');
      // Re-select if element is still valid
      if (selectedEl && document.body.contains(selectedEl)) {
        updateSelBox(selectedEl);
        positionToolbar(selectedEl);
      }
    }, 150);
  }, true);

  document.addEventListener('input', () => {
    clearTimeout(blurTimer);
    blurTimer = setTimeout(() => sync('text-edit'), 600);
  }, true);

  document.addEventListener('focus', () => { clearTimeout(blurTimer); }, true);

  document.addEventListener('click', (e) => {
    if (!linkPop.contains(e.target) && !toolbar.contains(e.target)) linkPop.classList.remove('_show');
  });

  window.addEventListener('message', (e) => {
    if (!e.data) return;
    if (e.data.type === 'SET_EDITABLE') {
      editable = e.data.enabled;
      document.body.contentEditable = editable ? 'true' : 'false';
      document.body.style.outline = 'none';
      document.body.classList.toggle('_ee_editable', editable);
      if (!editable) deselectElement();
    }
    if (e.data.type === 'APPLY_CSS' && selectedEl) {
      selectedEl.style[e.data.property] = e.data.value;
      // FIX: re-select to update box without losing focus
      const prev = selectedEl;
      requestAnimationFrame(() => {
        selectElement(prev);
        sync('css-edit');
      });
    }
    if (e.data.type === 'APPLY_ATTRIBUTE' && selectedEl) {
      selectedEl.setAttribute(e.data.attribute, e.data.value);
      sync('attr-edit');
    }
    if (e.data.type === 'APPLY_HTML' && selectedEl) {
      selectedEl.outerHTML = e.data.outerHtml;
      selectedEl = null;
      deselectElement();
      sync('html-replace');
    }
  });
}`;
</script>

<svelte:window on:keydown={handleKeydown} on:message={handleMessage} />

{#if open}
<!-- Backdrop -->
<div
  class="fixed inset-0 z-40 bg-black/60 backdrop-blur-md"
  on:pointerdown={close}
  aria-hidden="true"
></div>

<!-- Modal container -->
<div class="fixed inset-0 md:inset-4 lg:inset-6 z-50 flex items-center justify-center pointer-events-none">
  <div class="relative flex items-center justify-center h-full w-full">

    <!-- ── Responsive preset sidebar ── (hidden on mobile) -->
    <div
      class="absolute z-50 hidden lg:flex flex-col items-center gap-1 rounded-xl border border-white/[0.07] bg-zinc-900/80 p-1.5 backdrop-blur-md shadow-2xl pointer-events-auto transition-all duration-150"
      style="right: calc(50% - {modalWidth/2}px - 44px); top: 50%; transform: translateY(-50%);"
    >
      {#each presets as p}
        <button
          class="flex h-7 w-7 items-center justify-center rounded-lg transition-all cursor-pointer
            {currentPreset === p.id ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.05]'}"
          on:click={() => modalWidth = p.w}
          title={p.title}
        >
          {#if p.id === 'desktop'}
            <svg viewBox="0 0 16 16" fill="none" width="13" height="13"><rect x="1.5" y="2.5" width="13" height="9" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M5.5 13.5h5M8 11.5v2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
          {:else if p.id === 'tablet'}
            <svg viewBox="0 0 16 16" fill="none" width="13" height="13"><rect x="2.5" y="1.5" width="11" height="13" rx="1.5" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="12.3" r="0.65" fill="currentColor"/></svg>
          {:else}
            <svg viewBox="0 0 16 16" fill="none" width="11" height="11"><rect x="3.5" y="1" width="9" height="14" rx="1.5" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="12.8" r="0.65" fill="currentColor"/><path d="M6.5 2.8h3" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>
          {/if}
        </button>
        {#if p.id !== 'mobile'}
          <div class="w-4 h-px bg-white/[0.08]"></div>
        {/if}
      {/each}
      {#if currentPreset === 'custom'}
        <div class="w-4 h-px bg-white/[0.08]"></div>
        <span class="text-[9px] font-mono text-zinc-600">{modalWidth}</span>
      {/if}
    </div>

    <!-- ── Main modal ── -->
    <aside
      class="relative flex h-full flex-col overflow-hidden rounded-none md:rounded-2xl border-0 md:border border-white/[0.06] bg-zinc-950 shadow-2xl shadow-black/80 transition-[max-width] duration-150 ease-out pointer-events-auto"
      style="width: 100%; max-width: {modalWidth}px;"
      role="dialog"
      aria-label="HTML preview"
    >
      <!-- Resize handles (desktop only) -->
      <div class="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize z-50 select-none hidden lg:block group" on:pointerdown={startResize}>
        <div class="absolute inset-0 group-hover:bg-indigo-500/20 transition-colors rounded-l-2xl"></div>
      </div>
      <div class="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize z-50 select-none hidden lg:block group" on:pointerdown={startResize}>
        <div class="absolute inset-0 group-hover:bg-indigo-500/20 transition-colors rounded-r-2xl"></div>
      </div>

      <!-- ── Header ── -->
      <header class="flex-shrink-0 flex justify-between items-center px-2 sm:px-3 py-2 sm:py-3 border-b border-white/[0.06] bg-zinc-950 z-50">

        <!-- Left: tabs + editable toggle -->
        <div class="flex items-center gap-1.5 sm:gap-2 min-w-0">
          <!-- Tabs pill -->
          <div class="flex bg-zinc-900 border border-white/[0.07] rounded-xl p-1 gap-0.5 items-center flex-shrink-0">
            <button
              class="flex h-7 items-center gap-1.5 rounded-lg px-2 sm:px-2.5 transition-colors cursor-pointer text-[11px] font-medium
                {activeTab === 'preview' ? 'bg-white/[0.1] text-white' : 'text-zinc-500 hover:text-zinc-300'}"
              on:click={() => activeTab = 'preview'}
            >
              <svg viewBox="0 0 16 16" fill="none" width="12" height="12"><path d="M8 3C4.5 3 1.5 8 1.5 8s3 5 6.5 5 6.5-5 6.5-5-3-5-6.5-5Z" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.2"/></svg>
              <span class="hidden sm:inline">Preview</span>
            </button>
            <div class="w-px h-4 bg-white/[0.08]"></div>
            <button
              class="flex h-7 items-center gap-1.5 rounded-lg px-2 sm:px-2.5 transition-colors cursor-pointer text-[11px] font-medium
                {activeTab === 'code' ? 'bg-white/[0.1] text-white' : 'text-zinc-500 hover:text-zinc-300'}"
              on:click={() => activeTab = 'code'}
            >
              <svg viewBox="0 0 16 16" fill="none" width="12" height="12"><path d="M5.5 5L2.8 8l2.7 3M10.5 5l2.7 3-2.7 3M9 4.2L7 11.8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <span class="hidden sm:inline">Código</span>
            </button>
          </div>

          <!-- Editable toggle -->
          {#if activeTab === 'preview' && html}
            <button
              class="flex items-center gap-1.5 h-7 px-2 sm:px-2.5 rounded-xl border transition-all cursor-pointer text-[11px] font-medium flex-shrink-0
                {editableMode
                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                  : 'bg-zinc-900 border-white/[0.07] text-zinc-500 hover:text-zinc-300'}"
              on:click={() => editableMode = !editableMode}
            >
              <div class="relative w-7 h-4 rounded-full transition-colors {editableMode ? 'bg-emerald-500' : 'bg-zinc-700'}">
                <div class="absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform duration-200 {editableMode ? 'translate-x-3.5' : 'translate-x-0.5'}"></div>
              </div>
              <span class="hidden sm:inline">{editableMode ? 'Editable' : 'Edit'}</span>
            </button>
          {/if}
        </div>

        <!-- Right: actions -->
        <div class="flex gap-1 sm:gap-1.5 items-center flex-shrink-0">

          <!-- Publish -->
          {#if healthOk && html}
            <button
              on:click={handlePublish}
              disabled={isPublishing}
              class="flex h-7 items-center gap-1.5 px-2 sm:px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[11px] font-semibold shadow-lg transition-all cursor-pointer active:scale-95"
            >
              {#if isPublishing}
                <svg class="animate-spin" viewBox="0 0 16 16" fill="none" width="12" height="12"><circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.4" stroke-dasharray="8 8" opacity="0.5"/><path d="M8 2.5A5.5 5.5 0 0 1 13.5 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
              {:else}
                <svg viewBox="0 0 16 16" fill="none" width="12" height="12"><path d="M8 10V3M5 6l3-3 3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.5 11v1.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
              {/if}
              <span class="hidden sm:inline">{isPublishing ? 'Publicando…' : 'Publicar'}</span>
            </button>
          {/if}

          <!-- AI Adjust -->
          <button
            class="flex h-7 w-7 items-center justify-center rounded-xl border shadow-lg transition-all cursor-pointer active:scale-95
              {showAiPrompt
                ? 'bg-indigo-500/20 border-indigo-500/30 text-indigo-400'
                : 'bg-zinc-900 border-white/[0.07] text-zinc-400 hover:bg-zinc-800 hover:text-white'}"
            on:click={() => { showAiPrompt = !showAiPrompt; aiContextData = null; }}
            title="Edit with AI"
          >
            <svg viewBox="0 0 16 16" fill="none" width="12" height="12"><path d="M2 14L7.5 8.5M7.5 8.5L10.5 5.5C11.3 4.7 12.5 3.5 13 3M7.5 8.5L9.5 10.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="13" cy="3" r="1.6" fill="currentColor"/></svg>
          </button>

          <!-- Video from instruction -->
          <button
            class="flex h-7 items-center gap-1 rounded-xl border px-2 shadow-lg transition-all cursor-pointer active:scale-95 text-[11px] font-medium
              {showVideoPrompt ? 'bg-violet-500/20 border-violet-500/30 text-violet-300' : 'bg-zinc-900 border-white/[0.07] text-zinc-400 hover:bg-zinc-800 hover:text-white'}"
            on:click={() => { showVideoPrompt = !showVideoPrompt; videoError = ''; }}
            title="Create video with AI"
          >
            <svg viewBox="0 0 16 16" fill="none" width="12" height="12"><rect x="2" y="3.5" width="8.5" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M10.5 6.5l3-1.7v6.4l-3-1.7" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M5.5 6.4v3.2l2.5-1.6-2.5-1.6z" fill="currentColor" stroke="none"/></svg>
            <span class="hidden sm:inline">Video</span>
          </button>

          <!-- Copy -->
          <button
            class="flex h-7 w-7 items-center justify-center rounded-xl border border-white/[0.07] bg-zinc-900 text-zinc-400 shadow-lg transition-all hover:bg-zinc-800 hover:text-white cursor-pointer active:scale-95"
            on:click={copy}
            title="Copy HTML"
          >
            {#if copied}
              <svg viewBox="0 0 16 16" fill="none" width="12" height="12"><path d="M3 8l3.5 3.5L13 5" stroke="#4ade80" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            {:else}
              <svg viewBox="0 0 16 16" fill="none" width="12" height="12"><rect x="5" y="5" width="8" height="9" rx="1.4" stroke="currentColor" stroke-width="1.2"/><path d="M5 4V3a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v1" stroke="currentColor" stroke-width="1.2"/></svg>
            {/if}
          </button>

          <!-- Close -->
          <button
            class="flex h-7 w-7 items-center justify-center rounded-xl border border-white/[0.07] bg-zinc-900 text-zinc-400 shadow-lg transition-all hover:bg-red-500/15 hover:text-red-400 hover:border-red-500/25 cursor-pointer active:scale-95"
            on:click={close}
            title="Close (Esc)"
          >
            <svg viewBox="0 0 16 16" fill="none" width="12" height="12"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
          </button>
        </div>
      </header>

      <!-- ── Multi-page tabs ── -->
      {#if isMultiPage && pages.length > 1}
        <div class="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 border-b border-white/[0.05] bg-zinc-950/80 overflow-x-auto scrollbar-none">
          <span class="text-[9px] font-semibold text-zinc-600 uppercase tracking-wider mr-1 flex-shrink-0">Pages</span>
          {#each pages as page, i}
            <button
              on:click={() => switchPage(i)}
              class="flex-shrink-0 flex items-center gap-1.5 h-6 px-2.5 rounded-lg text-[11px] font-medium transition-all cursor-pointer
                {activePage === i
                  ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/25'
                  : 'text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.05] border border-transparent'}"
            >
              <span class="w-1.5 h-1.5 rounded-full flex-shrink-0 {activePage === i ? 'bg-indigo-400' : 'bg-zinc-700'}"></span>
              {page.title}
            </button>
          {/each}
          <!-- Export unified SPA button -->
          <button
            on:click={async () => {
              try { await navigator.clipboard.writeText(buildUnifiedSPA(pages)); copied = true; setTimeout(() => copied = false, 1800); } catch {}
            }}
            class="flex-shrink-0 flex items-center gap-1 h-6 px-2 rounded-lg text-[10px] font-medium text-zinc-600 hover:text-zinc-300 hover:bg-white/[0.05] transition-all ml-auto"
            title="Copy as unified SPA"
          >
            <svg viewBox="0 0 16 16" fill="none" width="10" height="10"><rect x="5" y="5" width="8" height="9" rx="1.4" stroke="currentColor" stroke-width="1.2"/><path d="M5 4V3a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v1" stroke="currentColor" stroke-width="1.2"/></svg>
            SPA
          </button>
        </div>
      {/if}

      <!-- ── Main area ── -->
      <div class="flex flex-1 min-h-0 overflow-hidden">

        <!-- Canvas -->
        <div class="flex-1 relative overflow-hidden bg-zinc-950 min-w-0">

          <!-- AI Adjust modal — full-width on mobile -->
          {#if showAiPrompt}
            <div class="absolute inset-x-0 top-0 sm:top-2 sm:left-1/2 sm:-translate-x-1/2 sm:w-full sm:max-w-lg sm:px-4 z-50 pointer-events-auto">
              <div class="rounded-none sm:rounded-2xl border-0 sm:border border-white/[0.08] bg-zinc-900 sm:bg-zinc-900/97 shadow-2xl shadow-black/70 overflow-hidden">
                <div class="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
                  <div class="flex items-center gap-2.5">
                    <div class="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-500/20">
                      <svg viewBox="0 0 16 16" fill="none" width="11" height="11"><path d="M2 14L7.5 8.5M7.5 8.5L10.5 5.5C11.3 4.7 12.5 3.5 13 3M7.5 8.5L9.5 10.5" stroke="#a5b4fc" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="13" cy="3" r="1.5" fill="#a5b4fc"/></svg>
                    </div>
                    <div>
                      <p class="text-[11px] font-semibold text-white leading-none">Edit with AI</p>
                      {#if aiContextData}
                        <p class="text-[10px] text-indigo-400 mt-0.5 font-mono">Elemento: &lt;{selectedElement?.tag ?? '?'}&gt;</p>
                      {:else}
                        <p class="text-[10px] text-zinc-500 mt-0.5">Describe the change</p>
                      {/if}
                    </div>
                  </div>
                  <button class="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.05] transition-colors"
                    on:click={() => { showAiPrompt = false; aiContextData = null; }}>
                    <svg viewBox="0 0 16 16" fill="none" width="11" height="11"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
                  </button>
                </div>

                {#if aiContextData}
                  <div class="px-4 pt-3 flex gap-2">
                    <div class="flex-1 rounded-lg bg-zinc-950/60 border border-white/[0.06] p-2.5 font-mono text-[10px] text-zinc-500 overflow-hidden max-h-10 leading-relaxed truncate">
                      {aiContextData.outerHtml?.slice(0, 100)}…
                    </div>
                  </div>
                {/if}

                <div class="p-4 flex flex-col gap-3">
                  <textarea
                    rows="3"
                    placeholder="E.g.: change the color to blue, increase the padding..."
                    bind:value={aiPromptText}
                    disabled={isAiProcessing}
                    class="w-full bg-zinc-950/60 border border-white/[0.07] rounded-xl px-3.5 py-2.5 text-xs text-zinc-200 outline-none placeholder-zinc-600 font-mono resize-none focus:border-indigo-500/40 transition-colors leading-relaxed"
                    style="font-size: 16px;"
                  ></textarea>
                  <div class="flex items-center justify-end">
                    <button
                      on:click={handleAiAdjust}
                      disabled={isAiProcessing || !aiPromptText.trim()}
                      class="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-semibold text-xs px-4 py-2.5 rounded-lg transition-colors cursor-pointer active:scale-95"
                    >
                      {#if isAiProcessing}
                        <svg class="animate-spin" viewBox="0 0 16 16" fill="none" width="11" height="11"><circle cx="8" cy="8" r="5" stroke="currentColor" stroke-width="1.5" stroke-dasharray="6 6" opacity="0.5"/><path d="M8 3A5 5 0 0 1 13 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                        Processando…
                      {:else}
                        <svg viewBox="0 0 16 16" fill="none" width="11" height="11"><path d="M3 8l4 4 6-8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        Aplicar
                      {/if}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          {/if}

          {#if showVideoPrompt}
            <div class="absolute inset-x-0 top-0 sm:top-2 sm:left-1/2 sm:-translate-x-1/2 sm:w-full sm:max-w-lg sm:px-4 z-50 pointer-events-auto">
              <div class="rounded-none sm:rounded-2xl border-0 sm:border border-violet-400/20 bg-zinc-900 sm:bg-zinc-900/97 shadow-2xl shadow-black/70 overflow-hidden">
                <div class="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
                  <div>
                    <p class="text-[11px] font-semibold text-white">Create video with AI</p>
                    <p class="text-[10px] text-zinc-500 mt-0.5">The script is prepared before rendering.</p>
                  </div>
                  <button class="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.05]" on:click={closeVideoPrompt} aria-label="Close video creator">×</button>
                </div>

                <div class="p-4 flex flex-col gap-3">
                  {#if !videoProject}
                    <textarea rows="4" bind:value={videoPromptText} disabled={isVideoProcessing}
                      placeholder="E.g.: a cup of coffee appears on a table at dawn; steam rises as the camera slowly moves in."
                      class="w-full bg-zinc-950/60 border border-white/[0.07] rounded-xl px-3.5 py-2.5 text-xs text-zinc-200 outline-none placeholder-zinc-600 font-mono resize-none focus:border-violet-500/40 transition-colors leading-relaxed" style="font-size:16px;"></textarea>
                    <label class="flex items-center gap-2 text-[11px] text-zinc-400 cursor-pointer select-none">
                      <input type="checkbox" bind:checked={videoWithProtocol} class="accent-violet-500" />
                      Usar protocolo visual para organizar as cenas
                    </label>
                    <button on:click={prepareCanvasVideo} disabled={isVideoProcessing || !videoPromptText.trim()}
                      class="self-end flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white font-semibold text-xs px-4 py-2.5 rounded-lg transition-colors cursor-pointer">
                      {isVideoProcessing ? 'Preparing…' : 'Prepare script'}
                    </button>
                  {:else if !videoGeneration}
                    <div class="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-zinc-300">
                      <p class="font-semibold text-emerald-300">Script ready for review</p>
                      <p class="mt-1 text-zinc-500">Generation starts only after your confirmation.</p>
                    </div>
                    <div class="flex justify-between gap-2">
                      <button class="text-xs text-zinc-500 hover:text-zinc-300" on:click={() => videoProject = null}>Edit request</button>
                      <button on:click={generateCanvasVideo} disabled={isVideoProcessing}
                        class="bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white font-semibold text-xs px-4 py-2.5 rounded-lg transition-colors cursor-pointer">
                        {isVideoProcessing ? 'Starting…' : 'Approve and generate video'}
                      </button>
                    </div>
                  {:else if videoGeneration.status === 'completed'}
                    <div class="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-200">Video complete.</div>
                    <video class="w-full rounded-xl border border-white/[0.08] bg-black" controls src={videoGeneration.videoUrl}></video>
                  {:else if videoGeneration.status === 'failed'}
                    <div class="rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-300">Rendering failed. You can adjust the request and try again.</div>
                  {:else}
                    <div class="rounded-xl border border-violet-500/20 bg-violet-500/5 p-3 text-xs text-violet-200">Rendering video… this may take a few moments.</div>
                  {/if}
                  {#if videoError}<p class="text-[11px] text-red-400">{videoError}</p>{/if}
                </div>
              </div>
            </div>
          {/if}

          <!-- Publish toasts -->
          {#if publishUrl}
            <div class="absolute inset-x-4 bottom-16 z-50 flex items-center justify-between rounded-xl border border-emerald-500/25 bg-emerald-950/90 p-3 backdrop-blur-md shadow-xl">
              <div class="flex items-center gap-2 text-emerald-400 text-xs font-mono">
                <svg viewBox="0 0 16 16" fill="none" width="14" height="14"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><path d="M5 8l2 2 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                Deploy realizado!
              </div>
              <a href={publishUrl} target="_blank" rel="noopener noreferrer" class="rounded-lg bg-emerald-500 px-3 py-1 text-xs font-semibold text-zinc-950 hover:bg-emerald-400 transition-colors">Open ↗</a>
            </div>
          {/if}
          {#if publishError}
            <div class="absolute inset-x-4 bottom-16 z-50 flex items-center gap-2 rounded-xl border border-red-500/25 bg-red-950/90 p-3 backdrop-blur-md shadow-xl">
              <svg viewBox="0 0 16 16" fill="none" width="14" height="14"><circle cx="8" cy="8" r="6" stroke="#f87171" stroke-width="1.5"/><path d="M8 5v4M8 11h.01" stroke="#f87171" stroke-width="1.5" stroke-linecap="round"/></svg>
              <span class="text-red-400 text-xs font-mono">{publishError}</span>
            </div>
          {/if}

          <!-- Preview iframe -->
          {#if activeTab === 'preview'}
            {#if html}
              <!-- FIX: no opacity flicker — wrapper stays, iframe srcdoc updates in place -->
              <div class="w-full h-full" class:pointer-events-none={isResizing}>
                <iframe
                  bind:this={iframeEl}
                  title="HTML Preview"
                  class="w-full h-full block border-none bg-white"
                  sandbox="allow-scripts"
                  srcdoc={iframeSrcdoc}
                  on:load={() => {
                    if (editableMode) sendToIframe({ type: 'SET_EDITABLE', enabled: true });
                  }}
                ></iframe>
              </div>
            {:else}
              <div class="flex flex-col items-center justify-center h-full gap-3 text-zinc-600 font-mono text-xs">
                <svg viewBox="0 0 48 48" fill="none" width="40" height="40" class="opacity-20"><rect x="6" y="8" width="36" height="32" rx="5" stroke="currentColor" stroke-width="1.2"/><path d="M18 20l-5 4 5 4M30 20l5 4-5 4M22 16l4 16" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                <p>No HTML to display</p>
              </div>
            {/if}

          {:else}
            <!-- Code editor -->
            <div class="w-full h-full bg-zinc-950">
              <textarea
                value={codeHtml}
                on:input={handleCodeInput}
                on:blur={() => pushHistory(html, 'Code edit')}
                on:keydown={handleCodeKeydown}
                class="w-full h-full bg-transparent text-zinc-300 font-mono text-sm p-4 resize-none border-none outline-none focus:ring-0 selection:bg-zinc-800 leading-relaxed"
                style="font-size: clamp(12px, 2.5vw, 14px);"
                placeholder="Enter or edit HTML code here..."
                spellcheck="false"
                autocorrect="off"
                autocapitalize="off"
              ></textarea>
            </div>
          {/if}
        </div>

        <!-- CSS Panel sidebar -->
        {#if showCssPanel && selectedElement && activeTab === 'preview'}
          <!-- On mobile: bottom sheet overlay; on desktop: right sidebar -->
          <div class="
            fixed md:relative
            inset-x-0 bottom-0 md:inset-auto
            z-50 md:z-auto
            h-80 md:h-auto md:w-64
            flex-shrink-0 overflow-hidden flex flex-col
            rounded-t-2xl md:rounded-none
            border-t md:border-t-0 md:border-l border-white/[0.05]
            bg-zinc-950
          ">
            <div class="flex items-center justify-between px-3 py-2 border-b border-white/[0.05]">
              <!-- Mobile drag handle -->
              <div class="md:hidden absolute top-1.5 left-1/2 -translate-x-1/2 w-10 h-1 rounded-full bg-zinc-700"></div>
              <span class="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mt-1 md:mt-0">Styles</span>
              <button
                class="flex h-6 w-6 items-center justify-center rounded text-zinc-600 hover:text-zinc-300 transition-colors"
                on:click={() => { showCssPanel = false; selectedElement = null; }}
              >
                <svg viewBox="0 0 16 16" fill="none" width="10" height="10"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
              </button>
            </div>
            <CssPanel
              element={selectedElement}
              open={true}
              on:applyCSS={handleApplyCSS}
              on:applyRawStyle={handleApplyRawStyle}
            />
          </div>
        {/if}
      </div>

      <!-- ── Footer: history ── -->
      <div class="flex-shrink-0 flex items-center px-2 sm:px-3 gap-1.5 sm:gap-2 border-t border-white/[0.04] bg-zinc-950 z-40 h-11">

        <button
          on:click={undo}
          disabled={!canUndo}
          class="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.06] bg-zinc-900 text-zinc-500 transition-all hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-25 disabled:cursor-not-allowed cursor-pointer active:scale-95"
          title="Undo"
        >
          <svg viewBox="0 0 16 16" fill="none" width="11" height="11"><path d="M3 7.5A5 5 0 0 1 13 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M3 4.5v3h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>

        <button
          on:click={redo}
          disabled={!canRedo}
          class="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.06] bg-zinc-900 text-zinc-500 transition-all hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-25 disabled:cursor-not-allowed cursor-pointer active:scale-95"
          title="Redo"
        >
          <svg viewBox="0 0 16 16" fill="none" width="11" height="11"><path d="M13 7.5A5 5 0 0 0 3 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M13 4.5v3h-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>

        {#if history.length > 1}
          <div class="flex items-center gap-1 flex-1 overflow-x-auto min-w-0" style="scrollbar-width:none">
            {#each history as entry, i}
              <button
                on:click={() => jumpHistory(i)}
                class="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-md transition-all text-[10px] font-mono cursor-pointer
                  {i === historyIndex
                    ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/25'
                    : i < historyIndex
                      ? 'text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.05]'
                      : 'text-zinc-700 hover:text-zinc-500 hover:bg-white/[0.05]'}"
                title="{entry.label} — {formatTs(entry.ts)}"
              >
                <span class="w-1.5 h-1.5 rounded-full flex-shrink-0 {i === historyIndex ? 'bg-indigo-400' : i < historyIndex ? 'bg-zinc-600' : 'bg-zinc-800'}"></span>
                {#if i === historyIndex}
                  <span class="truncate max-w-[60px] hidden sm:block">{i === 0 ? 'Inicial' : entry.label}</span>
                {/if}
              </button>
              {#if i < history.length - 1}
                <div class="w-2 h-px flex-shrink-0 {i < historyIndex ? 'bg-zinc-700' : 'bg-zinc-800/50'}"></div>
              {/if}
            {/each}
          </div>

          <button
            on:click={() => showHistory = !showHistory}
            class="flex-shrink-0 flex items-center gap-1 h-7 px-2 rounded-lg border border-white/[0.06] bg-zinc-900 text-[10px] font-mono transition-all cursor-pointer
              {showHistory ? 'bg-zinc-800 text-zinc-300 border-white/[0.1]' : 'text-zinc-500 hover:text-zinc-300'}"
          >
            <svg viewBox="0 0 16 16" fill="none" width="10" height="10"><circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.3"/><path d="M8 5.5V8.5l1.5 1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
            {historyIndex + 1}/{history.length}
          </button>
        {:else}
          <span class="text-[10px] text-zinc-700 font-mono">No history</span>
        {/if}

        <!-- History dropdown -->
        {#if showHistory && history.length > 1}
          <div class="absolute bottom-12 left-0 right-0 mx-2 z-50 rounded-xl border border-white/[0.08] bg-zinc-900 shadow-2xl shadow-black/60 overflow-hidden">
            <div class="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
              <p class="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">History</p>
              <button class="text-[10px] text-zinc-600 hover:text-zinc-400" on:click={() => showHistory = false}>Close</button>
            </div>
            <div class="max-h-48 overflow-y-auto">
              {#each [...history].reverse() as entry, ri}
                {@const i = history.length - 1 - ri}
                <button
                  on:click={() => jumpHistory(i)}
                  class="w-full flex items-center gap-3 px-3 py-2 text-left transition-colors
                    {i === historyIndex ? 'bg-indigo-500/12 text-indigo-300' : 'text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-200'}"
                >
                  <span class="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-md text-[9px] font-mono font-bold
                    {i === historyIndex ? 'bg-indigo-500/25 text-indigo-300' : 'bg-white/[0.05] text-zinc-600'}">
                    {i + 1}
                  </span>
                  <div class="flex-1 min-w-0">
                    <p class="text-[11px] font-medium truncate">{i === 0 ? 'Estado inicial' : entry.label}</p>
                    <p class="text-[10px] text-zinc-600 font-mono">{formatTs(entry.ts)} · {fmtSize(entry.size)}</p>
                  </div>
                  {#if i === historyIndex}
                    <span class="flex-shrink-0 text-[9px] text-indigo-400 font-semibold uppercase tracking-wider">current</span>
                  {/if}
                </button>
              {/each}
            </div>
          </div>
        {/if}
      </div>

    </aside>
  </div>
</div>
{/if}
