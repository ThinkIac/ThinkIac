<script>
    // ════════════════════════════════════════════════════════════════════
    // SmartView — recursive JSON viewer, "Black" theme
    // ════════════════════════════════════════════════════════════════════
    //
    // PROPS
    //   source          string  — raw JSON, only used at the ROOT call.
    //   data            any     — already-parsed value, used by recursive
    //                              <svelte:self> calls (and can be used
    //                              directly instead of `source` at the root).
    //   label           string  — explicit label for this block (lowest
    //                              priority, overridden by __title).
    //   expandMode      'full' | 'semi' | 'collapsed'
    //                              - full:      every level starts open
    //                              - semi:      only the root level starts
    //                                           open, everything nested
    //                                           starts closed
    //                              - collapsed: everything starts closed
    //   maxDepth        number  — safety cap on recursion depth.
    //   depth           number  — current recursion depth (internal).
    //   ancestors       array   — chain of visited object references,
    //                              used for cycle detection (internal).
    //
    // META-KEY CONVENTION
    //   "__title"              overrides the label of the block itself.
    //   "__{key}Title"         overrides the label shown for sibling `key`.
    //   Any key starting with "__" is:
    //     - never rendered as a row, and
    //     - stripped from the payload the copy button copies.
    //
    // ════════════════════════════════════════════════════════════════════

    export let source = undefined;
    export let data = undefined;
    export let label = null;
    export let expandMode = 'full'; // 'full' | 'semi' | 'collapsed'
    export let maxDepth = 8;
    export let depth = 0;
    export let ancestors = [];

    let parsedFromSource;
    let parseError = false;

    $: if (source !== undefined) {
        try {
            parsedFromSource = JSON.parse(source);
            parseError = false;
        } catch (e) {
            parsedFromSource = undefined;
            parseError = true;
        }
    }

    // Effective value rendered by this instance: `source` is parsed only at
    // the root; every recursive call receives an already-parsed `data`.
    $: value = source !== undefined ? parsedFromSource : data;

    // ─── EXPAND STATE ──────────────────────────────────────────────────
    // full:      this level open, and children inherit 'full'
    // semi:      this level open, children inherit 'collapsed'
    // collapsed: this level closed, children inherit 'collapsed'
    $: expanded = expandMode !== 'collapsed';
    $: childExpandMode = expandMode === 'full' ? 'full' : 'collapsed';

    let userToggled = false;
    let manualExpanded = true;

    function toggle() {
        userToggled = true;
        manualExpanded = !effectiveExpanded;
    }

    $: effectiveExpanded = userToggled ? manualExpanded : expanded;

    // resets the manual override whenever the incoming mode changes
    // (e.g. parent re-renders with a different expandMode)
    let lastMode = expandMode;
    $: if (expandMode !== lastMode) {
        lastMode = expandMode;
        userToggled = false;
    }

    // ─── META-KEY HELPERS ──────────────────────────────────────────────
    function isMetaKey(key) {
      return key.startsWith('__');
    }

    function getSelfLabelOverride(obj) {
      if (obj && typeof obj === 'object' && typeof obj.__title === 'string' && obj.__title.trim() !== '') {
        return obj.__title;
      }
      return null;
    }

    function getChildLabelOverride(obj, childKey) {
      const metaKey = `__${childKey}Title`;
      if (obj && typeof obj === 'object' && typeof obj[metaKey] === 'string' && obj[metaKey].trim() !== '') {
        return obj[metaKey];
      }
      return null;
    }

    function getVisibleEntries(obj) {
      return Object.entries(obj).filter(([key]) => !isMetaKey(key));
    }

    function stripMeta(val) {
      if (Array.isArray(val)) {
        return val.map(stripMeta);
      }
      if (val && typeof val === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(val)) {
          if (isMetaKey(k)) continue;
          out[k] = stripMeta(v);
        }
        return out;
      }
      return val;
    }

    // ─── TYPE / SHAPE HELPERS ──────────────────────────────────────────
    function getDataType(val) {
      if (val === null || val === undefined) return 'null';
      if (Array.isArray(val)) {
        if (val.length === 0) return 'empty';
        if (typeof val[0] === 'object' && val[0] !== null && !Array.isArray(val[0])) {
          return 'table';
        }
        return 'list';
      }
      if (typeof val === 'object') {
        if (getVisibleEntries(val).length === 0) return 'empty';
        return 'object';
      }
      if (typeof val === 'boolean') return 'boolean';
      return 'primitive';
    }

    function countItems(val) {
      if (Array.isArray(val)) return val.length;
      if (val && typeof val === 'object') return getVisibleEntries(val).length;
      return 0;
    }

    function isCyclic(val, chain) {
      if (!val || typeof val !== 'object') return false;
      return chain.includes(val);
    }

    function formatPrimitive(val) {
      if (typeof val === 'number') {
        return Number.isInteger(val) ? String(val) : Number(val.toFixed(4)).toString();
      }
      if (typeof val === 'string') {
        const urlPattern = /^(https?:\/\/|mailto:|tel:)/i;
        if (urlPattern.test(val)) {
          return `<a class="sv-link" href="${val}" target="_blank" rel="noopener noreferrer">${val}</a>`;
        }
        return val;
      }
      return String(val);
    }

    function normalizeKey(key) {
      return String(key);
    }

    function getTableColumns(rows) {
      const columns = [];
      rows.forEach(row => {
        if (row && typeof row === 'object' && !Array.isArray(row)) {
          getVisibleEntries(row).forEach(([key]) => {
            if (!columns.includes(key)) columns.push(key);
          });
        }
      });
      return columns;
    }

    // ─── COPY ──────────────────────────────────────────────────────────
    let copied = false;
    let copyTimer;

    async function copyBlock() {
      const payload = stripMeta(value);
      const text = JSON.stringify(payload, null, 2);
      try {
        await navigator.clipboard.writeText(text);
      } catch (e) {
        // fallback for environments without clipboard API permissions
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (_) {}
        document.body.removeChild(ta);
      }
      copied = true;
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copied = false), 1500);
    }

    $: type = getDataType(value);
    $: resolvedLabel = getSelfLabelOverride(value) || label || normalizeKey(type);
    $: itemCount = countItems(value);
    $: tableColumns = type === 'table' ? getTableColumns(value) : [];
    $: cycleDetected = isCyclic(value, ancestors);
    $: nextAncestors = value && typeof value === 'object' ? [...ancestors, value] : ancestors;
    $: isBlockType = type === 'object' || type === 'table' || type === 'list';
</script>

<div class="sv font-sans" class:sv-root={depth === 0}>
  {#if label && !isBlockType}
    <div class="sv-label">{label}</div>
  {/if}

  {#if cycleDetected}
    <span class="sv-pill sv-pill--warn">Cycle detected</span>

  {:else if parseError}
    <span class="sv-pill sv-pill--error">Failed to parse data</span>

  {:else if depth > maxDepth}
    <span class="sv-muted">Max depth reached</span>

  {:else if isBlockType}
    <div class="sv-block">
      <div class="sv-block__header">
        <button
          type="button"
          class="sv-block__toggle"
          on:click={toggle}
          aria-expanded={effectiveExpanded}
        >
          <svg class="sv-chevron" class:open={effectiveExpanded} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 6 15 12 9 18"></polyline>
          </svg>
          <span class="sv-block__label">{resolvedLabel}</span>
          <span class="sv-block__count">{itemCount} {itemCount === 1 ? 'item' : 'items'}</span>
        </button>

        <button
          type="button"
          class="sv-copy"
          class:copied
          on:click|stopPropagation={copyBlock}
          aria-label="Copy block as JSON"
          title="Copy block as JSON"
        >
          {#if copied}
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          {:else}
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          {/if}
          {#if copied}<span class="sv-copy__tip">Copied</span>{/if}
        </button>
      </div>

      {#if effectiveExpanded && type === 'table'}
        <div class="sv-table-wrap">
          <!--
            Rendered twice on purpose:
            - .sv-table (a real <table>) is shown when the container is
              wide enough.
            - .sv-table-cards (stacked key/value cards) is shown when it
              isn't. Both read from the same data, swapped via container
              query, so there's no layout recalculation or content
              re-render needed — CSS just toggles which one is visible
              based on the available width, not the viewport.
          -->
          <div class="sv-table-scroll">
            <table class="sv-table">
              <thead>
                <tr>
                  {#each tableColumns as col}
                    <th>{col}</th>
                  {/each}
                </tr>
              </thead>
              <tbody>
                {#each value as row}
                  <tr>
                    {#each tableColumns as col}
                      <td>
                        <svelte:self
                          data={row ? row[col] : undefined}
                          depth={depth + 1}
                          maxDepth={maxDepth}
                          expandMode={childExpandMode}
                          ancestors={nextAncestors}
                        />
                      </td>
                    {/each}
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>

          <div class="sv-table-cards">
            {#each value as row, rowIndex}
              <div class="sv-table-card">
                <div class="sv-table-card__index">#{rowIndex + 1}</div>
                <div class="sv-table-card__rows">
                  {#each tableColumns as col}
                    <div class="sv-table-card__row">
                      <span class="sv-table-card__key">{col}</span>
                      <div class="sv-table-card__value">
                        <svelte:self
                          data={row ? row[col] : undefined}
                          depth={depth + 1}
                          maxDepth={maxDepth}
                          expandMode={childExpandMode}
                          ancestors={nextAncestors}
                        />
                      </div>
                    </div>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        </div>

      {:else if effectiveExpanded && type === 'object'}
        <div class="sv-rows">
          {#each getVisibleEntries(value) as [key, entryValue]}
            <div class="sv-row">
              <span class="sv-row__key">
                {getChildLabelOverride(value, key) || key}:
              </span>
              <div class="sv-row__value">
                <svelte:self
                  data={entryValue}
                  depth={depth + 1}
                  maxDepth={maxDepth}
                  expandMode={childExpandMode}
                  ancestors={nextAncestors}
                />
              </div>
            </div>
          {/each}
        </div>

      {:else if effectiveExpanded && type === 'list'}
        <div class="sv-chips">
          {#each value as item}
            <div class="sv-chip">
              <svelte:self
                data={item}
                depth={depth + 1}
                maxDepth={maxDepth}
                expandMode={childExpandMode}
                ancestors={nextAncestors}
              />
            </div>
          {/each}
        </div>
      {/if}
    </div>

  {:else if type === 'empty'}
    <span class="sv-muted">Empty</span>

  {:else if type === 'boolean'}
    <span class="sv-pill" class:sv-pill--true={value} class:sv-pill--false={!value}>
      {value ? 'True' : 'False'}
    </span>

  {:else if type === 'null'}
    <span class="sv-muted">N/A</span>

  {:else}
    <span class="sv-primitive">{@html formatPrimitive(value)}</span>
  {/if}
</div>

<style>
  /* ════════════════════════════════════════════════════════════════════
     THEME TOKENS — falls back to a self-contained dark palette when the
     surrounding app doesn't already define these CSS variables (e.g.
     --txt, --border, --bot-bg from the chat UI's own theme system).
     ════════════════════════════════════════════════════════════════════ */
  .sv {
    --sv-txt: var(--txt, #e8e8e8);
    --sv-txt-2: var(--txt-2, #a3a3a3);
    --sv-txt-3: var(--txt-3, #707070);
    --sv-border: var(--border, var(--w10, rgba(255, 255, 255, 0.1)));
    --sv-border-hi: var(--border-hi, var(--w18, rgba(255, 255, 255, 0.18)));
    --sv-surface: var(--bot-bg, #161616);
    --sv-surface-2: rgba(255, 255, 255, 0.03);
    --sv-surface-3: rgba(255, 255, 255, 0.05);
    --sv-head-font: var(--font-head, inherit);
    --sv-mono-font: var(--font-mono, 'SF Mono', 'Ubuntu Mono', Consolas, monospace);
    --sv-body-font: var(--font-body, inherit);
    --sv-ease: cubic-bezier(0.4, 0, 0.2, 1);
    --sv-spring: cubic-bezier(0.34, 1.56, 0.64, 1);

    /* ── Fluid scale ──────────────────────────────────────────────────
       Every size below derives from these two base clamps, so the whole
       component scales as one coherent system instead of jumping
       between fixed breakpoint values. Driven by container width, not
       viewport width — a SmartView nested in a narrow sidebar looks
       just as good as one filling a wide panel. */
    --sv-unit: clamp(0.78rem, 0.65rem + 0.4cqi, 1rem);
    --sv-gap: clamp(0.5rem, 0.42rem + 0.3cqi, 0.75rem);
    --sv-radius: clamp(8px, 6px + 0.6cqi, 12px);

    container-type: inline-size;
    color: var(--sv-txt);
    font-family: var(--sv-body-font);
    width: 100%;
    max-width: 100%;
    font-size: var(--sv-unit);
    box-sizing: border-box;
  }

  .sv * {
    box-sizing: border-box;
  }

  .sv-label {
    font-weight: 700;
    text-transform: uppercase;
    font-size: 0.72em;
    letter-spacing: 0.08em;
    color: var(--sv-txt-3);
    margin-bottom: 0.5em;
  }

  .sv-muted {
    color: var(--sv-txt-3);
    font-style: italic;
    font-size: 0.93em;
  }

  .sv-link {
    color: #6ea8fe;
    text-decoration: underline;
    text-underline-offset: 2px;
    word-break: break-all;
  }

  .sv-primitive {
    color: var(--sv-txt);
    word-break: break-word;
    line-height: 1.6;
  }

  /* ─── PILLS ─────────────────────────────────────────────────────── */
  .sv-pill {
    display: inline-flex;
    align-items: center;
    padding: 0.15em 0.65em;
    border-radius: 999px;
    font-size: 0.8em;
    font-weight: 600;
    border: 1px solid var(--sv-border);
    background: var(--sv-surface-2);
    color: var(--sv-txt-2);
    line-height: 1.6;
  }
  .sv-pill--true {
    color: #5fd17a;
    border-color: rgba(95, 209, 122, 0.35);
    background: rgba(95, 209, 122, 0.08);
  }
  .sv-pill--false {
    color: #ff6b6b;
    border-color: rgba(255, 107, 107, 0.35);
    background: rgba(255, 107, 107, 0.08);
  }
  .sv-pill--warn {
    color: #f5c043;
    border-color: rgba(245, 192, 67, 0.35);
    background: rgba(245, 192, 67, 0.08);
  }
  .sv-pill--error {
    color: #ff6b6b;
    border-color: rgba(255, 107, 107, 0.35);
    background: rgba(255, 107, 107, 0.08);
  }

  /* ─── BLOCK CONTAINER ───────────────────────────────────────────── */
  .sv-block {
    container-type: inline-size;
    border: 0.75px solid var(--sv-border);
    border-radius: var(--sv-radius);
    background: var(--sv-surface);
    overflow: hidden;
    margin-bottom: var(--sv-gap);
    width: 100%;
  }
  .sv-block:last-child {
    margin-bottom: 0;
  }

  .sv-block__header {
    display: flex;
    align-items: stretch;
    background: var(--sv-surface-2);
  }

  .sv-block__toggle {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.6em;
    min-width: 0;
    padding: 0.62em 0.75em;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    color: var(--sv-txt);
    transition: background 0.15s var(--sv-ease);
    font-family: var(--sv-body-font);
    font-size: 1em;
    -webkit-tap-highlight-color: transparent;
  }
  .sv-block__toggle:hover {
    background: var(--w03, rgba(255, 255, 255, 0.03));
  }
  .sv-block__toggle:focus-visible {
    outline: 1.5px solid var(--sv-border-hi);
    outline-offset: -1.5px;
  }

  .sv-chevron {
    flex-shrink: 0;
    color: var(--sv-txt-3);
    width: 0.78em;
    height: 0.78em;
    transition: transform 0.2s var(--sv-spring), color 0.15s var(--sv-ease);
  }
  .sv-chevron.open {
    transform: rotate(90deg);
    color: var(--sv-txt-2);
  }

  .sv-block__label {
    font-weight: 600;
    font-size: 0.95em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    flex-shrink: 1;
  }

  .sv-block__count {
    margin-left: auto;
    flex-shrink: 0;
    font-family: var(--sv-mono-font);
    font-size: 0.7em;
    color: var(--sv-txt-3);
    letter-spacing: 0.02em;
    white-space: nowrap;
    padding-left: 0.5em;
  }

  /* ─── COPY BUTTON ───────────────────────────────────────────────────
     Fixed footprint at every size: a square, comfortably tappable hit
     area that never competes for space with the label (the label
     truncates with an ellipsis first) and never shrinks below a usable
     touch target. */
  .sv-copy {
    position: relative;
    flex-shrink: 0;
    width: 2.3em;
    min-width: 34px;
    align-self: stretch;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-left: 1px solid var(--sv-border);
    color: var(--sv-txt-3);
    cursor: pointer;
    transition: color 0.15s var(--sv-ease), background 0.15s var(--sv-ease);
    -webkit-tap-highlight-color: transparent;
  }
  .sv-copy svg {
    width: 0.95em;
    height: 0.95em;
  }
  .sv-copy:hover {
    color: var(--sv-txt);
    background: var(--w04, rgba(255, 255, 255, 0.04));
  }
  .sv-copy:active {
    transform: scale(0.92);
  }
  .sv-copy.copied {
    color: #5fd17a;
  }
  .sv-copy__tip {
    position: absolute;
    bottom: calc(100% + 0.4em);
    right: 0;
    font-size: 0.65em;
    font-family: var(--sv-mono-font);
    background: rgba(0, 0, 0, 0.88);
    color: var(--sv-txt);
    padding: 0.3em 0.6em;
    border-radius: 4px;
    white-space: nowrap;
    pointer-events: none;
    animation: sv-fade-up 0.14s var(--sv-ease) both;
  }

  @keyframes sv-fade-up {
    from { opacity: 0; transform: translateY(2px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* ─── OBJECT ROWS ───────────────────────────────────────────────── */
  .sv-rows {
    display: flex;
    flex-direction: column;
    gap: var(--sv-gap);
    padding: var(--sv-gap);
  }

  .sv-row {
    display: flex;
    flex-direction: column;
    gap: 0.25em;
    width: 100%;
    min-width: 0;
    /* a faint left guide gives nested rows a sense of hierarchy without
       the zig-zag indentation you get from padding every level */
    border-left: 1px solid transparent;
    padding-left: 0;
    transition: border-color 0.15s var(--sv-ease);
  }

  .sv-row__key {
    font-weight: 600;
    color: var(--sv-txt-2);
    font-size: 0.84em;
    word-break: break-word;
    letter-spacing: 0.01em;
  }

  .sv-row__value {
    width: 100%;
    min-width: 0;
  }

  /* ─── LIST CHIPS ────────────────────────────────────────────────── */
  .sv-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45em;
    padding: var(--sv-gap);
  }

  .sv-chip {
    background: var(--sv-surface-2);
    border: 0.75px solid var(--sv-border);
    border-radius: 999px;
    padding: 0.2em 0.75em;
    font-size: 0.85em;
    max-width: 100%;
    min-width: 0;
  }

  /* ════════════════════════════════════════════════════════════════════
     TABLE — dual representation
     A real <table> for wide containers, and a stack of key/value cards
     for narrow ones. Both render from the same markup at all times;
     container queries simply pick which one is visible. This avoids
     any layout thrash and keeps the switch perfectly smooth as a panel
     is resized.
     ════════════════════════════════════════════════════════════════════ */
  .sv-table-wrap {
    container-type: inline-size;
    width: 100%;
  }

  .sv-table-cards {
    display: none;
  }

  .sv-table-scroll {
    width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  .sv-table {
    width: 100%;
    border-collapse: collapse;
    text-align: left;
    font-size: 0.88em;
  }

  .sv-table thead {
    background: var(--sv-surface-2);
    border-bottom: 1px solid var(--sv-border);
  }

  .sv-table th {
    padding: 0.55em 0.75em;
    font-weight: 600;
    color: var(--sv-txt-2);
    white-space: nowrap;
    font-size: 0.85em;
  }

  .sv-table td {
    padding: 0.55em 0.75em;
    vertical-align: top;
    max-width: 320px;
    word-break: break-word;
    border-top: 1px solid var(--sv-border);
  }

  .sv-table tbody tr:hover {
    background: var(--w02, rgba(255, 255, 255, 0.02));
  }

  /* ─── Card layout (narrow containers) ──────────────────────────────
     Each row becomes a small panel: an index chip up top, then a clean
     two-column key/value grid — not a freeform stack — so values still
     align and the eye can scan down a column of keys. */
  .sv-table-cards {
    display: flex;
    flex-direction: column;
    gap: var(--sv-gap);
    padding: var(--sv-gap);
  }

  .sv-table-card {
    border: 0.75px solid var(--sv-border);
    border-radius: calc(var(--sv-radius) * 0.75);
    background: var(--sv-surface-2);
    overflow: hidden;
  }

  .sv-table-card__index {
    font-family: var(--sv-mono-font);
    font-size: 0.65em;
    letter-spacing: 0.06em;
    color: var(--sv-txt-3);
    padding: 0.45em 0.75em;
    border-bottom: 1px solid var(--sv-border);
    background: var(--w02, rgba(255, 255, 255, 0.02));
  }

  .sv-table-card__rows {
    display: flex;
    flex-direction: column;
  }

  .sv-table-card__row {
    display: grid;
    grid-template-columns: minmax(5.5em, 38%) 1fr;
    gap: 0.6em;
    padding: 0.5em 0.75em;
    border-top: 1px solid var(--sv-border);
    align-items: start;
  }
  .sv-table-card__row:first-child {
    border-top: none;
  }

  .sv-table-card__key {
    font-weight: 600;
    font-size: 0.82em;
    color: var(--sv-txt-2);
    word-break: break-word;
    padding-top: 0.15em;
  }

  .sv-table-card__value {
    min-width: 0;
  }

  /* Switch from table to cards once the table's own container gets
     tight — independent of the viewport, so this works correctly even
     for a SmartView embedded in a narrow column on a wide screen. */
  @container (max-width: 480px) {
    .sv-table-scroll {
      display: none;
    }
    .sv-table-cards {
      display: flex;
    }
  }

  /* ════════════════════════════════════════════════════════════════════
     CONTAINER-DRIVEN DENSITY
     Adjustments below respond to how much horizontal room *this
     component* actually has — not the viewport — so density is correct
     whether SmartView fills a phone screen or sits in a 320px sidebar
     on a desktop monitor.
     ════════════════════════════════════════════════════════════════════ */

  @container (max-width: 360px) {
    .sv-block__toggle {
      padding: 0.55em 0.6em;
      gap: 0.45em;
    }
    .sv-block__count {
      font-size: 0.62em;
    }
    .sv-rows,
    .sv-chips,
    .sv-table-cards {
      padding: calc(var(--sv-gap) * 0.8);
      gap: calc(var(--sv-gap) * 0.75);
    }
    .sv-table-card__row {
      grid-template-columns: 1fr;
      gap: 0.25em;
    }
    .sv-table-card__key {
      padding-top: 0;
    }
  }

  @container (max-width: 240px) {
    .sv-block__count {
      display: none;
    }
    .sv-block__label {
      font-size: 0.9em;
    }
  }

  /* keep the copy button comfortably tappable on touch devices
     regardless of container size */
  @media (hover: none) and (pointer: coarse) {
    .sv-copy {
      width: 2.6em;
      min-width: 38px;
    }
  }

  /* respect users who've asked for less motion */
  @media (prefers-reduced-motion: reduce) {
    .sv-chevron,
    .sv-copy,
    .sv-block__toggle,
    .sv-copy__tip {
      transition: none;
      animation: none;
    }
  }
</style>