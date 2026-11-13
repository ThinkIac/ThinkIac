<script>
  import { onMount, tick } from "svelte";

  const modes = [
    { id: "semi", label: "Semi", hint: "Uses an LLM classifier and a deterministic safety matrix." },
    { id: "manual", label: "Manual", hint: "Requires approval for every state-changing action." },
    { id: "auto", label: "Auto", hint: "Approves actions automatically. Blocked actions remain blocked." },
  ];
  const presets = [
    { id: "read_only", label: "Read only", hint: "Only proven queries run without approval." },
    { id: "workspace_edits", label: "Workspace edits", hint: "Creates and edits workspace files only." },
    { id: "custom", label: "Custom", hint: "Uses your written policy with the LLM classifier." },
  ];

  let theme = "dark";
  let sessionId = "default";
  let selectedMode = "manual";
  let selectedPreset = "read_only";
  let prompt = "";
  let activeTab = "policy";
  let confirmation = {};
  let confirmationForm = { generateWithAI: false, model: "" };
  let confirmationLoading = false;
  let confirmationSaving = false;
  let loading = true;
  let saving = false;
  let error = "";
  let saveTimer;
  let resizeObserver;

  function readTheme() {
    theme = localStorage.getItem("think:theme") === "light" ? "light" : "dark";
  }

  function onStorage(event) {
    if (event.key === "think:theme") readTheme();
  }

  function readSessionId() {
    try {
      const data = new URLSearchParams(location.hash.slice(1)).get("data");
      const payload = JSON.parse(decodeURIComponent(escape(atob(data))));
      sessionId = typeof payload.source === "string" && payload.source ? payload.source : "default";
    } catch {
      sessionId = "default";
    }
  }

  function reportHeight() {
    parent.postMessage({
      source: "aurora",
      type: "widget:height",
      detail: document.documentElement.scrollHeight,
    }, "*");
  }

  async function loadPolicy() {
    loading = true;
    error = "";
    try {
      const response = await fetch(`/governance/policy?sessionId=${encodeURIComponent(sessionId)}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      const policy = json?.data ?? json;
      selectedMode = policy?.mode || "manual";
      selectedPreset = policy?.preset || "read_only";
      prompt = policy?.prompt || "";
      reportState();
    } catch (cause) {
      error = `Could not load policy: ${cause.message}`;
    } finally {
      loading = false;
      await tick();
      reportHeight();
    }
  }

  async function loadConfirmationSettings() {
    confirmationLoading = true;
    try {
      const response = await fetch("/governance/confirmations/settings");
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || `HTTP ${response.status}`);
      confirmation = json?.data ?? json;
      confirmationForm = {
        generateWithAI: confirmation.generateWithAI === true,
        model: confirmation.model || "",
      };
    } catch (cause) {
      error = `Could not load confirmation settings: ${cause.message}`;
    } finally {
      confirmationLoading = false;
      await tick();
      reportHeight();
    }
  }

  async function saveConfirmationSettings() {
    confirmationSaving = true;
    error = "";
    try {
      const response = await fetch("/governance/confirmations/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generateWithAI: confirmationForm.generateWithAI, model: confirmationForm.model || null }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || `HTTP ${response.status}`);
      confirmation = json?.data ?? confirmation;
      confirmationForm.model = confirmation.model || "";
    } catch (cause) {
      error = `Could not save confirmation settings: ${cause.message}`;
    } finally {
      confirmationSaving = false;
      await tick();
      reportHeight();
    }
  }

  function reportState() {
    const modeLabel = modes.find((entry) => entry.id === selectedMode)?.label || selectedMode;
    const presetLabel = presets.find((entry) => entry.id === selectedPreset)?.label || selectedPreset;
    const label = selectedMode === "semi" ? `${modeLabel} · ${presetLabel}` : modeLabel;
    parent.postMessage({ source: "aurora", type: "widget:state", detail: { sessionId, label } }, location.origin);
  }

  function reportSelection() {
    parent.postMessage({ source: "aurora", type: "widget:selection", detail: { sessionId } }, location.origin);
  }

  async function savePolicy(closeAfterSelection = false) {
    saving = true;
    error = "";
    try {
      const response = await fetch("/governance/policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, mode: selectedMode, preset: selectedPreset, prompt }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json?.success === false) throw new Error(json?.error || `HTTP ${response.status}`);
      reportState();
      if (closeAfterSelection) reportSelection();
    } catch (cause) {
      error = `Could not save policy: ${cause.message}`;
    } finally {
      saving = false;
      await tick();
      reportHeight();
    }
  }

  function selectMode(mode) {
    if (saving) return;
    if (mode === selectedMode) { reportSelection(); return; }
    selectedMode = mode;
    savePolicy(true);
  }

  function schedulePromptSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(savePolicy, 600);
  }

  function selectPreset(preset) {
    if (saving) return;
    if (preset === selectedPreset) { reportSelection(); return; }
    selectedPreset = preset;
    if (preset !== "custom") prompt = "";
    savePolicy(true);
  }

  onMount(() => {
    readTheme();
    readSessionId();
    window.addEventListener("storage", onStorage);
    resizeObserver = new ResizeObserver(reportHeight);
    resizeObserver.observe(document.documentElement);
    loadPolicy();
    loadConfirmationSettings();
    return () => {
      clearTimeout(saveTimer);
      resizeObserver?.disconnect();
      window.removeEventListener("storage", onStorage);
    };
  });
</script>

<main data-theme={theme} aria-busy={loading}>
  {#if loading}
    <p class="status">Loading policy…</p>
  {:else}
    <div class="tabs" role="tablist" aria-label="Governance settings">
      <button class:active={activeTab === "policy"} role="tab" aria-selected={activeTab === "policy"} on:click={() => activeTab = "policy"}>Approval policy</button>
      <button class:active={activeTab === "confirmation"} role="tab" aria-selected={activeTab === "confirmation"} on:click={() => activeTab = "confirmation"}>Confirmations</button>
    </div>
    {#if activeTab === "policy"}
    <div class="mode-list">
      {#each modes as mode}
        <button class:selected={selectedMode === mode.id} disabled={saving} on:click={() => selectMode(mode.id)}>
          <span>{mode.label}</span>
          <small>{mode.hint}</small>
        </button>
      {/each}
    </div>

    {#if selectedMode === "semi"}
      <div class="preset-list" aria-label="Semi-automatic policy preset">
        {#each presets as preset}
          <button class:selected={selectedPreset === preset.id} disabled={saving} on:click={() => selectPreset(preset.id)}>
            <span>{preset.label}</span>
            <small>{preset.hint}</small>
          </button>
        {/each}
      </div>
      {#if selectedPreset === "custom"}
        <label>
          <span>Policy for this session</span>
          <textarea bind:value={prompt} on:input={schedulePromptSave} rows="3" placeholder="May edit project files and run tests, but never delete or publish."></textarea>
        </label>
      {/if}
      <p class="note">{saving ? "Saving…" : "Uncertain actions and LLM failures always require approval."}</p>
    {:else if selectedMode === "auto"}
      <p class="note">Actions run automatically and remain recorded in the audit.</p>
    {/if}
    {:else}
      <section class="confirmation" aria-busy={confirmationLoading}>
        <p class="note">Default message: <q>{confirmation.fixedMessage || "I need your confirmation to proceed with this action."}</q></p>
        <label class="toggle"><span>Generate a verbal question with AI</span><input type="checkbox" bind:checked={confirmationForm.generateWithAI} disabled={confirmationSaving} /></label>
        {#if confirmationForm.generateWithAI}
          <label><span>Model for the question</span><select bind:value={confirmationForm.model} required disabled={confirmationSaving}><option value="" disabled>Choose a model</option>{#each confirmation.options || [] as option}<option value={option.id} disabled={!option.poolEnabled}>{option.label}{option.poolEnabled ? "" : " (disabled pool)"}</option>{/each}</select></label>
          <p class="note">The AI receives only the tool and a redacted action summary. The approval card still shows the real command.</p>
        {/if}
        <button class="save" disabled={confirmationSaving || confirmationLoading} on:click={saveConfirmationSettings}>{confirmationSaving ? "Saving…" : "Save confirmations"}</button>
      </section>
    {/if}
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</main>

<style>
  :global(html), :global(body) { margin:0; padding:0; background:transparent; }
  [data-theme="dark"] { --tk-bg:#111111; --tk-surface:#181818; --tk-surface-2:#1f1f1f; --tk-border:rgba(255,255,255,.09); --tk-border-hi:rgba(255,255,255,.16); --tk-text:#f5f5f5; --tk-muted:#888888; --tk-muted-2:rgba(136,136,136,.5); --tk-accent:#f5f5f5; --tk-on-accent:#111111; }
  [data-theme="light"] { --tk-bg:#ffffff; --tk-surface:#f5f5f5; --tk-surface-2:#ececec; --tk-border:rgba(0,0,0,.10); --tk-border-hi:rgba(0,0,0,.18); --tk-text:#1a1a1a; --tk-muted:#666666; --tk-muted-2:rgba(0,0,0,.4); --tk-accent:#111111; --tk-on-accent:#ffffff; }
  main { --tk-radius-md:8px; --tk-radius-lg:14px; --tk-font:'Ubuntu',system-ui,sans-serif; --tk-mono:'Ubuntu Mono',monospace; box-sizing:border-box; padding:4px; color:var(--tk-text); font:400 12px var(--tk-font); }
  .tabs { display:flex; gap:4px; margin-bottom:10px; border-bottom:1px solid var(--tk-border); }
  .tabs button { width:auto; border-radius:var(--tk-radius-md) var(--tk-radius-md) 0 0; padding:7px 9px; }
  .tabs button.active { background:var(--tk-surface-2); border-color:var(--tk-border-hi); }
  .mode-list, .preset-list, .confirmation { display:grid; gap:2px; }
  .preset-list { margin-top:10px; padding-top:10px; border-top:1px solid var(--tk-border); }
  button { display:grid; gap:3px; width:100%; padding:9px 10px; border:1px solid transparent; border-radius:var(--tk-radius-md); background:transparent; color:var(--tk-text); text-align:left; cursor:pointer; }
  button:hover { background:var(--tk-surface-2); }
  button.selected { border-color:var(--tk-border-hi); background:var(--tk-surface-2); }
  button:disabled { opacity:.65; cursor:wait; }
  button span, label > span { font-weight:500; }
  button small, .note, .status { color:var(--tk-muted); font:400 11px/1.4 var(--tk-font); }
  label { display:grid; gap:6px; margin-top:10px; }
  textarea, select { box-sizing:border-box; width:100%; resize:vertical; padding:9px; border:1px solid var(--tk-border-hi); border-radius:var(--tk-radius-md); outline:none; background:var(--tk-surface); color:var(--tk-text); font:400 12px/1.4 var(--tk-font); }
  textarea:focus { border-color:var(--tk-accent); }
  .note, .status, .error { margin:8px 2px 2px; }
  .error { color:var(--tk-text); border-left:2px solid var(--tk-border-hi); padding-left:8px; }
  .toggle { display:flex; align-items:center; justify-content:space-between; }
  .toggle input { width:auto; }
  .save { margin-top:10px; border-color:var(--tk-border-hi); background:var(--tk-surface-2); }
</style>
