<script>
  import { createEventDispatcher, onDestroy, onMount, tick } from "svelte";
  import { fade, scale } from "svelte/transition";
  import { quintOut } from "svelte/easing";
  import SigmaLoader from "./components/SigmaLoader.svelte";
  import PackageWidget from "./components/PackageWidget.svelte";
  import InputBarIcon from "./components/InputBarIcon.svelte";
  import ModelSelector from "./components/ModelSelector.svelte";
  import SpecialistSelector from "./components/SpecialistSelector.svelte";
  import {
    bootstrapInputBarEntries,
    pinnedActions,
    stateEntries,
    allInputBarEntries,
    setEntryVisible,
    moveEntry,
    reorderKind,
    resetInputBarConfig,
  } from "./lib/inputbar_bootstrap.js";
  import { $ as busEmit } from "./lib/bus.js";
  import { listenSessionKey } from "./lib/message_actions.js";
  import { loadInputBarOptions, saveInputBarOptions } from "./lib/inputbar_options.js";
  import { shortModelLabel, fullModelLabel, visibleModelOptions } from "./lib/model_display.js";
  import { desktopShortcutGroups } from "./lib/desktop_shortcuts.js";

  // Defaults iguais no SSR e no primeiro render do browser.
  let optionsHydrated = false;
  const api = fetch;
  const dispatch = createEventDispatcher();

  // O runtime normalmente remove o envelope `{ data }` das rotas antes de
  // enviá-las ao browser. Algumas instalações/proxies ainda o preservam;
  // aceitar ambos evita que o seletor de modelos pareça vazio após uma
  // atualização parcial do runtime.
  function unwrapRouteData(payload) {
    return payload?.data && typeof payload.data === "object" ? payload.data : payload;
  }

  // ---- Contrato / Props ----
  export let value = "";
  export let loading = false;
  export let attachments = [];
  export let sessionId = "default";

  // ---- Settings ----
  export let moeEnabled = true;
  export let activeExpert = null;
  let modelOverride = "auto";
  let modelOptions = [{ id: "auto", label: "Auto" }];
  let modelLoadedFor = null;
  let modelSaving = false;

  // ---- Especialista da sessão (packages/specialists) ----
  // Mesma regra binária do modelo: fixou um especialista, a sessão INTEIRA
  // usa o prompt/tools/modelo dele; "None" devolve a sessão ao comportamento
  // normal (sem prompt extra, sem restrição de tools, roteamento padrão).
  let specialist = "none";
  let specialistOptions = []; // [{id, kind: "generic"|"custom", name, description}]
  let specialistLoadedFor = null;
  let specialistSaving = false;

  const reasoningModes = [
    { id: "auto", label: "Auto", full: "Automatic", disabled: false },
    { id: "cot", label: "CoT", full: "Chain of Thought", disabled: false },
    { id: "tot", label: "ToT", full: "Tree of Thought", disabled: true },
    { id: "aot", label: "AoT", full: "Atom of Thought", disabled: true },
  ];
  export let reasoningMode = "auto";

  const approximationLevels = [
    { id: "auto", label: "Auto" },
    { id: "full", label: "Full" },
    { id: "compact", label: "Compact" },
    { id: "detailed", label: "Detailed" },
  ];
  export let approximation = "auto";

  // Workspace é estado da sessão validado no servidor. O browser só navega e
  // pede uma seleção; nunca decide quais caminhos são autorizados.
  let workspace = null;
  let workspaceLoadedFor = null;
  let workspacePickerOpen = false;
  let workspaceBrowser = null;
  let workspaceLoading = false;
  let workspaceError = "";
  let workspaceModal;

  // ---- Entradas contribuídas por pacotes ----
  // Registry análogo ao dos menus: pacotes declaram `manifest.inputbar` e viram
  // um ícone fixável na barra. Anexar e falar são os ícones padrão; os demais
  // o usuário fixa (ou não) pelo gerenciador do "⋯".
  let openEntry = null;
  let entryRoot;
  let pinsOpen = false;
  let pinsRoot;
  let locationApproximate = true;
  let locationPending = false;
  let locationError = "";
  let oneTimeLocation = null;
  let resolveFlutterLocation = null;
  let locationModal;
  let listenSessionEnabled = false;
  // O ditado é nativo no APK Android. Mantemos o registry `native:voice` para
  // poder trocar este provider por Whispwr no futuro, sem criar outro ícone.
  let androidDevice = false;
  let dictationPrefix = "";

  function readListenSession() {
    if (typeof localStorage === "undefined") return;
    try {
      listenSessionEnabled = JSON.parse(localStorage.getItem(listenSessionKey(sessionId)) || "{}").enabled === true;
    } catch {
      listenSessionEnabled = false;
    }
  }

  function onListenSessionChange(event) {
    if (event.detail?.sessionId === sessionId) readListenSession();
  }

  function toggleListenSession() {
    if (typeof localStorage === "undefined" || typeof window === "undefined") return;
    const enabled = !listenSessionEnabled;
    listenSessionEnabled = enabled;
    const lastIndex = -1;
    localStorage.setItem(listenSessionKey(sessionId), JSON.stringify({ enabled, lastIndex }));
    window.dispatchEvent(new CustomEvent("agent:listen-session-change", {
      detail: { sessionId, enabled, lastIndex },
    }));
  }

  // Listas por natureza. A esquerda edita ações, a direita edita estado —
  // cada tipo se organiza onde ele vive, em vez de uma lista só misturando
  // ícone da barra com controle de sessão.
  $: allActions = $allInputBarEntries.filter((e) => e.kind !== "state");
  $: allStates = $allInputBarEntries.filter((e) => e.kind === "state");

  // O editor separa ações ativas e desativadas: uma ferramenta desligada não
  // compete visualmente com as disponíveis na barra.
  let pinsTab = "active";
  $: activeActions = allActions.filter((entry) => entry.visible);
  $: inactiveActions = allActions.filter((entry) => !entry.visible);
  $: drawerActions = pinsTab === "active" ? activeActions : inactiveActions;

  // ---- Arrasto para reordenar (pointer, não HTML5) ----
  // O drag-and-drop nativo do HTML não dispara em toque, e esta barra vive
  // dentro de uma WebView no app — lá o arrasto simplesmente não acontecia.
  // Pointer events funcionam em mouse e dedo igual, e começam a mover no
  // primeiro movimento a partir da alça, sem press-and-hold.
  let dragKind = null;
  let dragFrom = -1;
  let dragOver = -1;

  /** Índice da linha sob o ponteiro, medindo as linhas da mesma lista. */
  function indiceSobPonteiro(kind, clientY) {
    const linhas = document.querySelectorAll(`[data-drag="${kind}"]`);
    for (let i = 0; i < linhas.length; i++) {
      const r = linhas[i].getBoundingClientRect();
      if (clientY < r.bottom) return i;
    }
    return linhas.length - 1;
  }

  /** Pega o ponteiro já no primeiro toque da alça — nada de segurar. */
  function pegarPonteiro(e, kind, i) {
    e.preventDefault();
    dragKind = kind;
    dragFrom = i;
    dragOver = i;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function moverPonteiro(e) {
    if (dragKind === null) return;
    dragOver = indiceSobPonteiro(dragKind, e.clientY);
  }

  function soltarPonteiro() {
    if (dragKind !== null && dragFrom >= 0 && dragOver >= 0 && dragFrom !== dragOver) {
      const lista = dragKind === "state" ? allStates : drawerActions;
      const ids = lista.map((entry) => entry.id);
      const [movido] = ids.splice(dragFrom, 1);
      ids.splice(dragOver, 0, movido);
      if (dragKind === "state") {
        reorderKind(true, ids);
      } else {
        const reordered = [...ids];
        const idsInTab = new Set(ids);
        reorderKind(false, allActions.map((entry) => idsInTab.has(entry.id) ? reordered.shift() : entry.id));
      }
    }
    dragKind = null;
    dragFrom = -1;
    dragOver = -1;
  }

  // A abertura é transitória: toda visita começa com as seções fechadas.
  let openSection = null;
  $: if (!stateOpen) openSection = null;
  $: if (sessionId) openSection = null;

  function closeSelectedSection(id) {
    if (openSection !== id) return;
    const heading = stateRoot?.querySelector('[aria-expanded="true"].acc-head');
    openSection = null;
    heading?.focus();
  }

  // A caixa única de estado (modelo, aprovação, e o que os pacotes
  // acrescentarem) fica colada ao botão de enviar.
  let stateOpen = false;
  let stateRoot;
  let widgetSelections = {};
  $: if (sessionId) widgetSelections = {};

  function receiveWidgetState(id, event) {
    const detail = event.detail;
    if (detail?.sessionId !== sessionId || typeof detail.label !== "string") return;
    widgetSelections = { ...widgetSelections, [id]: detail.label.trim().slice(0, 160) };
  }


  /** Rótulo do que uma ação faz agora — o tooltip muda com o estado da voz. */
  function rotuloAcao(entry) {
    if (entry.native === "voice") {
      return recording ? "Stop recording" : transcribing ? "Transcribing…" : entry.label;
    }
    if (entry.native === "location" && oneTimeLocation) {
      return "Location ready for the next message";
    }
    if (entry.command === "toggle-listen-session") {
      return listenSessionEnabled ? "Parar de ouvir próximas respostas" : "Ouvir próximas respostas";
    }
    return entry.hint || entry.label;
  }

  /**
   * Aciona uma entrada de ação. Nativa chama a função local; de pacote abre a
   * view ou sinaliza no bus. É esse despacho que permite anexo e voz viverem
   * no mesmo registry das contribuições de pacote, em vez de serem markup fixo.
   */
  function acionar(entry) {
    if (entry.native === "attach") {
      fileInput?.click();
      return;
    }
    if (entry.native === "voice") {
      toggleMic();
      return;
    }
    if (entry.native === "location") {
      openEntry = openEntry?.id === entry.id ? null : entry;
      locationError = "";
      if (openEntry) tick().then(() => locationModal?.focus());
      return;
    }
    if (entry.command === "toggle-listen-session") {
      toggleListenSession();
      return;
    }
    if (entry.url) {
      // Abre numa caixinha própria, à parte da barra — a barra continua só com
      // ícones, sem o ruído de embutir o conteúdo do widget nela.
      openEntry = openEntry?.id === entry.id ? null : entry;
      return;
    }
    // Entrada sem view: só sinaliza no bus; o pacote reage do lado dele.
    busEmit(entry.event || `inputbar:${entry.id}`, { sessionId });
    dispatch("entry-action", { id: entry.id, event: entry.event ?? null });
  }

  // ---- Estado Interno ----
  const PASTE_TEXT_THRESHOLD = 800;

  let inputEl;
  let fileInput;
  let uploadError = "";
  let optionsOpen = false;
  let optionsRoot;
  let shortcutsOpen = false;
  let shortcutsRoot;
  let isDragging = false;

  // Só recarrega quando a sessão muda de fato: o bloco reativo acima roda a
  // cada alteração de estado do componente e refazer o GET a cada tecla
  // sobrescreveria o que o usuário está digitando no prompt do semi.
  $: if (sessionId && typeof window !== "undefined" && modelLoadedFor !== sessionId) {
    modelLoadedFor = sessionId;
    fetchModel(sessionId);
  }

  $: if (sessionId && typeof window !== "undefined" && specialistLoadedFor !== sessionId) {
    specialistLoadedFor = sessionId;
    fetchSpecialist(sessionId);
  }
  $: if (sessionId && typeof window !== "undefined" && workspaceLoadedFor !== sessionId) {
    workspaceLoadedFor = sessionId;
    fetchWorkspace(sessionId);
  }

  async function fetchWorkspace(id) {
    try {
      const response = await fetch(`/agent/session/workspace?session_id=${encodeURIComponent(id)}`);
      const data = response.ok ? (await response.json()) : null;
      if (workspaceLoadedFor === id) workspace = data?.workspace ?? null;
    } catch (error) { console.error("Failed to load workspace:", error); }
  }

  async function browseWorkspace(path = null) {
    workspaceLoading = true;
    workspaceError = "";
    workspaceBrowser = null;
    try {
      const suffix = path ? `?path=${encodeURIComponent(path)}` : "";
      const response = await fetch(`/agent/workspaces/browse${suffix}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      workspaceBrowser = data;
    } catch (error) { workspaceError = error.message; }
    finally { workspaceLoading = false; }
  }

  function openWorkspacePicker() {
    stateOpen = false;
    workspaceBrowser = null;
    workspacePickerOpen = true;
    browseWorkspace();
    tick().then(() => workspaceModal?.focus());
  }

  function closeWorkspacePicker() {
    workspacePickerOpen = false;
    stateOpen = false;
  }

  function onWorkspacePickerKeydown(event) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closeWorkspacePicker();
  }

  function portalToBody(node) {
    // As gavetas nascem dentro de .ib-wrap, onde vivem os aliases visuais
    // usados por este componente. Ao movê-las para body elas deixam de herdar
    // esse escopo e o fundo vira transparente. Congelar os tokens calculados
    // no portal preserva exatamente o tema ativo, sem reintroduzir cores locais.
    const inherited = getComputedStyle(node);
    for (const property of [
      "--tk-bg", "--tk-surface", "--tk-surface-2", "--tk-border", "--tk-border-hi", "--tk-text", "--tk-muted", "--tk-muted-2",
      "--ink-1", "--ink-2", "--ink-3", "--hair-1", "--hair-2", "--press-wash", "--hover-wash", "--sheet", "--raised",
      "--r-sm", "--r-md", "--r-lg", "--font-mono",
    ]) {
      const value = inherited.getPropertyValue(property).trim();
      if (value) node.style.setProperty(property, value);
    }
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }

  async function selectWorkspace(path) {
    workspaceLoading = true;
    workspaceError = "";
    try {
      const response = await fetch(`/agent/session/workspace`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, path }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      workspace = data.workspace ?? null;
      await closeWorkspacePicker();
    } catch (error) { workspaceError = error.message; }
    finally { workspaceLoading = false; }
  }

  async function fetchModel(id) {
    try {
      const response = await fetch(`/agent/session/model?session_id=${encodeURIComponent(id)}`);
      const state = response.ok ? unwrapRouteData(await response.json()) : {};
      const catalog = state.catalog ?? {};
      // Sessão nova sem modelo próprio herda a última escolha (localStorage).
      const remembered = loadInputBarOptions().model;
      if ((!state.model || state.model === "auto") && remembered && remembered !== "auto") {
        const propagate = await fetch(`/agent/session/model`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: id, model: remembered }),
        });
        if (propagate.ok) state.model = unwrapRouteData(await propagate.json()).model || remembered;
      }
      if (modelLoadedFor !== id) return;
      modelOverride = state.model || "auto";
      modelOptions = [
        { id: "auto", label: "Auto", description: "Escolhe pelo propósito, capacidades, evidências, custo e latência." },
        ...(catalog.accesses || [])
          .filter((access) => access.enabled && access.authenticated && access.available)
          .map((access) => ({
            id: access.id,
            name: access.name,
            model: access.model,
            label: shortModelLabel(access),
            provider: access.provider,
            // poolLabel é o rótulo legível do pool ("Ollama · local"); o id
            // técnico ("local") só entra quando o pool não declarou um.
            providerLabel: access.metadata?.poolLabel || access.metadata?.poolName || access.accessId || access.provider,
            purpose: access.purpose?.name || "",
            description: access.purpose?.description || "",
          })),
      ];
    } catch (error) { console.error("Erro ao buscar modelos:", error); }
  }

  async function selectModel(id) {
    if (modelSaving) return;
    if (id === modelOverride) { closeSelectedSection("native:model"); return; }
    const selectedFor = sessionId;
    const previous = modelOverride;
    modelOverride = id;
    modelSaving = true;
    try {
      const response = await fetch(`/agent/session/model`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: sessionId, model: id }) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = unwrapRouteData(await response.json());
      modelOverride = data.model || "auto";
      if (sessionId === selectedFor) closeSelectedSection("native:model");
    } catch (error) {
      modelOverride = previous;
      console.error("Erro ao fixar modelo:", error);
    } finally {
      modelSaving = false;
    }
  }

  async function fetchSpecialist(id) {
    try {
      const [stateResponse, catalogResponse] = await Promise.all([
        fetch(`/specialists/session?session_id=${encodeURIComponent(id)}`),
        fetch(`/specialists/catalog`),
      ]);
      const state = stateResponse.ok ? (await stateResponse.json()) : {};
      const catalog = catalogResponse.ok ? (await catalogResponse.json()) : {};
      if (specialistLoadedFor !== id) return;
      specialist = state.specialistId || "none";
      specialistOptions = catalog.specialists || [];
    } catch (error) {
      console.error("Erro ao buscar especialista da sessão:", error);
    }
  }

  async function selectSpecialist(id) {
    if (specialistSaving) return;
    if (id === specialist) { closeSelectedSection("native:specialist"); return; }
    const selectedFor = sessionId;
    // Especialistas começam sempre em uma conversa limpa. A Home é dona das
    // abas/sessões, portanto ela cria e ativa a sessão antes de a InputBar
    // passar a consultar seu estado.
    if (id !== "none") {
      closeSelectedSection("native:specialist");
      dispatch("newSpecialistSession", { specialistId: id });
      return;
    }
    const previous = specialist;
    specialist = id;
    specialistSaving = true;
    try {
      const response = await fetch(`/specialists/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, specialist_id: id === "none" ? null : id }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      // Confia no servidor, não no clique — mesma regra do modelo.
      specialist = data.specialistId || "none";
      if (sessionId === selectedFor) closeSelectedSection("native:specialist");
    } catch (error) {
      specialist = previous; // reverte: melhor a UI recuar do que mentir
      console.error("Erro ao fixar especialista:", error);
    } finally {
      specialistSaving = false;
    }
  }

  onMount(() => {
    androidDevice = /Android/i.test(window.navigator.userAgent || "");
    const saved = loadInputBarOptions();
    moeEnabled = saved.moeEnabled;
    reasoningMode = saved.reasoningMode;
    approximation = saved.approximation;
    locationApproximate = saved.locationApproximate;
    pinsTab = saved.pinsTab;
    optionsHydrated = true;
    // Entradas de InputBar contribuídas por pacotes (manifest.inputbar).
    bootstrapInputBarEntries();
    readListenSession();
    window.addEventListener("agent:listen-session-change", onListenSessionChange);
    // Contrato mínimo com o host Flutter: o WebView responde chamando esta
    // função com { latitude, longitude, accuracyMeters }. No navegador, o
    // mesmo fluxo usa navigator.geolocation diretamente.
    window.ThinkIacLocationResult = (result) => {
      resolveFlutterLocation?.(result);
      resolveFlutterLocation = null;
    };
    window.addEventListener("thinkiac:android:input.voice.result", onAndroidDictationResult);
    window.addEventListener("thinkiac:android:input.voice.state", onAndroidDictationState);
    window.addEventListener("thinkiac:android:input.voice.error", onAndroidDictationError);
  });

  onDestroy(() => {
    if (typeof window !== "undefined") {
      delete window.ThinkIacLocationResult;
      window.removeEventListener("agent:listen-session-change", onListenSessionChange);
      window.removeEventListener("thinkiac:android:input.voice.result", onAndroidDictationResult);
      window.removeEventListener("thinkiac:android:input.voice.state", onAndroidDictationState);
      window.removeEventListener("thinkiac:android:input.voice.error", onAndroidDictationError);
      attachments.forEach((a) => {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      });
    }
  });

  $: if (sessionId && typeof window !== "undefined") readListenSession();

  // ---- Lógica de Upload ----
  async function uploadFile(file) {
    const previewUrl = URL.createObjectURL(file);
    const pending = {
      file,
      previewUrl,
      uploading: true,
      error: null,
      uploadedData: null,
    };
    attachments = [...attachments, pending];
    const idx = attachments.length - 1;

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("sessionId", sessionId);

      const res = await api("/agent/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const data = json.data ?? json;

      attachments = attachments.map((a, i) =>
        i === idx ? { ...a, uploading: false, uploadedData: data } : a,
      );
    } catch (err) {
      attachments = attachments.map((a, i) =>
        i === idx ? { ...a, uploading: false, error: err.message } : a,
      );
    }
  }

  async function handleFileChange(e) {
    const files = Array.from(e.target.files);
    uploadError = "";
    for (const file of files) {
      await uploadFile(file);
    }
    e.target.value = "";
  }

  // ---- Voz: grava do mic, transcreve via /agent/transcribe (llm:stt) ----
  let recording = false;
  let transcribing = false;
  let mediaRecorder = null;
  let audioChunks = [];
  let transcribedFromAudio = false;
  // Timer da gravação: sem ele, o único sinal de que o mic está ligado é a cor
  // do ícone — insuficiente para saber há quanto tempo se está gravando.
  let recordSeconds = 0;
  let recordTimer = null;

  function onAndroidDictationResult(event) {
    const text = String(event.detail?.text || "").trim();
    value = text ? `${dictationPrefix}${text}` : dictationPrefix.trimEnd();
    if (text) transcribedFromAudio = true;
    tick().then(resize);
  }

  function onAndroidDictationState(event) {
    if (event.detail?.listening !== false) return;
    recording = false;
    stopRecordClock();
  }

  function onAndroidDictationError(event) {
    recording = false;
    stopRecordClock();
    uploadError = `Microfone indisponível: ${event.detail?.message || "erro desconhecido"}`;
  }

  async function toggleAndroidDictation() {
    const bridge = window.__android;
    if (!bridge?.call) {
      uploadError = "Ditado nativo indisponível neste Android.";
      return;
    }
    if (recording) {
      try {
        await bridge.call("input.voice.stop", { sessionId });
      } catch (error) {
        uploadError = `Não foi possível parar o ditado: ${error.message}`;
      }
      return;
    }
    uploadError = "";
    dictationPrefix = value.trimEnd();
    if (dictationPrefix) dictationPrefix += " ";
    recording = true;
    startRecordClock();
    try {
      await bridge.call("input.voice.start", { sessionId });
    } catch (error) {
      recording = false;
      stopRecordClock();
      uploadError = `Microfone indisponível: ${error.message}`;
    }
  }

  function startRecordClock() {
    recordSeconds = 0;
    clearInterval(recordTimer);
    recordTimer = setInterval(() => (recordSeconds += 1), 1000);
  }

  function stopRecordClock() {
    clearInterval(recordTimer);
    recordTimer = null;
  }

  async function toggleMic() {
    if (androidDevice) {
      await toggleAndroidDictation();
      return;
    }
    if (recording) {
      mediaRecorder?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size) audioChunks.push(e.data);
      };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        recording = false;
        stopRecordClock();
        const blob = new Blob(audioChunks, {
          type: mediaRecorder?.mimeType || "audio/webm",
        });
        if (!blob.size) return;
        transcribing = true;
        try {
          const fd = new FormData();
          fd.append("file", blob, "audio.webm");
          const res = await api("/agent/transcribe", { method: "POST", body: fd });
          const responseText = await res.text();
          let json = null;
          try {
            json = responseText ? JSON.parse(responseText) : null;
          } catch {
            // O fallback HTML do servidor (404/500) não pode mascarar o status
            // real como um erro de parser no InputBar.
          }
          if (!res.ok) {
            const message =
              json?.data?.error ||
              json?.error ||
              `Rota de transcrição indisponível (HTTP ${res.status})`;
            throw new Error(message);
          }
          if (!json) throw new Error("A transcrição retornou uma resposta inválida");
          const text = (json.data ?? json)?.text ?? "";
          if (!text.trim()) throw new Error("A transcrição retornou vazia");
          value = value ? `${value} ${text}` : text;
          transcribedFromAudio = true;
        } catch (err) {
          uploadError = `Transcrição falhou: ${err.message}`;
        } finally {
          transcribing = false;
        }
      };
      mediaRecorder.start();
      recording = true;
      startRecordClock();
    } catch (err) {
      uploadError = `Microfone indisponível: ${err.message}`;
    }
  }

  onDestroy(() => {
    stopRecordClock();
    try {
      mediaRecorder?.stop();
    } catch {}
  });

  // ---- Interações do Input ----
  async function handlePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;

    const filesToUpload = [];

    for (const item of items) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) filesToUpload.push(file);
      }
    }

    const text = e.clipboardData.getData("text/plain");
    const isLargeText = text && text.length > PASTE_TEXT_THRESHOLD;

    if (filesToUpload.length === 0 && !isLargeText) return;

    e.preventDefault();
    uploadError = "";

    if (isLargeText) {
      const blob = new Blob([text], { type: "text/plain" });
      const filename = `pasted-${Date.now()}.unkwn`;
      filesToUpload.push(new File([blob], filename, { type: "text/plain" }));
    }

    for (const file of filesToUpload) {
      await uploadFile(file);
    }
  }

  function handleDragOver(e) {
    e.preventDefault();
    isDragging = true;
  }

  function handleDragLeave(e) {
    e.preventDefault();
    // Previne flickering quando o mouse se move sobre elementos filhos do container
    if (!e.currentTarget.contains(e.relatedTarget)) {
      isDragging = false;
    }
  }

  async function handleDrop(e) {
    e.preventDefault();
    isDragging = false;
    uploadError = "";

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files);
      for (const file of files) {
        await uploadFile(file);
      }
    }
  }

  function removeAttachment(index) {
    const a = attachments[index];
    if (a?.previewUrl) URL.revokeObjectURL(a.previewUrl);
    attachments = attachments.filter((_, i) => i !== index);
  }

  function browserLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Location is not available on this device"));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => resolve({
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracyMeters: coords.accuracy,
        }),
        (error) => reject(new Error(error.message || "Location permission denied")),
        { enableHighAccuracy: !locationApproximate, timeout: 15000, maximumAge: 0 },
      );
    });
  }

  function flutterLocation() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        resolveFlutterLocation = null;
        reject(new Error("The app did not respond to the location request"));
      }, 15000);
      resolveFlutterLocation = (result) => {
        clearTimeout(timeout);
        if (result?.error) reject(new Error(result.error));
        else resolve(result);
      };
      window.FlutterBridge?.postMessage(JSON.stringify({
        type: "request-location",
        precision: locationApproximate ? "approximate" : "precise",
        consent: "one_time",
      }));
    });
  }

  async function requestOneTimeLocation() {
    locationPending = true;
    locationError = "";
    try {
      const result = window.FlutterBridge?.postMessage
        ? await flutterLocation()
        : await browserLocation();
      const latitude = Number(result?.latitude);
      const longitude = Number(result?.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        throw new Error("The device returned an invalid location");
      }
      oneTimeLocation = {
        latitude,
        longitude,
        accuracyMeters: Number(result?.accuracyMeters ?? result?.accuracy),
        precision: locationApproximate ? "approximate" : "precise",
        consent: "one_time",
      };
      openEntry = null;
    } catch (error) {
      locationError = error.message;
    } finally {
      locationPending = false;
    }
  }

  function onSend() {
    // `loading` não bloqueia mais: enviar durante a resposta enfileira a
    // mensagem no servidor (input não-bloqueante, estilo Claude)
    if (!value.trim() && attachments.length === 0) return;
    const hasUploading = attachments.some((a) => a.uploading);
    if (hasUploading) return;

    dispatch("send", {
      text: value.trim(),
      attachments: attachments.map((a) => a.uploadedData).filter(Boolean),
      settings: { model: modelOverride, moeEnabled, reasoningMode, approximation },
      metadata: {
        timestamp: new Date().toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        ...(transcribedFromAudio ? { input_mode: "audio" } : {}),
        ...(oneTimeLocation ? { location: oneTimeLocation } : {}),
      },
    });
    // Consentimento é para uma mensagem: a posição nunca vai para storage e
    // deixa a memória assim que o payload do próximo envio foi construído.
    oneTimeLocation = null;
    transcribedFromAudio = false;
    value = "";
    if (inputEl) inputEl.style.height = "auto";
    attachments = [];
  }

  function onStop() {
    dispatch("stop", sessionId);
  }

  function onKeydown(e) {
    // No mobile, o teclado virtual usa Enter para continuar escrevendo.
    // O envio permanece uma ação explícita no botão para evitar mensagens
    // acidentais; no desktop, preservamos o atalho existente.
    if (window.matchMedia("(max-width: 820px)").matches) return;

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }

  function resize() {
    if (!inputEl) return;
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 220) + "px";
  }

  // ---- Menus e Configurações ----
  function emitSettingsChange() {
    dispatch("settings-change", {
      model: modelOverride,
      moeEnabled,
      reasoningMode,
      approximation,
    });
  }

  function toggleMoe() {
    moeEnabled = !moeEnabled;
    if (!moeEnabled) activeExpert = null;
    emitSettingsChange();
  }

  function selectApproximation(levelId) {
    approximation = levelId;
    emitSettingsChange();
  }

  function handleClickOutside(e) {
    if (optionsOpen && optionsRoot && !optionsRoot.contains(e.target)) {
      optionsOpen = false;
    }
    if (stateOpen && stateRoot && !stateRoot.contains(e.target)) {
      stateOpen = false;
    }
    if (openEntry && entryRoot && !entryRoot.contains(e.target)) {
      openEntry = null;
    }
    if (pinsOpen && pinsRoot && !pinsRoot.contains(e.target)) {
      pinsOpen = false;
    }
    if (shortcutsOpen && shortcutsRoot && !shortcutsRoot.contains(e.target)) {
      shortcutsOpen = false;
    }
  }

  function toggleShortcuts() {
    shortcutsOpen = !shortcutsOpen;
    if (!shortcutsOpen) return;
    optionsOpen = false;
    stateOpen = false;
    openEntry = null;
    pinsOpen = false;
  }

  function handleKeydownGlobal(e) {
    if (e.key === "Escape") {
      workspacePickerOpen = false;
      optionsOpen = false;
      stateOpen = false;
      openEntry = null;
      pinsOpen = false;
      shortcutsOpen = false;
    }
  }

  // Grava somente depois da hidratação, nunca durante SSR.
  $: if (optionsHydrated) saveInputBarOptions({
    moeEnabled, reasoningMode, approximation, locationApproximate, pinsTab, model: modelOverride,
  });

  // ---- Reatividade ----
  $: hasUploading = attachments.some((a) => a.uploading);
  $: canSend = (value.trim() || attachments.length > 0) && !hasUploading;

  $: modelOption = modelOptions.find((entry) => entry.id === modelOverride);
  $: modelLabel = modelOption?.label ?? modelOverride;
  $: modelInlineLabel = modelOverride === "auto" ? "Auto" : shortModelLabel(modelOption ?? { id: modelOverride, label: modelLabel });
  $: modelFullLabel = modelOverride === "auto" ? "Auto" : fullModelLabel(modelOption ?? { id: modelOverride, label: modelLabel });

  $: specialistLabel = specialist === "none"
    ? "None"
    : (specialistOptions.find((entry) => entry.id === specialist)?.name ?? specialist);
  $: recordClock = `${Math.floor(recordSeconds / 60)}:${String(recordSeconds % 60).padStart(2, "0")}`;

  $: selectedOptions = $stateEntries.map((entry) => ({
    id: entry.id,
    label: entry.label,
    value: entry.native === "model" ? modelFullLabel
      : entry.native === "specialist" ? (specialist !== "none" ? specialistLabel : "")
      : widgetSelections[entry.id] || "",
  })).filter((entry) => entry.value);
  $: summaryOptions = workspace?.label
    ? [...selectedOptions, { id: "workspace", label: "Workspace", value: workspace.label }]
    : selectedOptions;
  $: selectionSummary = summaryOptions.map((entry) => entry.value).join(" - ");
  $: selectionDescription = selectionSummary;

  // Até três ações em destaque, mais o botão de ferramentas.
  let rowEl;
</script>

<svelte:window
  on:mousedown={handleClickOutside}
  on:keydown={handleKeydownGlobal}
/>

<div class="ib-wrap">
  <div
    class="ib-shell"
    role="group"
    aria-label="Campo de comando"
    class:dragging={isDragging}
    on:dragover={handleDragOver}
    on:dragleave={handleDragLeave}
    on:drop={handleDrop}
  >
    {#if isDragging}
      <div transition:fade={{ duration: 150 }} class="ib-drop">
        <span>Solte os arquivos aqui</span>
      </div>
    {/if}

    {#if attachments.length > 0}
      <div class="ib-attachments">
        {#each attachments as attr, i (attr.previewUrl || i)}
          <div
            transition:scale={{ duration: 250, start: 0.8, easing: quintOut }}
            class="att"
            class:uploading={attr.uploading}
            class:error={attr.error}
          >
            {#if attr.uploadedData?.isImage}
              <img src={attr.previewUrl} alt="upload-preview" />
            {:else if attr.uploadedData?.isText}
              <div class="att-file">
                <svg viewBox="0 0 24 24" fill="none" width="15" height="15">
                  <path
                    d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"
                    stroke="currentColor"
                    stroke-width="1.5"
                  />
                  <polyline points="14 2 14 8 20 8" stroke="currentColor" stroke-width="1.5" />
                </svg>
                <span
                  >{attr.file.name.length > 12
                    ? attr.file.name.slice(0, 10) + "…"
                    : attr.file.name}</span
                >
              </div>
            {:else if attr.uploading}
              <div class="att-center"><SigmaLoader size={14} /></div>
            {:else if attr.error}
              <div class="att-center att-err">
                <svg viewBox="0 0 18 18" fill="none" width="14" height="14">
                  <circle cx="9" cy="9" r="7" stroke="currentColor" stroke-width="1.4" />
                  <path
                    d="M9 5v4M9 13h.01"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                  />
                </svg>
              </div>
            {:else}
              <img src={attr.previewUrl} alt="upload" />
            {/if}
            <button class="att-x press" on:click={() => removeAttachment(i)} aria-label="Remover anexo"
              >×</button
            >
          </div>
        {/each}
      </div>
    {/if}

    {#if uploadError}
      <div class="ib-error">{uploadError}</div>
    {/if}

    {#if moeEnabled && activeExpert}
      <div transition:fade={{ duration: 200 }} class="ib-expert">
        <span class="pip"></span>
        Active expert: <strong>{activeExpert}</strong>
      </div>
    {/if}

    <textarea
      bind:this={inputEl}
      bind:value
      on:keydown={onKeydown}
      on:input={resize}
      on:paste={handlePaste}
      placeholder={loading ? "Respondendo… digite para enfileirar" : "Send a command…"}
      rows="1"
    ></textarea>

    <div class="ib-row" bind:this={rowEl}>
      <!-- AÇÕES (verbo: fazem algo agora).
           Nativas e de pacote saem do MESMO registry — ver
           lib/inputbar_bootstrap.js. As primeiras ficam em destaque; o resto
           cai na caixa ao lado, junto do editor. -->
      {#each $pinnedActions.filter((entry) => entry.native !== "voice" || androidDevice) as entry (entry.id)}
        <button
          class="iconbtn press tt"
          class:recording={entry.native === "voice" && recording}
          class:location-shared={entry.native === "location" && !!oneTimeLocation}
          class:active={openEntry?.id === entry.id || (entry.command === "toggle-listen-session" && listenSessionEnabled)}
          data-tt={rotuloAcao(entry)}
          aria-label={entry.label}
          aria-haspopup={entry.url ? "dialog" : undefined}
          aria-expanded={entry.url ? openEntry?.id === entry.id : undefined}
          disabled={entry.native === "voice" && transcribing}
          on:click|stopPropagation={() => acionar(entry)}
        >
          <InputBarIcon {entry} />
          {#if entry.native === "location" && oneTimeLocation}
            <span class="location-ready-dot" aria-hidden="true"></span>
          {/if}
        </button>
      {/each}

      {#if recording}
        <span class="rec" transition:fade={{ duration: 120 }}>
          <span class="pip"></span>{recordClock}
        </span>
      {/if}

      {#if workspacePickerOpen}
        <div class="workspace-layer" use:portalToBody on:keydown={onWorkspacePickerKeydown}>
          <div class="workspace-backdrop" role="presentation" on:click={closeWorkspacePicker}></div>
          <section class="workspace-modal" bind:this={workspaceModal} tabindex="-1" role="dialog" aria-modal="true" aria-label="Choose workspace">
            <header>
              <div><h2>Choose folder</h2><p>Only authorized directories in this environment are shown.</p></div>
              <button class="iconbtn small press" aria-label="Close" on:click={closeWorkspacePicker}>
                <svg viewBox="0 0 16 16" fill="none" width="12" height="12"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
              </button>
            </header>
            {#if workspaceError}
              <div class="workspace-recovery"><p class="box-error">{workspaceError}</p><button class="textbtn press" on:click={() => browseWorkspace()}>Try again</button></div>
            {/if}
            {#if workspaceLoading}<p class="box-note">Loading…</p>
            {:else if workspaceBrowser?.roots}
              {#if workspaceBrowser.roots.length}
                <div class="workspace-list">{#each workspaceBrowser.roots as root}<button class="mode-row press" on:click={() => browseWorkspace(root.path)}>{root.label}<small>{root.path}</small></button>{/each}</div>
              {:else}
                <div class="workspace-recovery"><p class="workspace-empty">No authorized folders are available in this environment.</p><button class="textbtn press" on:click={() => browseWorkspace()}>Try again</button></div>
              {/if}
            {:else if workspaceBrowser}
              <div class="workspace-crumbs">
                <button class="textbtn" disabled={!workspaceBrowser.parent} on:click={() => browseWorkspace(workspaceBrowser.parent)}>← Back</button>
                <code>{workspaceBrowser.path}</code>
              </div>
              <button class="workspace-select press" on:click={() => selectWorkspace(workspaceBrowser.path)}>Use this folder</button>
              {#if workspaceBrowser.entries.length}
                <div class="workspace-list">{#each workspaceBrowser.entries as entry}<button class="mode-row press" on:click={() => browseWorkspace(entry.path)}>{entry.name}</button>{/each}</div>
              {:else}
                <p class="workspace-empty">This folder has no subfolders. You can still use the current folder.</p>
              {/if}
            {/if}
            <footer class="workspace-footer"><button class="textbtn press" on:click={closeWorkspacePicker}>Cancel</button></footer>
          </section>
        </div>
      {/if}

      {#if openEntry?.native === "location"}
        <div class="location-layer" use:portalToBody bind:this={entryRoot}>
          <div class="location-backdrop" role="presentation" on:click={() => (openEntry = null)}></div>
          <section
            class="location-card"
            transition:scale={{ duration: 180, start: 0.96, easing: quintOut }}
            role="dialog"
            aria-modal="true"
            aria-label="Share location"
            tabindex="-1"
            bind:this={locationModal}
          >
            <div class="location-card-head">
              <span class="location-symbol" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" width="18" height="18"><path d="M19 10.5c0 5.25-7 10-7 10s-7-4.75-7-10a7 7 0 1114 0z" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="10.5" r="2.25" stroke="currentColor" stroke-width="1.8"/></svg>
              </span>
              <div class="location-heading"><h2>Share location</h2><p>One message only</p></div>
              <button class="iconbtn small press" aria-label="Not now" on:click={() => (openEntry = null)}>
                <svg viewBox="0 0 16 16" fill="none" width="11" height="11">
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                </svg>
              </button>
            </div>
            <p class="box-note">
              Your location is attached only to the next message. It is not saved on this device.
            </p>
            <label class="location-choice">
              <input type="checkbox" bind:checked={locationApproximate} />
              <span>Use approximate location</span>
            </label>
            {#if locationError}<p class="box-error">{locationError}</p>{/if}
            <div class="location-actions">
              <button class="textbtn" on:click={() => (openEntry = null)}>Not now</button>
              <button class="location-allow" disabled={locationPending} on:click={requestOneTimeLocation}>
                {locationPending ? "Getting location…" : "Allow once"}
              </button>
            </div>
          </section>
        </div>
      {/if}

      <input
        type="file"
        accept="image/*,text/*,.js,.ts,.jsx,.tsx,.py,.json,.md,.yaml,.yml,.xml,.html,.css,.sh,.env,.toml,.rs,.go,.java,.c,.cpp,.h,.unkwn"
        multiple
        hidden
        bind:this={fileInput}
        on:change={handleFileChange}
      />

      <!-- Caixa da ação de pacote aberta: fica fora da barra, que continua
           sendo só uma fileira de ícones. -->
      {#if openEntry?.url}
        <div class="ib-entries" bind:this={entryRoot}>
          <div
            class="ib-box"
            transition:scale={{ duration: 180, start: 0.96, easing: quintOut }}
            role="dialog"
            aria-label={openEntry.label}
          >
            <div class="ib-box-head">
              <span class="ib-box-title">{openEntry.label}</span>
              <button
                class="iconbtn small press"
                aria-label="Close"
                on:click={() => (openEntry = null)}
              >
                <svg viewBox="0 0 16 16" fill="none" width="11" height="11">
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                </svg>
              </button>
            </div>
            <PackageWidget
              url={openEntry.url}
              source={sessionId}
              title={openEntry.label}
              flat={true}
            />
          </div>
        </div>
      {/if}

      <!-- Excedentes + editor: uma caixa só. Quem não coube em destaque
           continua acionável aqui, e é aqui que se reordena/desativa. -->
      {#if $allInputBarEntries.length}
        <div class="ib-pins">
          <button
            class="iconbtn press tt"
            class:active={pinsOpen}
            data-tt="More tools"
            aria-label="More tools"
            aria-haspopup="menu"
            aria-expanded={pinsOpen}
            on:click|stopPropagation={() => (pinsOpen = !pinsOpen)}
          >
            <svg viewBox="0 0 16 16" fill="currentColor" width="15" height="15">
              <circle cx="3" cy="8" r="1.3" />
              <circle cx="8" cy="8" r="1.3" />
              <circle cx="13" cy="8" r="1.3" />
            </svg>
          </button>

          {#if pinsOpen}
            <div class="inputbar-drawer-layer" use:portalToBody bind:this={pinsRoot}>
              <div class="inputbar-drawer-backdrop" role="presentation" on:click={() => (pinsOpen = false)}></div>
              <section class="inputbar-drawer" role="dialog" aria-modal="true" aria-label="Organize tools">
              <!-- Abas separam o que está disponível do que foi desativado;
                   cada linha ainda permite usar, reordenar e ligar/desligar. -->
              <div class="ib-box-head bare">
                <button
                  class="iconbtn small press tt"
                  data-tt="Reset"
                  aria-label="Reset"
                  on:click={resetInputBarConfig}
                >
                  <svg viewBox="0 0 16 16" fill="none" width="13" height="13">
                    <path
                      d="M12.5 5.5A5 5 0 103.6 9"
                      stroke="currentColor"
                      stroke-width="1.5"
                      stroke-linecap="round"
                    />
                    <path
                      d="M12.8 2.6v3h-3"
                      stroke="currentColor"
                      stroke-width="1.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </button>
              </div>
              <div class="pin-tabs" role="tablist" aria-label="Tool visibility">
                <button class:active={pinsTab === "active"} role="tab" aria-selected={pinsTab === "active"} on:click={() => pinsTab = "active"}>Active ({activeActions.length})</button>
                <button class:active={pinsTab === "inactive"} role="tab" aria-selected={pinsTab === "inactive"} on:click={() => pinsTab = "inactive"}>Inactive ({inactiveActions.length})</button>
              </div>
              <div class="pin-list">
                {#each drawerActions as entry, i (entry.id)}
                  <div
                    class="pin-row edit"
                    class:dragging={dragKind === "action" && dragFrom === i}
                    class:dragover={dragKind === "action" && dragOver === i}
                    data-drag="action"
                  >
                    <span
                      class="grip"
                      role="button"
                      tabindex="-1"
                      aria-label="Drag to reorder"
                      on:pointerdown={(e) => pegarPonteiro(e, "action", i)}
                      on:pointermove={moverPonteiro}
                      on:pointerup={soltarPonteiro}
                      on:pointercancel={soltarPonteiro}
                    >
                      <svg viewBox="0 0 16 16" fill="currentColor" width="11" height="11">
                        <circle cx="6" cy="4" r="1.1" /><circle cx="10" cy="4" r="1.1" />
                        <circle cx="6" cy="8" r="1.1" /><circle cx="10" cy="8" r="1.1" />
                        <circle cx="6" cy="12" r="1.1" /><circle cx="10" cy="12" r="1.1" />
                      </svg>
                    </span>
                    <button
                      class="row-use"
                      on:click={() => { pinsOpen = false; acionar(entry); }}
                    >
                      <span class="pin-icon"><InputBarIcon {entry} size={15} /></span>
                      <span class="pin-label">
                        <span class="pin-name">{entry.label}</span>
                      </span>
                    </button>
                    <button
                      class="row-toggle"
                      class:is-on={entry.visible}
                      aria-pressed={entry.visible}
                      aria-label={entry.visible ? "Deactivate tool" : "Activate tool"}
                      on:click={() => setEntryVisible(entry.id, !entry.visible)}
                    >
                      <span class="row-toggle-knob"></span>
                    </button>
                  </div>
                {/each}
              </div>
              </section>
            </div>
          {/if}
        </div>
      {/if}

      <div class="ib-spacer"></div>

      <!-- ESTADO (adjetivo: muda COMO a próxima mensagem é processada).
           Uma caixa só, colada ao botão de enviar. Antes eram duas — a de
           modelo e aprovação — cada uma com seu popover; o valor de cada
           controle agora aparece no próprio chip, e a lista sai do registry,
           então um pacote consegue acrescentar um controle aqui. -->
      <!-- Todos os controles permanecem disponíveis, sem ativação separada. -->
      {#if allStates.length}
        <div class="ib-state">
          <button
            class="textbtn press state-trigger"
            title={selectionDescription}
            class:active={stateOpen}
            disabled={modelSaving || specialistSaving}
            aria-label={`Development settings: ${selectionSummary}`}
            on:click|stopPropagation={() => (stateOpen = !stateOpen)}
            aria-haspopup="menu"
            aria-expanded={stateOpen}
          >
            <svg viewBox="0 0 16 16" fill="none" width="12" height="12" aria-hidden="true"><path d="M4 10l4-4 4 4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
            {#if modelInlineLabel}<span class="selection-inline" title={modelFullLabel}>{modelInlineLabel}</span>{/if}
          </button>

          {#if optionsHydrated}
            <!-- Mantém os widgets montados para carregar o resumo mesmo com a gaveta fechada. -->
            <div class="inputbar-drawer-layer" hidden={!stateOpen} use:portalToBody bind:this={stateRoot}>
              <div class="inputbar-drawer-backdrop" role="presentation" on:click={() => (stateOpen = false)}></div>
              <section class="inputbar-drawer" role="dialog" aria-modal="true" aria-label="Development settings">
              <div class="ib-box-head"><span class="ib-box-title">Development</span></div>
              <div class="workspace-row">
                <span><strong>Workspace</strong><small>{workspace?.path ?? "Default workspace"}</small></span>
                <button class="textbtn" on:click={openWorkspacePicker}>Choose folder…</button>
              </div>
              {#key sessionId}
              {#each $stateEntries as entry, i (entry.id)}
                <!-- Sanfona: um controle aberto por vez. Arrastar reordena;
                     a lista inteira (inclusive os desligados) fica no rodapé. -->
                <div
                  class="state-sec"
                  class:first={i === 0}
                  class:dragging={dragKind === "state" && dragFrom === i}
                  class:dragover={dragKind === "state" && dragOver === i}
                  data-drag="state"
                  role="listitem"
                >
                  <div class="acc-head-wrap">
                    <!-- Alça fora do botão: arrastar não pode disparar o
                         toggle da sanfona, então ela é irmã do cabeçalho, não
                         filha. -->
                    <span
                      class="grip"
                      role="button"
                      tabindex="-1"
                      aria-label="Drag to reorder"
                      on:pointerdown={(e) => pegarPonteiro(e, "state", i)}
                      on:pointermove={moverPonteiro}
                      on:pointerup={soltarPonteiro}
                      on:pointercancel={soltarPonteiro}
                    >
                      <svg viewBox="0 0 16 16" fill="currentColor" width="11" height="11">
                        <circle cx="6" cy="4" r="1.1" /><circle cx="10" cy="4" r="1.1" />
                        <circle cx="6" cy="8" r="1.1" /><circle cx="10" cy="8" r="1.1" />
                        <circle cx="6" cy="12" r="1.1" /><circle cx="10" cy="12" r="1.1" />
                      </svg>
                    </span>
                  <button
                    class="acc-head"
                    aria-expanded={openSection === entry.id}
                    on:click={() => {
                      const next = openSection === entry.id ? null : entry.id;
                      openSection = next;
                      // Abrir a lista de modelos recarrega o catálogo: fontes
                      // dinâmicas (modelos baixados no ollama local) mudam por
                      // fora da sessão, e o fetch inicial só roda na troca de
                      // sessão. Sem isso, um `ollama pull` só apareceria depois
                      // de recarregar a página.
                      if (next && entry.native === "model" && sessionId) fetchModel(sessionId);
                    }}
                  >
                    <span class="ib-box-title">{entry.label}</span>
                    <span class="acc-value">
                      {#if entry.native === "model"}{modelLabel}
                      {:else if entry.native === "specialist"}{specialistLabel}
                      {:else}{widgetSelections[entry.id] || ""}{/if}
                    </span>
                    <svg
                      class="acc-chevron"
                      class:acc-open={openSection === entry.id}
                      viewBox="0 0 16 16"
                      fill="none"
                      width="11"
                      height="11"
                    >
                      <path d="M5 6l3 3 3-3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  </button>
                  </div>

                  <div class="acc-body" class:acc-hidden={openSection !== entry.id}>

                  {#if entry.native === "model"}
                    <ModelSelector selected={modelOverride} saving={modelSaving} options={visibleModelOptions(modelOptions)} onSelect={selectModel} />
                    <p class="box-note">Auto escolhe o modelo compatível; um modelo fixado ainda precisa atender aos requisitos deste turno.</p>
                  {:else if entry.native === "specialist"}
                    <SpecialistSelector selected={specialist} saving={specialistSaving} options={specialistOptions} onSelect={selectSpecialist} />
                    <p class="box-note">
                      {#if specialist !== "none"}
                        Pinned: every turn in this session goes through <strong>{specialistLabel}</strong> — its
                        prompt, tool allowlist and model (when set) win over the session's own Model pick.
                      {:else}
                        None: normal session, no specialist prompt or tool restriction.
                      {/if}
                    </p>
                  {:else if entry.url}
                    <PackageWidget
                      url={entry.url}
                      source={sessionId}
                      title={entry.label}
                      on:state={(event) => receiveWidgetState(entry.id, event)}
                      on:selection={() => closeSelectedSection(entry.id)}
                      flat={true}
                    />
                  {/if}
                  </div>
                </div>
              {/each}
              {/key}

              </section>
            </div>
          {/if}
        </div>
      {/if}

      {#if loading}
        <button class="iconbtn press tt" data-tt="Stop generation" aria-label="Stop generation" on:click={onStop}>
          <svg viewBox="0 0 18 18" fill="currentColor" width="12" height="12">
            <rect x="3" y="3" width="12" height="12" rx="2" />
          </svg>
        </button>
      {/if}

      <button
        class="send press tt"
        data-tt={loading ? "Enviar agora (entra na fila)" : "Send"}
        aria-label="Send"
        on:click={onSend}
        disabled={!canSend}
      >
        <svg viewBox="0 0 18 18" fill="none" width="13" height="13">
          <path
            d="M9 14V4M4.5 8.5L9 4l4.5 4.5"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </div>
  </div>

  {#if summaryOptions.length}
    <div class="selection-footer" title={selectionDescription} aria-label="Opções selecionadas">
      <span class="selection-value">{selectionSummary}</span>
    </div>
  {/if}

  <!-- Painel de geração (sem gatilho por ora — ver options popover) -->
  {#if optionsOpen}
    <div class="ib-options" bind:this={optionsRoot}>
      <div class="opt-row">
        <span class="opt-name">Mixture of Experts</span>
        <span class="opt-detail">Route to a specialist after classification</span>
        <button
          class="tgl"
          role="switch"
          aria-checked={moeEnabled}
          aria-label="Mixture of Experts"
          on:click={toggleMoe}
        ></button>
      </div>
      <div class="opt-levels">
        <span class="opt-name">Approximation level</span>
        <div class="seg">
          {#each approximationLevels as level}
            <button
              class="press"
              class:selected={approximation === level.id}
              on:click={() => selectApproximation(level.id)}>{level.label}</button
            >
          {/each}
        </div>
      </div>
    </div>
  {/if}

  <div class="ib-caption">
    {#if hasUploading}
      <span transition:fade>Waiting for upload…</span>
    {:else}
      <span transition:fade><kbd>Enter</kbd> to send · <kbd>Shift+Enter</kbd> for a new line</span>
      <div class="shortcut-help" bind:this={shortcutsRoot}>
        <button
          class="shortcut-trigger press"
          type="button"
          aria-label="Keyboard shortcuts"
          aria-expanded={shortcutsOpen}
          aria-controls="desktop-shortcuts"
          on:click={toggleShortcuts}
        >
          <svg viewBox="0 0 16 16" fill="none" width="12" height="12" aria-hidden="true">
            <path
              d="M5.8 6.1a2.25 2.25 0 1 1 3.05 2.1c-.72.31-.85.72-.85 1.3M8 12.25h.01"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            />
          </svg>
        </button>

        {#if shortcutsOpen}
          <section
            id="desktop-shortcuts"
            class="shortcut-popover"
            role="dialog"
            aria-labelledby="desktop-shortcuts-title"
            transition:fade={{ duration: 180 }}
          >
            <div class="shortcut-head">
              <h2 id="desktop-shortcuts-title">Keyboard shortcuts</h2>
              <span>Ctrl on Windows/Linux · ⌘ on macOS · legacy shortcuts may be reserved by the browser</span>
            </div>
            <div class="shortcut-groups">
              {#each desktopShortcutGroups as group (group.id)}
                <section class="shortcut-group">
                  <h3>{group.label}</h3>
                  <dl>
                    {#each group.shortcuts as shortcut (shortcut.label)}
                      <div class="shortcut-row">
                        <dt>{shortcut.label}</dt>
                        <dd>
                          {#each shortcut.keys as key, index}
                            {#if index > 0}<span class="key-plus">+</span>{/if}
                            <kbd>{key === "Mod" ? "Ctrl / ⌘" : key}</kbd>
                          {/each}
                        </dd>
                      </div>
                    {/each}
                  </dl>
                </section>
              {/each}
            </div>
          </section>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .inputbar-drawer-layer[hidden] { display: none; }
  .ib-state { min-width: 0; max-width: 48%; }
  .state-trigger { min-width: 0; max-width: 100%; }
  .state-trigger svg { flex-shrink: 0; }
  .selection-inline { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
  .selection-footer { display: flex; justify-content: center; align-items: center; padding: 7px 12px 0; text-align: center; color: var(--ink-3, var(--tk-muted)); font-size: 10px; line-height: 1.5; }
  .selection-value { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink-2, var(--tk-muted)); }

  /* ═══ Slate + Onyx ═══
     O esqueleto vem do Onyx (fileira de ícones, hairlines, caixinha flutuante,
     física de press) e a matéria vem do DESIGN.md/Slate, que manda no resto do
     shell: paleta achromática pela escada --wXX, elevação por sombra dupla com
     lift, e nada de vidro, gradiente ou emoji. Os tokens são os do Home.svelte
     (.shell), então o tema claro sai de graça — sem rgba solto, que só renderiza
     certo no tema em que foi olhado (DESIGN.md §14). */
  .ib-wrap {
    --ink-1: var(--txt, #f5f5f5);
    --ink-2: var(--txt-2, #888888);
    --ink-3: var(--txt-3, rgba(136, 136, 136, 0.45));

    --hair-1: var(--border, var(--w07, rgba(255, 255, 255, 0.07)));
    --hair-2: var(--border-hi, var(--w14, rgba(255, 255, 255, 0.14)));
    --press-wash: var(--w10, rgba(255, 255, 255, 0.1));
    --hover-wash: var(--w06, rgba(255, 255, 255, 0.06));

    --sheet: var(--surface, #111111);
    --raised: var(--surface-2, #181818);

    --r-sm: 7px;
    --r-md: 11px;
    --r-lg: 16px;
    --spring: cubic-bezier(0.32, 1.4, 0.35, 1);
    --ease: cubic-bezier(0.4, 0, 0.2, 1);
    --t1: 110ms;
    --t2: 220ms;

    width: 100%;
    max-width: 768px;
    margin-left: auto !important;
    margin-right: auto !important;
    padding: 8px 16px 16px;
    box-sizing: border-box;
  }

  /* A barra é um objeto flutuante do Slate: superfície chapada + sombra dupla,
     com lift no hover/foco. Sem blur — glassmorphism é banido pelo DESIGN.md. */
  .ib-shell {
    position: relative;
    background: var(--raised);
    border: 1px solid var(--hair-1);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-soft);
    transition:
      transform var(--t2) var(--ease),
      border-color var(--t2) var(--ease),
      box-shadow var(--t2) var(--ease);
  }
  .ib-shell:hover {
    box-shadow: var(--shadow-soft-hover);
  }
  .ib-shell:focus-within {
    border-color: var(--hair-2);
    box-shadow: var(--shadow-soft-hover);
    transform: translateY(-2px);
  }
  .ib-shell.dragging {
    border-color: var(--hair-2);
  }

  .ib-drop {
    position: absolute;
    inset: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--r-lg);
    border: 1px dashed var(--hair-2);
    background: var(--raised);
    font-size: 13px;
    color: var(--ink-2);
  }

  .ib-shell textarea {
    width: 100%;
    resize: none;
    border: none;
    outline: none;
    background: transparent;
    color: var(--ink-1);
    font-family: inherit;
    font-size: 14px;
    line-height: 1.55;
    padding: 13px 16px 4px;
    min-height: 46px;
    max-height: 220px;
    display: block;
    box-sizing: border-box;
  }
  .ib-shell textarea::placeholder {
    color: var(--ink-3);
  }

  .ib-row {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px 8px 8px;
  }
  @media (max-width: 460px) {
    .ib-row { gap: 0; padding-left: 5px; padding-right: 5px; }
  }
  .ib-spacer {
    flex: 1;
  }

  /* ── física de toque: comprime, nunca levita ── */
  .press {
    transition:
      transform var(--t1) var(--spring),
      background var(--t1) var(--ease),
      color var(--t1) var(--ease),
      border-color var(--t1) var(--ease);
  }
  .press:active:not(:disabled) {
    transform: scale(0.965);
  }

  .iconbtn {
    position: relative;
    width: 34px;
    height: 34px;
    display: grid;
    place-items: center;
    border-radius: var(--r-sm);
    border: none;
    background: transparent;
    color: var(--ink-2);
    cursor: pointer;
    flex-shrink: 0;
  }
  .iconbtn:hover:not(:disabled) {
    background: var(--hover-wash);
    color: var(--ink-1);
  }
  .iconbtn.active {
    background: var(--press-wash);
    color: var(--ink-1);
  }
  .iconbtn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .iconbtn.small {
    width: 24px;
    height: 24px;
  }
  .iconbtn.recording {
    color: var(--ink-1);
  }
  .iconbtn.location-shared {
    color: var(--ink-1);
  }
  .location-ready-dot {
    position: absolute;
    right: 5px;
    bottom: 5px;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: currentColor;
    opacity: 0.72;
    pointer-events: none;
  }
  .workspace-row { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:9px 12px; border-bottom:1px solid var(--hair-1); }
  .workspace-row span { min-width:0; display:grid; gap:2px; font-size:12px; color:var(--ink-1); }
  .workspace-row small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--ink-3); font-family:var(--font-mono, monospace); font-size:10px; max-width:190px; }
  .workspace-layer { position:fixed; inset:0; z-index:2147483000; display:grid; place-items:center; padding:16px; box-sizing:border-box; }
  .workspace-backdrop { position:absolute; inset:0; background:var(--backdrop,rgba(17,17,17,.58)); }
  .workspace-modal { position:relative; z-index:1; width:min(calc(100vw - 32px),560px); max-height:min(80dvh,680px); overflow:auto; box-sizing:border-box; padding:18px; border:1px solid var(--tk-border,var(--hair-1)); border-radius:var(--r-lg); background:var(--tk-surface,var(--sheet)); color:var(--tk-text,var(--ink-1)); box-shadow:0 2px 8px rgba(0,0,0,.08); animation:workspace-appear 220ms ease-out; }
  .workspace-modal:focus { outline:none; }
  @keyframes workspace-appear { from { transform:translateY(8px); opacity:.6; } to { transform:translateY(0); opacity:1; } }
  .workspace-modal header { display:flex; justify-content:space-between; gap:12px; align-items:start; margin-bottom:12px; }
  .workspace-modal h2 { margin:0; color:var(--ink-1); font-size:15px; }
  .workspace-modal header p { margin:3px 0 0; color:var(--ink-3); font-size:11px; }
  .workspace-list { display:grid; gap:3px; }
  .workspace-list .mode-row { text-align:left; display:grid; gap:3px; }
  .workspace-list small { color:var(--ink-3); font-family:var(--font-mono, monospace); font-size:10px; }
  .workspace-empty { margin:18px 0; color:var(--ink-3); text-align:center; font-size:12px; }
  .workspace-recovery { display:grid; justify-items:center; gap:4px; padding:8px 0; }
  .workspace-footer { display:flex; justify-content:flex-end; margin-top:14px; padding-top:10px; border-top:1px solid var(--tk-border,var(--hair-1)); }
  .workspace-crumbs { display:flex; align-items:center; gap:7px; margin-bottom:9px; }
  .workspace-crumbs code { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--ink-2); font-size:10px; }
  .workspace-select { width:100%; border:0; border-radius:var(--r-sm); padding:9px; margin-bottom:9px; background:var(--ink-1); color:var(--sheet); font:600 12px var(--tk-font, inherit); cursor:pointer; }

  .inputbar-drawer-layer { position:fixed; inset:0; z-index:2147482999; }
  .inputbar-drawer-backdrop { position:absolute; inset:0; background:var(--backdrop,rgba(17,17,17,.58)); }
  .inputbar-drawer { position:absolute; z-index:1; left:0; right:0; bottom:0; width:100vw; max-height:min(88dvh,720px); overflow:auto; box-sizing:border-box; padding:20px 16px max(16px,env(safe-area-inset-bottom)); border:1px solid var(--tk-border,var(--hair-1)); border-bottom:0; border-radius:var(--r-lg) var(--r-lg) 0 0; background:var(--tk-surface,var(--sheet)); color:var(--tk-text,var(--ink-1)); box-shadow:0 2px 8px rgba(0,0,0,.08); animation:inputbar-drawer-rise 220ms ease-out; }
  .inputbar-drawer::before { content:""; display:block; width:38px; height:4px; margin:-10px auto 10px; border-radius:999px; background:var(--tk-border-hi,var(--hair-2)); }
  @keyframes inputbar-drawer-rise { from { transform:translateY(6%); opacity:.6; } to { transform:translateY(0); opacity:1; } }

  .textbtn {
    border: none;
    background: transparent;
    color: var(--ink-2);
    font-family: inherit;
    font-size: 12px;
    font-weight: 500;
    padding: 6px 11px;
    border-radius: var(--r-sm);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .textbtn:hover,
  .textbtn.active {
    background: var(--hover-wash);
    color: var(--ink-1);
  }
  .textbtn.pinned {
    color: var(--ink-1);
    background: var(--hover-wash);
  }
  .mode-line {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
  }
  .mode-tag {
    font-family: var(--font-mono, monospace);
    font-size: 9.5px;
    color: var(--ink-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 55%;
  }
  .mode-list.scroll {
    max-height: 240px;
    overflow-y: auto;
  }
  .box-note strong {
    font-weight: 600;
    color: var(--ink-1);
  }
  .location-layer { position:fixed; inset:0; z-index:2147483000; display:grid; place-items:center; padding:16px 16px 48px; box-sizing:border-box; }
  .location-backdrop { position:absolute; inset:0; background:var(--backdrop,rgba(17,17,17,.58)); }
  .location-card { position:relative; z-index:1; width:min(calc(100vw - 32px),360px); box-sizing:border-box; padding:16px; border:1px solid var(--tk-border,var(--hair-1)); border-radius:var(--r-lg); background:var(--tk-surface,var(--sheet)); color:var(--tk-text,var(--ink-1)); box-shadow:var(--shadow-soft-hover); transform-origin:center; }
  .location-card:focus { outline:none; }
  .location-card-head { display:flex; align-items:center; gap:10px; }
  .location-symbol { display:grid; place-items:center; width:36px; height:36px; flex:0 0 auto; border-radius:50%; background:var(--press-wash); color:var(--ink-1); }
  .location-heading { min-width:0; flex:1; }
  .location-heading h2 { margin:0; color:var(--ink-1); font-size:14px; font-weight:600; }
  .location-heading p { margin:2px 0 0; color:var(--ink-3); font-size:11px; }
  .location-choice {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 10px 4px;
    color: var(--ink-1);
    font-size: 12px;
  }
  .location-choice input {
    accent-color: var(--tk-accent);
  }
  .location-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    margin-top: 10px;
  }
  .location-allow {
    border: 0;
    border-radius: var(--tk-radius-md);
    padding: 7px 10px;
    background: var(--tk-accent);
    color: var(--tk-on-accent);
    font: 500 12px var(--tk-font);
    cursor: pointer;
  }
  .location-allow:disabled {
    cursor: wait;
    opacity: 0.55;
  }
  .warn-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--ink-3);
  }

  .send {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--ink-1);
    color: var(--sheet);
    border: none;
    display: grid;
    place-items: center;
    cursor: pointer;
    flex-shrink: 0;
    margin-left: 2px;
  }
  .send:disabled {
    opacity: 0.2;
    cursor: not-allowed;
  }

  /* Glifo do pacote, ou monograma gerado quando ele não declara ícone. */

  .rec {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--tk-font, "Ubuntu", system-ui, sans-serif);
    font-size: 11px;
    color: var(--ink-2);
    margin: 0 6px 0 2px;
  }
  .rec .pip,
  .ib-expert .pip {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--ink-2);
    animation: breathe 1.4s var(--ease) infinite;
  }
  @keyframes breathe {
    0%,
    100% {
      opacity: 0.35;
      transform: scale(0.8);
    }
    50% {
      opacity: 1;
      transform: scale(1);
    }
  }

  /* ── caixinha flutuante: a única camada com sombra ── */
  .ib-entries,
  .ib-pins,
  .ib-state {
    position: relative;
    display: flex;
    align-items: center;
    gap: 2px;
  }

  /* Cada controle de estado é uma seção da MESMA caixa; a régua separa sem
     precisar de uma caixa por controle, que era o problema do desenho antigo. */
  .state-sec + .state-sec {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--overlay-2, rgba(255, 255, 255, 0.08));
  }

  /* Arrasto: a linha levantada some um pouco e o alvo ganha uma régua no
     topo — sinal de ONDE vai cair, não só de que algo está sendo movido. */
  .pin-row.dragging,
  .state-sec.dragging { opacity: 0.4; }
  .pin-row.dragover,
  .state-sec.dragover { box-shadow: inset 0 2px 0 var(--accent, #6d28d9); }

  /* Switch idêntico ao do editor do menu mobile — mesma affordance, mesmo
     tamanho de alvo de toque. */
  .row-toggle {
    position: relative;
    flex-shrink: 0;
    width: 32px;
    height: 18px;
    border-radius: 999px;
    border: 1px solid var(--rail-border, rgba(255, 255, 255, 0.18));
    background: transparent;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: background 0.15s, border-color 0.15s;
    margin-left: auto;
  }
  .row-toggle.is-on {
    background: var(--rail-txt, #e8e8ea);
    border-color: var(--rail-txt, #e8e8ea);
  }
  .row-toggle-knob {
    position: absolute;
    top: 1px;
    left: 1px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--rail-bg, #1b1b1f);
    transition: transform 0.15s;
  }
  .row-toggle.is-on .row-toggle-knob { transform: translateX(14px); }

  /* touch-action: none faz o dedo arrastar a linha em vez de rolar a caixa —
     é o que permite o arrasto começar no primeiro movimento, sem segurar. */
  .grip {
    display: inline-flex;
    align-items: center;
    color: var(--txt-2);
    opacity: 0.6;
    flex: 0 0 auto;
    cursor: grab;
    touch-action: none;
    padding: 4px 2px;
    margin: -4px 0;
  }
  .grip:active { cursor: grabbing; }

  /* Corpo da linha: usa a ferramenta. Fica entre a alça e o switch. */
  .row-use {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    text-align: left;
    padding: 2px 0;
  }
  .pin-tabs { display:flex; gap:4px; margin:0 0 8px; border-bottom:1px solid var(--hair-1); }
  .pin-tabs button { border:0; border-bottom:2px solid transparent; padding:5px 8px 7px; background:transparent; color:var(--ink-3); font:500 11px var(--tk-font, inherit); cursor:pointer; }
  .pin-tabs button.active { border-color:var(--ink-1); color:var(--ink-1); }
  .acc-head-wrap {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  /* ── sanfona da caixa de estado ── */
  .acc-head {
    display: flex;
    align-items: center;
    gap: 7px;
    flex: 1;
    min-width: 0;
    padding: 6px 2px;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    text-align: left;
  }
  .acc-value {
    margin-left: auto;
    font-size: 11px;
    color: var(--txt-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 45%;
  }
  .acc-chevron {
    flex: 0 0 auto;
    color: var(--txt-2);
    transition: transform 160ms ease;
  }
  .acc-chevron.acc-open { transform: rotate(180deg); }
  .acc-body { overflow: hidden; }
  .acc-hidden { display: none; }

  .pin-row.edit {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
  }



  .ib-box {
    position: absolute;
    bottom: calc(100% + 10px);
    left: 0;
    z-index: 60;
    width: 340px;
    max-width: 78vw;
    background: var(--raised);
    border: 1px solid var(--hair-1);
    box-shadow: var(--shadow-soft-hover);
    border-radius: 13px;
    padding: 8px;
    transform-origin: bottom left;
  }
  .ib-box.right {
    left: auto;
    right: 0;
    transform-origin: bottom right;
  }
  .ib-box.narrow {
    width: 280px;
  }
  .ib-box-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 2px 4px 8px;
  }
  /* Cabeçalho sem título: só o ícone de reset, encostado à direita. */
  .ib-box-head.bare {
    justify-content: flex-end;
    padding: 0 2px 6px;
  }
  .ib-box-title {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--ink-1);
  }
  .box-note {
    margin: 8px 4px 2px;
    font-size: 11px;
    line-height: 1.45;
    color: var(--ink-2);
  }
  .box-error {
    margin: 8px 4px 2px;
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    color: var(--ink-2);
  }

  /* ── gerenciador de ícones fixados ── */
  .pin-list,
  .mode-list {
    display: flex;
    flex-direction: column;
    border-radius: var(--r-md);
    overflow: hidden;
  }
  /* A lista de OPÇÕES (modelo/aprovação) mantém a moldura — ali ela lê como
     escolha única. A de FERRAMENTAS não: a borda + as linhas faziam a lista
     inteira parecer um input, então ela fica sem moldura, só com os fios entre
     as linhas. */
  .mode-list {
    border: 1px solid var(--hair-1);
  }
  .pin-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 11px;
    border: none;
    background: transparent;
    color: var(--ink-1);
    font-family: inherit;
    text-align: left;
    cursor: pointer;
    width: 100%;
  }
  .pin-row + .pin-row,
  .mode-row + .mode-row {
    border-top: 1px solid var(--hair-1);
  }
  .pin-row:hover {
    background: var(--hover-wash);
  }
  .pin-icon {
    display: grid;
    place-items: center;
    width: 22px;
    color: var(--ink-2);
    flex-shrink: 0;
  }
  .pin-label {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .pin-name {
    font-size: 12.5px;
  }
  .pin-hint {
    font-size: 10.5px;
    color: var(--ink-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── modos de aprovação ── */
  .mode-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 12px;
    border: none;
    background: transparent;
    color: var(--ink-1);
    font-family: inherit;
    text-align: left;
    cursor: pointer;
    width: 100%;
  }
  .mode-row:hover {
    background: var(--hover-wash);
  }
  .mode-row.selected {
    background: var(--press-wash);
  }
  .mode-name {
    font-size: 12.5px;
    font-weight: 600;
  }
  .mode-hint {
    font-size: 10.5px;
    line-height: 1.4;
    color: var(--ink-3);
  }

  .semi {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 10px;
  }
  .semi-label {
    font-family: var(--font-mono, monospace);
    font-size: 9.5px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-3);
    padding-left: 2px;
  }
  .semi textarea {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    background: var(--sheet);
    border: 1px solid var(--hair-1);
    border-radius: 9px;
    padding: 8px 10px;
    font-family: inherit;
    font-size: 12px;
    line-height: 1.45;
    color: var(--ink-1);
    outline: none;
    min-height: 0;
    max-height: none;
  }
  .semi textarea:focus {
    border-color: var(--hair-2);
  }
  .semi textarea::placeholder {
    color: var(--ink-3);
  }
  .semi-note {
    font-size: 10.5px;
    color: var(--ink-3);
    padding-left: 2px;
  }

  /* ── anexos ── */
  .ib-attachments {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 12px 14px 2px;
  }
  .att {
    position: relative;
    width: 54px;
    height: 54px;
    border-radius: var(--r-md);
    border: 1px solid var(--hair-1);
    background: var(--raised);
  }
  .att.uploading {
    border-color: var(--hair-2);
  }
  .att.error {
    border-style: dashed;
  }
  .att img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: calc(var(--r-md) - 1px);
    opacity: 0.9;
  }
  .att-file,
  .att-center {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    color: var(--ink-2);
  }
  .att-file span {
    font-family: var(--font-mono, monospace);
    font-size: 8px;
    color: var(--ink-3);
    max-width: 44px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .att-x {
    position: absolute;
    top: -6px;
    right: -6px;
    width: 17px;
    height: 17px;
    border-radius: 50%;
    border: 1px solid var(--hair-1);
    background: var(--raised);
    color: var(--ink-2);
    font-size: 12px;
    line-height: 1;
    display: grid;
    place-items: center;
    cursor: pointer;
  }
  .att-x:hover {
    color: var(--ink-1);
  }

  .ib-error {
    padding: 6px 16px 0;
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    color: var(--ink-2);
  }
  .ib-expert {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 11px 16px 0;
    font-size: 11px;
    color: var(--ink-3);
  }
  .ib-expert strong {
    font-weight: 500;
    color: var(--ink-2);
  }

  /* ── painel de geração ── */
  .ib-options {
    margin-top: 8px;
    background: var(--sheet);
    border: 1px solid var(--hair-1);
    border-radius: var(--r-lg);
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .opt-row {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 4px 12px;
  }
  .opt-name {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--ink-1);
  }
  .opt-detail {
    grid-column: 1;
    font-size: 11px;
    color: var(--ink-3);
  }
  .opt-row .tgl {
    grid-row: span 2;
  }
  .tgl {
    position: relative;
    width: 42px;
    height: 25px;
    border-radius: 999px;
    border: none;
    background: var(--press-wash);
    box-shadow: inset 0 0 0 1px var(--hair-1);
    cursor: pointer;
    transition: background var(--t2) var(--ease);
  }
  .tgl::after {
    content: "";
    position: absolute;
    top: 2.5px;
    left: 2.5px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--ink-2);
    transition:
      transform var(--t2) var(--spring),
      background var(--t2);
  }
  .tgl[aria-checked="true"] {
    background: var(--ink-1);
    box-shadow: none;
  }
  .tgl[aria-checked="true"]::after {
    transform: translateX(17px);
    background: var(--sheet);
  }
  .opt-levels {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .seg {
    display: flex;
    background: var(--press-wash);
    border-radius: 9px;
    padding: 2px;
  }
  .seg button {
    flex: 1;
    border: none;
    background: transparent;
    padding: 5px 12px;
    font-family: inherit;
    font-size: 11.5px;
    font-weight: 500;
    color: var(--ink-2);
    border-radius: 7px;
    cursor: pointer;
  }
  .seg button.selected {
    background: var(--raised);
    border: 1px solid var(--hair-1);
    color: var(--ink-1);
  }

  /* ── tooltip ── */
  .tt {
    position: relative;
  }
  .tt::before {
    content: attr(data-tt);
    position: absolute;
    bottom: calc(100% + 9px);
    left: 50%;
    transform: translateX(-50%) translateY(2px) scale(0.97);
    background: var(--raised);
    border: 1px solid var(--hair-1);
    box-shadow: var(--shadow-soft-hover);
    color: var(--ink-1);
    font-size: 11px;
    padding: 5px 10px;
    border-radius: 8px;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition:
      opacity var(--t2) var(--ease),
      transform var(--t2) var(--spring);
    z-index: 70;
  }
  .tt:hover::before,
  .tt:focus-visible::before {
    opacity: 1;
    transform: translateX(-50%) translateY(0) scale(1);
  }

  .ib-caption {
    margin-top: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    font-size: 11px;
    color: var(--ink-3);
  }
  .ib-caption kbd {
    font-family: var(--font-mono, monospace);
    font-size: 9.5px;
    background: var(--press-wash);
    border: 1px solid var(--hair-1);
    border-radius: 5px;
    padding: 2px 6px;
    margin: 0 1px;
    color: var(--ink-2);
  }

  .shortcut-help {
    position: relative;
    display: inline-flex;
  }
  .shortcut-trigger {
    width: 20px;
    height: 20px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 1px solid var(--hair-1);
    border-radius: 50%;
    background: transparent;
    color: var(--ink-2);
    cursor: pointer;
  }
  .shortcut-trigger:hover,
  .shortcut-trigger:focus-visible,
  .shortcut-trigger[aria-expanded="true"] {
    border-color: var(--hair-2);
    background: var(--hover-wash);
    color: var(--ink-1);
  }
  .shortcut-trigger:focus-visible {
    outline: 2px solid var(--hair-2);
    outline-offset: 2px;
  }
  .shortcut-popover {
    position: absolute;
    right: -8px;
    bottom: calc(100% + 10px);
    z-index: 80;
    width: min(420px, calc(100vw - 32px));
    padding: 14px;
    box-sizing: border-box;
    text-align: left;
    color: var(--ink-1);
    background: var(--raised);
    border: 1px solid var(--hair-1);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-soft-hover);
  }
  .shortcut-head {
    padding: 0 2px 12px;
    border-bottom: 1px solid var(--hair-1);
  }
  .shortcut-head h2,
  .shortcut-group h3 {
    margin: 0;
    font: inherit;
    color: var(--ink-1);
  }
  .shortcut-head h2 {
    font-size: 13px;
    font-weight: 500;
  }
  .shortcut-head span {
    display: block;
    margin-top: 3px;
    color: var(--ink-3);
    font-size: 10px;
  }
  .shortcut-groups {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px 20px;
    padding-top: 13px;
  }
  .shortcut-group h3 {
    margin-bottom: 6px;
    color: var(--ink-2);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .shortcut-group dl {
    margin: 0;
  }
  .shortcut-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: 25px;
  }
  .shortcut-row dt {
    color: var(--ink-2);
    line-height: 1.25;
  }
  .shortcut-row dd {
    display: flex;
    align-items: center;
    flex: none;
    margin: 0;
    white-space: nowrap;
  }
  .shortcut-row kbd {
    padding: 2px 5px;
    font-size: 9px;
  }
  .key-plus {
    margin: 0 2px;
    color: var(--ink-3);
    font-size: 8px;
  }

  @media (prefers-reduced-motion: reduce) {
    .press,
    .tgl,
    .tgl::after,
    .tt::before {
      transition-duration: 0.01ms;
    }
    .shortcut-popover {
      transition-duration: 0.01ms;
    }
    .rec .pip,
    .ib-expert .pip {
      animation: none;
    }
  }

  @media (max-width: 640px) {
    .ib-wrap {
      padding: 6px 10px 12px;
    }
    .ib-box {
      width: 300px;
    }
  }

  @media (max-width: 820px) {
    .ib-caption {
      display: none;
    }
  }
</style>
