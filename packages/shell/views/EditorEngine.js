// EditorEngine.js — injected as IIFE into the iframe srcdoc
// Protocol OUT → parent:
//   HTML_CHANGE       { html, label }
//   ELEMENT_SELECTED  { data: { tag, classes, inline, computed, outerHtml, text } }
//   ELEMENT_DESELECTED
//   AI_EDIT_REQUEST   { outerHtml, inlineCss, computedCss, pageStyles }
//   OPEN_CSS_PANEL
// Protocol IN ← parent:
//   SET_EDITABLE      { enabled }
//   APPLY_CSS         { property (camelCase), value }
//   APPLY_ATTRIBUTE   { attribute, value }

(function () {
    let editable = false;
    let selectedEl = null;
    let lastHtml = '';
    let blurTimer = null;
    let selBox = null;
    let toolbar = null;
  
    /* ── Injected styles ─────────────────────────────────────────────────────── */
    const s = document.createElement('style');
    s.id = '_ee';
    s.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Ubuntu:wght@400;500;600;700&family=Ubuntu+Mono:wght@400;700&display=swap');
      body._ee button, body._ee a, body._ee [role=button] {
        min-width:40px!important; min-height:24px!important;
      }
      body._ee *:empty:not(br):not(img):not(input):not(select):not(textarea):not(hr):not(svg):not(path):not(circle):not(rect):not(#_ee_sb):not(#_ee_tb):not(#_ee_tb *) {
        min-width:32px!important; min-height:20px!important;
        display:inline-block!important;
        background:rgba(99,102,241,.05)!important;
        border:1px dashed rgba(99,102,241,.3)!important;
        border-radius:3px;
      }
      body._ee *:not(#_ee_sb):not(#_ee_tb):not(#_ee_tb *):not(#_ee_lp):not(#_ee_lp *):hover {
        outline:1.5px dashed rgba(99,102,241,.45)!important;
        outline-offset:1px!important;
        cursor:pointer!important;
      }
      /* selection box */
      #_ee_sb {
        position:fixed; pointer-events:none; z-index:2147483630;
        border:2px solid #6366f1; border-radius:4px;
        box-shadow:0 0 0 4px rgba(99,102,241,.12);
        display:none; transition:top .06s,left .06s,width .06s,height .06s;
      }
      #_ee_sb._on { display:block; }
      /* toolbar */
      #_ee_tb {
        position:fixed; z-index:2147483647; display:none; align-items:center; gap:2px;
        background:#0a0a0b; border:1px solid rgba(255,255,255,.13); padding:3px;
        border-radius:10px; box-shadow:0 8px 28px rgba(0,0,0,.7),inset 0 0 0 1px rgba(255,255,255,.04);
        font-family:'Ubuntu', -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
      }
      #_ee_tb._on { display:flex; }
      #_ee_tb .sp { width:1px; height:14px; background:rgba(255,255,255,.1); margin:0 2px; }
      #_ee_tb button {
        background:transparent; border:none; color:#a1a1aa; cursor:pointer;
        font-size:11px; font-weight:500; padding:4px 7px; border-radius:7px;
        display:flex; align-items:center; gap:4px; transition:background .1s,color .1s;
      }
      #_ee_tb button:hover { background:rgba(255,255,255,.08); color:#fff; }
      #_ee_tb ._del:hover  { background:rgba(239,68,68,.18);   color:#f87171; }
      #_ee_tb ._ai:hover   { background:rgba(99,102,241,.2);   color:#a5b4fc; }
      #_ee_tb ._css:hover  { background:rgba(20,184,166,.18);  color:#5eead4; }
      #_ee_tb ._lnk:hover  { background:rgba(59,130,246,.18);  color:#93c5fd; }
      #_ee_tb * { outline:none!important; }
      /* link popover */
      #_ee_lp {
        position:fixed; z-index:2147483646; background:#0a0a0b;
        border:1px solid rgba(255,255,255,.13); border-radius:10px;
        box-shadow:0 8px 28px rgba(0,0,0,.7); padding:10px 12px;
        display:none; flex-direction:column; gap:8px; min-width:260px;
        font-family:'Ubuntu', -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
      }
      #_ee_lp._on { display:flex; }
      #_ee_lp label { font-size:10px; font-weight:600; letter-spacing:.08em; text-transform:uppercase; color:#71717a; }
      #_ee_lp input {
        background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.1);
        border-radius:6px; color:#e4e4e7; font-size:12px;
        font-family:'Ubuntu Mono', ui-monospace, monospace; outline:none; padding:6px 10px; width:100%;
      }
      #_ee_lp input:focus { border-color:rgba(99,102,241,.5); }
      #_ee_lp .row { display:flex; gap:6px; }
      #_ee_lp button { border:none; border-radius:6px; cursor:pointer; font-size:11px; font-weight:600; padding:5px 12px; }
      #_ee_lp .ok  { background:#6366f1; color:#fff; flex:1; }
      #_ee_lp .ok:hover { background:#818cf8; }
      #_ee_lp .cx { background:rgba(255,255,255,.06); color:#a1a1aa; }
      #_ee_lp .cx:hover { background:rgba(255,255,255,.1); color:#fff; }
    `;
    document.head.appendChild(s);
  
    /* ── Selection box ───────────────────────────────────────────────────────── */
    selBox = document.createElement('div');
    selBox.id = '_ee_sb';
    document.body.appendChild(selBox);
  
    function posSelBox(el) {
      if (!el) { selBox.classList.remove('_on'); return; }
      const r = el.getBoundingClientRect();
      selBox.style.cssText = `top:${r.top-2}px;left:${r.left-2}px;width:${r.width+4}px;height:${r.height+4}px;`;
      selBox.classList.add('_on');
    }
  
    /* ── Toolbar ─────────────────────────────────────────────────────────────── */
    toolbar = document.createElement('div');
    toolbar.id = '_ee_tb';
    toolbar.contentEditable = false;
    toolbar.innerHTML = `
      <button class="_ai" title="IA">
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M2 14L7.5 8.5m0 0L10 6c.8-.8 2-2 3-3m-5.5 5.5L9.5 10.5"/>
          <circle cx="13" cy="3" r="1.5" fill="currentColor" stroke="none"/>
        </svg>AI
      </button>
      <div class="sp"></div>
      <button class="_css" title="CSS">
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <path d="M2 4h12M4 8h8M6 12h4"/>
        </svg>CSS
      </button>
      <div class="sp _lsp"></div>
      <button class="_lnk _lbtn" title="Link" style="display:none">
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <path d="M7 9a3.5 3.5 0 0 0 5 0l2-2a3.536 3.536 0 0 0-5-5L8 3"/>
          <path d="M9 7a3.5 3.5 0 0 0-5 0L2 9a3.536 3.536 0 0 0 5 5L8 13"/>
        </svg>Link
      </button>
      <div class="sp"></div>
      <button class="_del" title="Delete">
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
          <path d="M4 4l8 8M12 4l-8 8"/>
        </svg>
      </button>
    `;
    document.body.appendChild(toolbar);
  
    /* ── Link popover ────────────────────────────────────────────────────────── */
    const lp = document.createElement('div');
    lp.id = '_ee_lp';
    lp.contentEditable = false;
    lp.innerHTML = `
      <label>URL / Link</label>
      <input type="text" id="_ee_li" placeholder="https://... ou #ancora"/>
      <div class="row"><button class="ok">Apply</button><button class="cx">Cancel</button></div>
    `;
    document.body.appendChild(lp);
  
    /* ── Helpers ─────────────────────────────────────────────────────────────── */
    function pageStyles() {
      return Array.from(document.querySelectorAll('style'))
        .filter(n => n.id !== '_ee').map(n => n.textContent).join('\n');
    }
  
    function snapComputed(el) {
      const c = window.getComputedStyle(el);
      const P = ['display','position','width','height','min-width','min-height','max-width','max-height',
        'margin','margin-top','margin-right','margin-bottom','margin-left',
        'padding','padding-top','padding-right','padding-bottom','padding-left',
        'font-family','font-size','font-weight','font-style','line-height','letter-spacing',
        'text-align','color','text-decoration','background','background-color',
        'border','border-radius','border-width','border-style','border-color',
        'box-shadow','opacity','overflow','flex','flex-direction','flex-wrap',
        'justify-content','align-items','gap','grid-template-columns','grid-template-rows',
        'transform','transition','z-index','top','left','right','bottom','cursor'];
      const o = {};
      P.forEach(p => { o[p] = c.getPropertyValue(p); });
      return o;
    }
  
    function sync(label) {
      const h = document.documentElement.outerHTML;
      if (h === lastHtml) return;
      lastHtml = h;
      window.parent.postMessage({ type: 'HTML_CHANGE', html: h, label }, '*');
    }
  
    function isLinkable(el) {
      const t = el.tagName?.toLowerCase();
      return t === 'a' || t === 'button' || el.getAttribute('role') === 'button';
    }
  
    function posToolbar(el) {
      const r = el.getBoundingClientRect();
      const top = Math.max(4, r.top - 38);
      toolbar.style.top  = top + 'px';
      toolbar.style.left = Math.max(4, r.left) + 'px';
      toolbar.classList.add('_on');
      const show = isLinkable(el);
      toolbar.querySelector('._lbtn').style.display = show ? 'flex' : 'none';
      toolbar.querySelector('._lsp').style.display  = show ? 'block' : 'none';
    }
  
    function selectEl(el) {
      if (!editable || !el || el === document.body || el === document.documentElement) {
        deselect(); return;
      }
      selectedEl = el;
      posSelBox(el);
      posToolbar(el);
      window.parent.postMessage({
        type: 'ELEMENT_SELECTED',
        data: {
          tag: el.tagName.toLowerCase(),
          classes: Array.from(el.classList).filter(c => !c.startsWith('_ee')),
          inline: el.getAttribute('style') || '',
          computed: snapComputed(el),
          outerHtml: el.outerHTML,
          text: el.innerText?.slice(0, 80) || '',
        }
      }, '*');
    }
  
    function deselect() {
      selectedEl = null;
      selBox.classList.remove('_on');
      toolbar.classList.remove('_on');
      lp.classList.remove('_on');
      window.parent.postMessage({ type: 'ELEMENT_DESELECTED' }, '*');
    }
  
    /* ── Events ──────────────────────────────────────────────────────────────── */
    document.addEventListener('click', e => {
      if (!editable) return;
      if ([toolbar, lp, selBox].some(n => n.contains(e.target))) return;
      e.preventDefault(); e.stopPropagation();
      if (e.target === document.body || e.target === document.documentElement) { deselect(); return; }
      selectEl(e.target);
    }, true);
  
    window.addEventListener('scroll', () => { if (selectedEl) posSelBox(selectedEl); }, true);
    window.addEventListener('resize', () => {
      if (!selectedEl) return;
      posSelBox(selectedEl); posToolbar(selectedEl);
    });
  
    /* blur → sync text edits */
    document.addEventListener('blur', () => {
      if (!editable) return;
      clearTimeout(blurTimer);
      blurTimer = setTimeout(() => sync('text-edit'), 220);
    }, true);
    document.addEventListener('focus', () => clearTimeout(blurTimer), true);
  
    /* outside click → close link pop */
    document.addEventListener('click', e => {
      if (!lp.contains(e.target) && !toolbar.contains(e.target)) lp.classList.remove('_on');
    });
  
    /* ── Toolbar actions ─────────────────────────────────────────────────────── */
    toolbar.querySelector('._ai').onclick = () => {
      if (!selectedEl) return;
      window.parent.postMessage({
        type: 'AI_EDIT_REQUEST',
        outerHtml: selectedEl.outerHTML,
        inlineCss: selectedEl.getAttribute('style') || '',
        computedCss: snapComputed(selectedEl),
        pageStyles: pageStyles(),
      }, '*');
    };
  
    toolbar.querySelector('._css').onclick = () => {
      if (selectedEl) window.parent.postMessage({ type: 'OPEN_CSS_PANEL' }, '*');
    };
  
    toolbar.querySelector('._lbtn').onclick = () => {
      if (!selectedEl) return;
      lp.querySelector('#_ee_li').value =
        selectedEl.getAttribute('href') || selectedEl.getAttribute('data-href') || '';
      const r = selectedEl.getBoundingClientRect();
      lp.style.top  = (r.bottom + 6) + 'px';
      lp.style.left = Math.max(4, r.left) + 'px';
      lp.classList.add('_on');
      toolbar.classList.remove('_on');
      setTimeout(() => lp.querySelector('#_ee_li').focus(), 40);
    };
  
    toolbar.querySelector('._del').onclick = () => {
      if (selectedEl && selectedEl !== document.body) {
        selectedEl.remove(); deselect(); sync('delete');
      }
    };
  
    lp.querySelector('.ok').onclick = () => {
      if (!selectedEl) { lp.classList.remove('_on'); return; }
      const v = lp.querySelector('#_ee_li').value.trim();
      if (selectedEl.tagName?.toLowerCase() === 'a') {
        selectedEl.href = v; selectedEl.setAttribute('href', v);
      } else {
        selectedEl.setAttribute('data-href', v);
        selectedEl.setAttribute('onclick', `window.location.href='${v}'`);
      }
      lp.classList.remove('_on');
      sync('link-edit');
    };
    lp.querySelector('.cx').onclick = () => lp.classList.remove('_on');
  
    /* ── Parent messages ─────────────────────────────────────────────────────── */
    window.addEventListener('message', e => {
      if (!e.data) return;
      const { type } = e.data;
  
      if (type === 'SET_EDITABLE') {
        editable = e.data.enabled;
        document.body.contentEditable = editable ? 'true' : 'false';
        document.body.style.outline = 'none';
        document.body.classList.toggle('_ee', editable);
        if (!editable) deselect();
      }
  
      if (type === 'APPLY_CSS' && selectedEl) {
        selectedEl.style[e.data.property] = e.data.value;
        // re-snapshot inline and push selection update
        window.parent.postMessage({
          type: 'ELEMENT_SELECTED',
          data: {
            tag: selectedEl.tagName.toLowerCase(),
            classes: Array.from(selectedEl.classList).filter(c => !c.startsWith('_ee')),
            inline: selectedEl.getAttribute('style') || '',
            computed: snapComputed(selectedEl),
            outerHtml: selectedEl.outerHTML,
            text: selectedEl.innerText?.slice(0, 80) || '',
          }
        }, '*');
        sync('css-edit');
      }
  
      if (type === 'APPLY_ATTRIBUTE' && selectedEl) {
        selectedEl.setAttribute(e.data.attribute, e.data.value);
        sync('attr-edit');
      }
    });
  })();
