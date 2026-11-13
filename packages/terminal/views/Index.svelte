<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import { commandWithMarker, outputFromMarker } from './lib/desktop-control.js';

  // xterm.js toca `self`/`window` durante o carregamento; por isso é carregado
  // apenas no navegador, nunca pelo bundle SSR. Os arquivos são empacotados no
  // Runtime: depender do CDN aqui criava uma corrida no WebView (um script podia
  // trocar o global enquanto o outro já estava montando o addon), deixando o PTY
  // conectado sem renderer visível.
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Could not load ${src}`));
      document.head.appendChild(script);
    });
  }

  async function loadLocalXterm() {
    if (!window.Terminal) await loadScript('/vendor/xterm/xterm.js');
    if (!window.FitAddon) await loadScript('/vendor/xterm/addon-fit.js');
  }

  async function loadXterm() {
    await loadLocalXterm();
    if (!window.Terminal || !window.FitAddon) throw new Error('Terminal assets did not load');
  }

  const CHANNEL = 'terminal:pty';

  // randomUUID is missing in older Android System WebViews even when
  // getRandomValues exists. Tab/session IDs are identifiers, not credentials,
  // so retain a final non-cryptographic fallback instead of crashing the view.
  function browserUuid() {
    const webCrypto = globalThis.crypto;
    if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (typeof webCrypto?.getRandomValues === 'function') webCrypto.getRandomValues(bytes);
    else for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // O ptyId precisa ser único entre todas as abas de todos os clientes conectados
  // (o servidor guarda um mapa plano de sessões indexado por ptyId), por isso é um
  // UUID — não o contador que aparece no nome da aba.
  function newTabId() {
    return browserUuid();
  }

  // O número no nome da aba é o menor livre entre as abas abertas — não um contador
  // que só cresce. Com o contador, um dia de abrir e fechar abas chegava em
  // "Terminal 500" com três abas na tela; agora fechar a 2 de 3 faz a próxima aba
  // nascer como 2 outra vez. Só numera as abas que ainda têm o nome automático:
  // uma aba renomeada à mão não entra na conta nem tem seu nome mexido.
  function nextTabNumber(prefix) {
    const pattern = new RegExp(`^${prefix} (\\d+)$`);
    const used = new Set();
    for (const tab of tabs) {
      const match = pattern.exec(tab.name || '');
      if (match) used.add(Number(match[1]));
    }
    let n = 1;
    while (used.has(n)) n++;
    return n;
  }

  let tabs = [{ id: newTabId(), name: 'Terminal 1', profileId: 'default' }];
  let activeTabId = tabs[0].id;

  // ── Persistência das abas ────────────────────────────────────────────────
  // A lista de abas (id/nome/perfil) vive no localStorage para sobreviver a um
  // restart do app. Como o `ptyId` (== id da aba) é preservado e o owner do WS
  // também é estável (ver wsUrl), o servidor reatacha o PTY ainda vivo (janela de
  // graça) ao voltar — em vez de abrir um shell novo e perder a sessão.
  const TABS_STORAGE_KEY = 'terminalTabs';
  let hydrated = false;

  function persistTabs() {
    if (typeof window === 'undefined' || !hydrated) return;
    try {
      localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify({
        tabs: tabs.map(t => ({ id: t.id, name: t.name, profileId: t.profileId })),
        activeTabId,
      }));
    } catch {}
  }

  function loadPersistedTabs() {
    if (typeof window === 'undefined') return null;
    try {
      const raw = JSON.parse(localStorage.getItem(TABS_STORAGE_KEY) || 'null');
      if (!raw || !Array.isArray(raw.tabs)) return null;
      const restored = raw.tabs
        .filter(t => t && typeof t.id === 'string')
        .map(t => ({
          id: t.id,
          name: typeof t.name === 'string' && t.name ? t.name : 'Terminal',
          profileId: typeof t.profileId === 'string' && t.profileId ? t.profileId : 'default',
        }));
      if (!restored.length) return null;
      const activeId = restored.some(t => t.id === raw.activeTabId) ? raw.activeTabId : restored[0].id;
      return { tabs: restored, activeTabId: activeId };
    } catch { return null; }
  }

  // ── Perfis: um por identidade (ex.: `claude login`, `gh auth login`…) ────
  // Um perfil é só um nome — o servidor dá a ele um $HOME isolado, então qualquer CLI
  // que guarde login sob $HOME ganha uma identidade separada e persistente por perfil.
  // A lista de nomes é autoritativa do servidor (igual em todo dispositivo); as cores
  // são enfeite por navegador e ficam no localStorage.
  let profileNames = ['default'];
  let profileColors = {};
  let profileMenuFor = null; // tabId com o seletor aberto, ou null
  let newProfileName = '';

  // ── CRUD de perfis ───────────────────────────────────────────────────────
  // Criar/renomear/apagar é operação de servidor (o perfil é um diretório lá), então
  // a lista vinda do backend é sempre a verdade — nada é inventado no cliente.
  let profilesInUse = [];   // perfis com sessão viva: não dá para renomear/apagar
  let profileBusy = false;
  let profileError = '';
  let profileEditing = null;   // perfil em renomeação
  let profileEditValue = '';
  let profileDeleting = null;  // perfil aguardando confirmação de exclusão

  function loadProfileColors() {
    if (typeof window === 'undefined') { profileColors = {}; return; }
    try { profileColors = JSON.parse(localStorage.getItem('terminalProfileColors') || '{}'); } catch { profileColors = {}; }
  }

  function saveProfileColors() {
    if (typeof window === 'undefined') return;
    try { localStorage.setItem('terminalProfileColors', JSON.stringify(profileColors)); } catch {}
  }

  function colorForProfile(name) {
    if (profileColors[name]) return profileColors[name];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    const color = `hsl(${hash % 360}, 60%, 55%)`;
    profileColors = { ...profileColors, [name]: color };
    saveProfileColors();
    return color;
  }

  async function loadProfiles() {
    loadProfileColors();
    try {
      const res = await fetch('/terminal/profiles');
      if (!res.ok) return;
      const data = await res.json();
      // A lista do servidor manda: um perfil apagado tem de sumir daqui mesmo que
      // ainda exista uma cor guardada para ele no localStorage deste navegador.
      if (Array.isArray(data.profiles) && data.profiles.length) profileNames = data.profiles;
      profilesInUse = Array.isArray(data.inUse) ? data.inUse : [];
    } catch {}
  }

  // Toda escrita de perfil devolve a lista nova; um `ok:false` traz o motivo (nome
  // repetido, perfil com sessão aberta, default protegido) para exibir no menu.
  async function profileWrite(url, options) {
    profileError = '';
    profileBusy = true;
    try {
      const res = await fetch(url, options);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        profileError = data.error || 'The operation could not be completed.';
        return null;
      }
      if (Array.isArray(data.profiles)) profileNames = data.profiles;
      profilesInUse = Array.isArray(data.inUse) ? data.inUse : profilesInUse;
      return data;
    } catch {
      profileError = 'Server connection unavailable.';
      return null;
    } finally {
      profileBusy = false;
    }
  }

  async function submitNewProfile(tabId) {
    const name = newProfileName.trim();
    if (!name) return;
    const data = await profileWrite('/terminal/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!data) return;
    newProfileName = '';
    colorForProfile(data.profileId);
    setTabProfile(tabId, data.profileId);
  }

  function startProfileRename(name) {
    profileError = '';
    profileDeleting = null;
    profileEditing = name;
    profileEditValue = name;
    tick().then(() => {
      const el = document.getElementById(`profile-rename-${name}`);
      if (el) { el.focus(); el.select(); }
    });
  }

  function cancelProfileRename() {
    profileEditing = null;
    profileEditValue = '';
  }

  async function submitProfileRename(from) {
    const to = profileEditValue.trim();
    if (!to || to === from) { cancelProfileRename(); return; }
    const data = await profileWrite(`/terminal/profiles/${encodeURIComponent(from)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: to }),
    });
    if (!data) return;
    // A cor é lembrança local do nome antigo: leva junto para a aba não trocar de cor
    // debaixo do usuário por causa de um rename.
    if (profileColors[from]) {
      profileColors = { ...profileColors, [data.profileId]: profileColors[from] };
      delete profileColors[from];
      saveProfileColors();
    }
    // O servidor recusa renomear perfil com sessão viva, então as abas que apontam
    // para ele estão paradas: basta reapontar o nome, sem reiniciar nada.
    for (const tab of tabs) if (tab.profileId === from) tab.profileId = data.profileId;
    tabs = tabs;
    persistTabs();
    cancelProfileRename();
  }

  function askDeleteProfile(name) {
    profileError = '';
    profileEditing = null;
    profileDeleting = name;
  }

  async function confirmDeleteProfile() {
    const name = profileDeleting;
    if (!name) return;
    const data = await profileWrite(`/terminal/profiles/${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (!data) return;
    if (profileColors[name]) {
      delete profileColors[name];
      profileColors = { ...profileColors };
      saveProfileColors();
    }
    // Abas órfãs voltam para o default; a sessão em si já estava morta (o servidor
    // recusa apagar perfil em uso), então só o rótulo muda até o próximo start.
    for (const tab of tabs) if (tab.profileId === name) tab.profileId = 'default';
    tabs = tabs;
    persistTabs();
    profileDeleting = null;
  }

  function toggleProfileMenu(e, tabId) {
    e.stopPropagation();
    profileMenuFor = profileMenuFor === tabId ? null : tabId;
    newProfileName = '';
    profileError = '';
    profileEditing = null;
    profileDeleting = null;
    if (profileMenuFor) loadProfiles();
  }

  function openActiveProfileMenu(e) {
    e.stopPropagation();
    tabsMenuOpen = true;
    profileMenuFor = activeTabId;
    newProfileName = '';
    profileError = '';
    profileEditing = null;
    profileDeleting = null;
    loadProfiles();
  }

  function closeProfileMenu() {
    profileMenuFor = null;
    newProfileName = '';
    profileError = '';
    profileEditing = null;
    profileDeleting = null;
  }

  function setTabProfile(tabId, profileId) {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;
    if (tab.profileId !== profileId) {
      // Trocar o perfil no meio da sessão é trocar de identidade — o shell em execução
      // não tem como ser remanejado de $HOME, então mata o processo e sobe outro.
      tab.profileId = profileId;
      tabs = tabs;
      persistTabs();
      const inst = instances.get(tabId);
      if (inst) {
        send({ action: 'kill', ptyId: tabId });
        inst.started = false;
        inst.term.reset();
        inst.term.write(`\x1b[90m[profile: ${profileId}, new session]\x1b[0m\r\n`);
        ensureStarted(tabId);
      }
    }
    closeProfileMenu();
  }

  function tabColor(tab) {
    return colorForProfile(tab?.profileId || 'default');
  }

  function tabContextLabel(tab) {
    return `Perfil: ${tab?.profileId || 'default'}`;
  }

  function haptic() {
    if (typeof window === 'undefined') return;
    try { navigator.vibrate?.(8); } catch {}
  }

  const instances = new Map();

  let ws = null;
  let wsReady = false;
  let terminalAuthed = false;
  // 'offline' | 'connecting' | 'online' — o rótulo no cabeçalho sai daqui. `wsReady`
  // continua existindo porque ensureStarted é chamado de dentro de callbacks e
  // precisa ler o estado no mesmo tick (uma `$:` derivada só valeria no flush).
  let connState = 'connecting';
  let terminalAvailable = true;
  let terminalNotice = '';
  let reconnectAttempt = 0;
  let reconnectTimer = null;
  let connecting = false;
  let containerRoot;
  let sessionStates = {};
  let accessibleOutput = {};
  // O canvas do xterm é a melhor superfície no desktop, mas alguns WebViews
  // Android conectam o socket e ainda assim não compõem o canvas. Mantemos uma
  // cópia textual do stream para uma superfície móvel que não depende de GPU.
  let mobileOutput = {};
  let mobileCommand = '';
  let desktopCommand = null;

  function tabName(tabId) {
    return tabs.find(tab => tab.id === tabId)?.name || 'Terminal';
  }

  function setSessionState(tabId, state) {
    sessionStates = { ...sessionStates, [tabId]: state };
    updateInputAccessibility(tabId);
  }

  // O xterm desenha em canvas. Espelhamos as linhas que ele de fato mantém no
  // buffer depois que o parser termina, sem interpretar o stream cru do PTY.
  function syncAccessibleOutput(tabId) {
    const inst = instances.get(tabId);
    if (!inst) return;
    try {
      const buffer = inst.term.buffer.active;
      const first = Math.max(0, buffer.length - 500);
      const lines = [];
      for (let index = first; index < buffer.length; index++) {
        lines.push(buffer.getLine(index)?.translateToString(true) || '');
      }
      accessibleOutput = { ...accessibleOutput, [tabId]: lines.join('\n').trimEnd() };
      finishDesktopCommand(tabId);
    } catch {}
  }

  function appendMobileOutput(tabId, data) {
    // Remove sequências de controle de cor/modo que fariam o stream cru aparecer
    // como lixo. Não tentamos emular um terminal: o PTY continua sendo a fonte
    // de verdade; esta é somente uma saída resiliente para WebViews sem canvas.
    const text = String(data || '')
      .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\\\)/g, '')
      .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/\u0000/g, '')
      .replace(/\r\n?/g, '\n');
    if (!text) return;
    const previous = mobileOutput[tabId] || '';
    mobileOutput = { ...mobileOutput, [tabId]: `${previous}${text}`.slice(-120_000) };
  }

  function submitMobileCommand() {
    const command = mobileCommand;
    mobileCommand = '';
    if (!command || sessionStates[activeTabId] !== 'ready') return;
    send({ action: 'input', ptyId: activeTabId, data: `${applyStickyModifiers(command)}\r` });
  }

  function replyToDesktop(requestId, payload) {
    if (typeof window === 'undefined') return;
    window.parent.postMessage({
      source: 'thinkiac-terminal', type: 'terminal:result', detail: { requestId, ...payload },
    }, window.location.origin);
  }

  function finishDesktopCommand(tabId) {
    if (!desktopCommand || desktopCommand.tabId !== tabId) return;
    const result = outputFromMarker(accessibleOutput[tabId], desktopCommand.requestId);
    if (!result) return;
    const requestId = desktopCommand.requestId;
    const output = result.output.startsWith(desktopCommand.outputBefore)
      ? result.output.slice(desktopCommand.outputBefore.length).replace(/^\n/, '')
      : result.output;
    desktopCommand = null;
    replyToDesktop(requestId, { ok: true, tabId, ...result, output });
  }

  function failDesktopCommand(tabId, error) {
    if (!desktopCommand || desktopCommand.tabId !== tabId) return;
    const requestId = desktopCommand.requestId;
    desktopCommand = null;
    replyToDesktop(requestId, { ok: false, error });
  }

  function onDesktopCommand(event) {
    const message = event.data;
    if (event.origin !== window.location.origin
      || event.source !== window.parent
      || message?.source !== 'thinkiac-desktop-control'
      || message.type !== 'terminal:execute') return;
    const requestId = String(message.detail?.requestId || '').trim();
    const command = String(message.detail?.command || '');
    if (!requestId || !command.trim()) return;
    if (desktopCommand) {
      replyToDesktop(requestId, { ok: false, error: 'Terminal is busy with another Desktop Control command' });
      return;
    }
    const tabId = activeTabId;
    const inst = instances.get(tabId);
    if (!inst || sessionStates[tabId] !== 'ready') {
      replyToDesktop(requestId, { ok: false, error: 'Terminal session is not ready yet' });
      return;
    }
    desktopCommand = { requestId, tabId, outputBefore: accessibleOutput[tabId] || '' };
    send({ action: 'input', ptyId: tabId, data: commandWithMarker(command, requestId) });
  }

  function updateInputAccessibility(tabId) {
    const textarea = instances.get(tabId)?.term?.textarea;
    if (!textarea) return;
    const state = sessionStates[tabId] || 'connecting';
    textarea.setAttribute('aria-label', `${tabName(tabId)} input`);
    textarea.setAttribute('aria-description', state === 'ready' ? 'Session ready' : 'Session is not ready yet');
  }

  const XTERM_THEMES = {
    dark:  { background: '#141414', foreground: '#e6e6e6', cursor: '#e6e6e6', selectionBackground: 'rgba(255,255,255,0.18)' },
    light: { background: '#ffffff', foreground: '#1a1a1a', cursor: '#1a1a1a', selectionBackground: 'rgba(0,0,0,0.12)' },
  };
  let theme = 'dark';

  function readTheme() {
    if (typeof window === 'undefined') return 'dark';
    try {
      const s = localStorage.getItem('think:theme');
      return (s === 'light' || s === 'dark') ? s : 'dark';
    } catch { return 'dark'; }
  }

  function currentXtermTheme() {
    return XTERM_THEMES[theme] || XTERM_THEMES.dark;
  }

  function applyTheme(next) {
    theme = next === 'light' ? 'light' : 'dark';
    if (typeof window === 'undefined') return;
    try { document.body.style.background = theme === 'light' ? '#ffffff' : '#111111'; } catch {}
    for (const inst of instances.values()) {
      try { inst.term.options.theme = currentXtermTheme(); } catch {}
    }
  }

  function onStorage(e) {
    if (e.key === 'think:theme') applyTheme(e.newValue);
  }

  const FONT_MIN = 9;
  const FONT_MAX = 28;
  const FONT_DEFAULT = 14;
  let fontSize = FONT_DEFAULT;

  function readFontSize() {
    if (typeof window === 'undefined') return FONT_DEFAULT;
    try {
      const n = parseInt(localStorage.getItem('terminalFontSize'), 10);
      return Number.isFinite(n) && n >= FONT_MIN && n <= FONT_MAX ? n : FONT_DEFAULT;
    } catch { return FONT_DEFAULT; }
  }

  function setFontSize(next) {
    fontSize = Math.min(FONT_MAX, Math.max(FONT_MIN, next));
    if (typeof window !== 'undefined') {
      try { localStorage.setItem('terminalFontSize', String(fontSize)); } catch {}
    }
    for (const inst of instances.values()) {
      try {
        inst.term.options.fontSize = fontSize;
        // Mudar o corpo da fonte muda quantas colunas/linhas cabem: o fit recalcula
        // e dispara onResize, que avisa o PTY do outro lado.
        inst.fitAddon.fit();
      } catch {}
    }
  }

  function bumpFont(delta) {
    haptic();
    setFontSize(fontSize + delta);
  }

  // ── Snippets: trechos de comando gravados pelo usuário ────
  // Tocar num snippet só digita o texto, sem Enter — dá para revisar ou completar
  // antes de rodar, que é o que se quer num teclado de celular.
  const DEFAULT_SNIPPETS = [
    { label: 'ls -la', text: 'ls -la' },
    { label: 'git status', text: 'git status' },
    { label: 'cd ..', text: 'cd ..' },
  ];

  let snippets = DEFAULT_SNIPPETS;
  let snippetsOpen = false;
  let newSnippetLabel = '';
  let newSnippetText = '';

  function loadSnippets() {
    if (typeof window === 'undefined') return;
    try {
      const raw = JSON.parse(localStorage.getItem('terminalSnippets') || 'null');
      if (Array.isArray(raw)) snippets = raw.filter(s => s && typeof s.text === 'string');
    } catch {}
  }

  function saveSnippets() {
    if (typeof window === 'undefined') return;
    try { localStorage.setItem('terminalSnippets', JSON.stringify(snippets)); } catch {}
  }

  function useSnippet(snippet) {
    haptic();
    sendRaw(snippet.text);
  }

  function addSnippet() {
    const text = newSnippetText.trim();
    if (!text) return;
    const label = (newSnippetLabel.trim() || text).slice(0, 24);
    snippets = [...snippets, { label, text }];
    saveSnippets();
    newSnippetLabel = '';
    newSnippetText = '';
  }

  function removeSnippet(index) {
    snippets = snippets.filter((_, i) => i !== index);
    saveSnippets();
  }

  let ctrlActive = false;
  let altActive = false;
  let shiftActive = false;
  let barExpanded = false;
  let showBar = false;
  let kbOffset = 0;
  let barHeight = 0;
  let viewportHeight = 0;

  // Refaz o cálculo de colunas/linhas do painel ativo — chamado quando a altura útil
  // do terminal muda (barra de teclas abre/expande, teclado sobe), para o conteúdo
  // não ficar escondido atrás da barra fixa.
  function refitActive() {
    if (typeof window === 'undefined') return;
    requestAnimationFrame(() => {
      const inst = activeInstance();
      if (inst) { try { inst.fitAddon.fit(); } catch {} }
    });
  }

  // Mede a barra de teclas enquanto ela existe (só no mobile) e mantém `barHeight`
  // atualizado quando o drawer/snippets expandem — a reserva de espaço acompanha.
  function measureBar(node) {
    const update = () => { barHeight = node.offsetHeight; refitActive(); };
    // Alguns WebViews Android antigos não expõem ResizeObserver. A ausência dele
    // não pode impedir a montagem do terminal: o resize da janela é suficiente
    // como fallback para a barra de atalhos.
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    if (ro) ro.observe(node);
    else window.addEventListener('resize', update);
    update();
    return {
      destroy() {
        if (ro) ro.disconnect();
        else window.removeEventListener('resize', update);
        barHeight = 0;
        refitActive();
      },
    };
  }

  const ico = {
    left:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>',
    right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
    up:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>',
    down:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>',
    minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    plus:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    list:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="20" y2="12"/><line x1="8" y1="18" x2="20" y2="18"/><circle cx="3.5" cy="6" r="1.3" fill="currentColor" stroke="none"/><circle cx="3.5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="3.5" cy="18" r="1.3" fill="currentColor" stroke="none"/></svg>',
    reload:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 21 6"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>',
    pencil:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  };

  function updateBarPosition() {
    if (typeof window === 'undefined') { kbOffset = 0; viewportHeight = 0; return; }
    const vv = window.visualViewport;
    if (vv) {
      kbOffset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      // Em mobile, `innerHeight` pode continuar sendo a altura do layout enquanto o
      // teclado está aberto. A altura do viewport visual é a área realmente visível.
      viewportHeight = Math.round(vv.height);
    } else {
      kbOffset = 0;
      viewportHeight = window.innerHeight;
    }
    refitActive();
  }

  function refreshShowBar() {
    if (typeof window === 'undefined') { showBar = false; return; }
    try {
      showBar = window.matchMedia('(pointer: coarse)').matches || window.innerWidth <= 820;
    } catch { showBar = window.innerWidth <= 820; }
  }

  function keepFocus(e) {
    e.preventDefault();
  }

  function toggleCtrl() {
    haptic();
    ctrlActive = !ctrlActive;
    if (ctrlActive) altActive = false;
  }

  function toggleAlt() {
    haptic();
    altActive = !altActive;
    if (altActive) ctrlActive = false;
  }

  // Shift é independente de Ctrl/Alt: combina com eles (Ctrl+Shift+…) e sozinho
  // habilita o Shift+Tab — que o Claude usa para alternar de modo.
  function toggleShift() {
    haptic();
    shiftActive = !shiftActive;
  }

  function applyStickyModifiers(data) {
    if (data.length !== 1) return data;
    if (ctrlActive) {
      ctrlActive = false;
      const code = data.toUpperCase().charCodeAt(0);
      if (code >= 64 && code <= 95) return String.fromCharCode(code - 64);
      return data;
    }
    if (altActive) {
      altActive = false;
      return '\x1b' + data;
    }
    return data;
  }

  function activeInstance() {
    return instances.get(activeTabId);
  }

  function sendRaw(data) {
    send({ action: 'input', ptyId: activeTabId, data });
  }

  function sendCtrlLetter(letter) {
    // Roteia pelo xterm (mesmo caminho das setas/Tab, que funcionam) em vez de escrever
    // o byte cru direto no PTY: garante que o terminal esteja focado e deixa o xterm
    // codificar o Ctrl+letra. O ^C via sendRaw às vezes não interrompia o processo.
    const lower = letter.toLowerCase();
    dispatchKey(lower, lower.toUpperCase().charCodeAt(0), { ctrlKey: true });
  }

  // Injeta um keydown sintético no textarea do xterm com os modificadores dados. O
  // xterm converte em escape (ex.: Shift+Tab → CSI Z, `\x1b[Z`), que é o que a app lê.
  function dispatchKey(key, keyCode, mods = {}) {
    const inst = activeInstance();
    const textarea = inst?.term?.textarea;
    if (!textarea) return;
    haptic();
    textarea.focus();
    const evt = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods });
    Object.defineProperty(evt, 'keyCode', { get: () => keyCode });
    Object.defineProperty(evt, 'which', { get: () => keyCode });
    textarea.dispatchEvent(evt);
  }

  function sendSpecialKey({ key, keyCode }) {
    // Consome os modificadores sticky para que combinações como Shift+Tab, Ctrl+Tab
    // ou Alt+← cheguem à app com o modificador correto — sem isto o botão manda a
    // tecla nua e o modificador pressionado antes é ignorado (só valia p/ letras).
    const mods = { ctrlKey: ctrlActive, altKey: altActive, shiftKey: shiftActive };
    ctrlActive = false;
    altActive = false;
    shiftActive = false;
    dispatchKey(key, keyCode, mods);
  }

  const KEYS = {
    esc: { key: 'Escape', keyCode: 27 },
    tab: { key: 'Tab', keyCode: 9 },
    left: { key: 'ArrowLeft', keyCode: 37 },
    up: { key: 'ArrowUp', keyCode: 38 },
    right: { key: 'ArrowRight', keyCode: 39 },
    down: { key: 'ArrowDown', keyCode: 40 },
    home: { key: 'Home', keyCode: 36 },
    end: { key: 'End', keyCode: 35 },
    pageUp: { key: 'PageUp', keyCode: 33 },
    pageDown: { key: 'PageDown', keyCode: 34 },
    del: { key: 'Delete', keyCode: 46 },
  };

  function wsUrl() {
    if (typeof window === 'undefined') return 'ws://localhost/ws?session=ssr';
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // O owner do PTY é este sessionId. Fica no localStorage (não sessionStorage) para
    // continuar o mesmo após um restart do app — só assim o servidor reconhece o dono
    // e reatacha os PTYs vivos das abas restauradas em vez de recusá-los.
    let sessionId = localStorage.getItem('terminalWsSession');
    if (!sessionId) {
      sessionId = browserUuid();
      localStorage.setItem('terminalWsSession', sessionId);
    }
    return `${proto}//${window.location.host}/ws?session=${sessionId}`;
  }

  async function fetchToken() {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), 10_000) : null;
    try {
      const res = await fetch('/terminal/token', controller ? { signal: controller.signal } : undefined);
      // Uma resposta de autenticação não melhora sozinha. Antes, 401/403 viravam
      // `null` e mantinham a tela em “Connecting…” para sempre no mobile.
      if (res.status === 401 || res.status === 403 || res.redirected) return { fatal: true };
      if (!res.ok) return { transient: true };
      const data = await res.json();
      return data.token ? { token: data.token } : { transient: true };
    } catch {
      return { transient: true };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async function loadCapabilities() {
    try {
      const res = await fetch('/terminal/capabilities');
      // Keep the existing server terminal compatible with older runtimes that
      // predate this probe.
      if (res.status === 404) return true;
      // A 5xx is usually the narrow window while the Runtime is restarting.
      // Keep the connection loop alive so fetchToken() can retry after it is
      // ready again. Auth redirects and every other non-success response still
      // stop here, rather than turning a signed-out session into a retry loop.
      if (res.status >= 500 && res.status < 600) return true;
      // The access gate follows its login redirect before fetch resolves.  The
      // resulting HTML response is not a transient terminal failure: opening a
      // socket after it only creates an endless reconnect loop.
      if (res.redirected || !res.ok) throw new Error('Terminal capability check failed');
      const capabilities = await res.json();
      if (capabilities?.pty) return true;
      stopTerminal(capabilities?.unavailableReason === 'NATIVE_PTY_UNAVAILABLE'
        ? 'Local terminal support is not installed on this device.'
        : 'This runtime does not provide an interactive terminal.');
      return false;
    } catch {
      // Do not keep retrying blindly. A failed capability check can be an
      // expired session, an unavailable local bridge, or a server startup
      // failure. The Reconnect control lets the user make a deliberate retry.
      stopTerminal('Terminal service is unavailable. Sign in again or retry.');
      return false;
    }
  }

  function stopTerminal(notice) {
    terminalAvailable = false;
    connState = 'offline';
    terminalNotice = notice;
    teardownWs();
  }

  // Derruba o socket atual por completo: zera os handlers ANTES de fechar para que o
  // seu onclose não agende outra reconexão e, sobretudo, para que o seu onmessage pare
  // de escrever a saída do PTY. Um socket órfão ainda aberto continuaria recebendo os
  // mesmos dados (o dono do PTY — sessionId — vive no localStorage e é compartilhado) e
  // escreveria cada caractere de novo no terminal: era a origem do "teclado duplicando".
  function teardownWs() {
    stopHeartbeat();
    if (!ws) return;
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    try { ws.close(); } catch {}
    ws = null;
  }

  // ── Batimento ────────────────────────────────────────────────────────────
  // Um socket que morre "sujo" (Wi-Fi que some, 4G que troca de torre, aba dormindo
  // no celular) não dispara `close`: para o navegador ele continua OPEN e o terminal
  // fica mudo até o usuário desistir. O ping/pong é o que detecta isso — sem resposta
  // dentro de PONG_TIMEOUT, o socket é considerado morto e a reconexão começa.
  const PING_INTERVAL_MS = 20_000;
  const PONG_TIMEOUT_MS = 8_000;
  let pingTimer = null;
  let pongTimer = null;

  function stopHeartbeat() {
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    if (pongTimer) { clearTimeout(pongTimer); pongTimer = null; }
  }

  function startHeartbeat() {
    stopHeartbeat();
    pingTimer = setInterval(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (pongTimer) return; // já existe um ping em voo
      send({ action: 'ping' });
      pongTimer = setTimeout(() => {
        pongTimer = null;
        // Sem pong: o socket está morto mesmo que o navegador ainda o diga aberto.
        reconnectNow({ reason: 'sem resposta do servidor' });
      }, PONG_TIMEOUT_MS);
    }, PING_INTERVAL_MS);
  }

  // Backoff exponencial com teto e jitter. O teto é curto porque o PTY do outro lado
  // só sobrevive à queda por TERMINAL_GRACE_MS (45s por padrão): esperar mais que
  // isso entre tentativas transforma uma queda de rede curta em sessão perdida.
  const RECONNECT_MAX_MS = 8_000;

  function scheduleReconnect() {
    if (reconnectTimer || connecting) return;
    const base = Math.min(1000 * 2 ** reconnectAttempt, RECONNECT_MAX_MS);
    // Jitter evita que várias abas do mesmo navegador voltem no mesmo milissegundo.
    const delay = base * (0.7 + Math.random() * 0.6);
    reconnectAttempt++;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  // Reconexão imediata: usada pelo botão de reload e pelos gatilhos de "a rede voltou"
  // (online/visibilitychange). Zera o backoff — o motivo aqui é uma evidência nova de
  // que dá para conectar, não mais uma tentativa às cegas.
  function reconnectNow({ reason = '' } = {}) {
    if (typeof window === 'undefined') return;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    reconnectAttempt = 0;
    if (reason) noteOnActive(`\x1b[90m[${reason}, reconnecting]\x1b[0m\r\n`);
    connect();
  }

  function noteOnActive(text) {
    const inst = activeInstance();
    if (inst) { try { inst.term.write(`\r\n${text}`); } catch {} }
  }

  // Chamado quando a rede/aba volta: só age se de fato não houver socket aberto,
  // para um `focus` qualquer não derrubar uma conexão saudável.
  function reviveIfDown() {
    if (typeof document !== 'undefined' && document.hidden) return;
    // CONNECTING também conta como "em andamento": derrubar um handshake no meio só
    // recomeçaria o mesmo trabalho.
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    if (connecting) return;
    reconnectNow();
  }

  function onOnline() { reviveIfDown(); }
  function onVisibility() { reviveIfDown(); }

  async function connect() {
    if (typeof window === 'undefined') return;
    if (!terminalAvailable) return;
    // Guarda de reentrância: `connect` é async (busca o token antes de abrir o socket),
    // então duas chamadas próximas — timer do backoff + evento `online`, por exemplo —
    // passariam as duas pela verificação de `ws` e abririam sockets em paralelo, que é
    // o que duplica a saída do PTY.
    if (connecting) return;
    connecting = true;

    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    teardownWs();
    wsReady = false;
    terminalAuthed = false;
    connState = 'connecting';

    try {
      // O hub WebSocket do runtime engancha no upgrade do HTTP e não passa pelo
      // accessGate, então o socket por si só não prova quem é. Este token vem de uma
      // rota HTTP que passa pelo gate (admin-only) e é o que autoriza abrir um PTY.
      const tokenResult = await fetchToken();
      if (tokenResult.fatal) {
        stopTerminal('Terminal authentication expired. Sign in again or retry.');
        return;
      }
      if (!tokenResult.token) {
        // Sem token o socket abriria só para ser recusado no auth e ficar mudo —
        // melhor não abrir e tentar de novo (o gate pode estar reiniciando).
        connState = 'offline';
        scheduleReconnect();
        return;
      }
      const token = tokenResult.token;

      const sock = new WebSocket(wsUrl());
      ws = sock;

      sock.onopen = () => {
        if (ws !== sock) return;
        connState = 'online';
        reconnectAttempt = 0;
        // Compatibilidade: instâncias já abertas do Runtime conhecem `auth`, mas
        // não necessariamente respondem `terminal:pty:authenticated`. O socket
        // preserva a ordem das mensagens, portanto libera os starts logo após
        // enviar a autenticação. A confirmação, quando existir, só reafirma o
        // estado e nunca é um requisito para desenhar/iniciar o terminal.
        wsReady = true;
        send({ action: 'auth', token });
        for (const tab of tabs) ensureStarted(tab.id);
        startHeartbeat();
      };

      sock.onmessage = (event) => {
        if (ws !== sock) return;
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }
        // Qualquer tráfego do servidor prova que o socket está vivo.
        if (pongTimer) { clearTimeout(pongTimer); pongTimer = null; }

        if (msg.type === 'terminal:pty:authenticated') {
          if (ws !== sock) return;
          terminalAuthed = true;
          wsReady = true;
          for (const tab of tabs) ensureStarted(tab.id);
        } else if (msg.type === 'terminal:pty:data') {
          appendMobileOutput(msg.ptyId, msg.data);
          const inst = instances.get(msg.ptyId);
          if (inst) inst.term.write(msg.data);
        } else if (msg.type === 'terminal:pty:started') {
          setSessionState(msg.ptyId, 'ready');
        } else if (msg.type === 'terminal:pty:pong') {
          // já tratado acima (limpa o timer de pong)
        } else if (msg.type === 'terminal:pty:exit') {
          const inst = instances.get(msg.ptyId);
          if (inst) {
            inst.started = false;
            inst.term.write(`\r\n\x1b[90m[process exited with code ${msg.exitCode}]\x1b[0m\r\n`);
          }
          setSessionState(msg.ptyId, 'stopped');
          failDesktopCommand(msg.ptyId, `Terminal session exited with code ${msg.exitCode}`);
        } else if (msg.type === 'terminal:pty:error') {
          const inst = instances.get(msg.ptyId);
          if (inst) inst.started = false;
          setSessionState(msg.ptyId, 'error');
          failDesktopCommand(msg.ptyId, msg.message || 'Terminal session failed');
          const target = inst || activeInstance();
          target?.term.write(`\r\n\x1b[31m[${msg.message}]\x1b[0m\r\n`);
          // Token vencido/recusado: o socket segue aberto mas inútil, então só uma
          // reconexão (que busca um token novo) devolve o terminal ao usuário.
          if (/unauthorized/i.test(msg.message || '')) reconnectNow();
        }
      };

      sock.onclose = () => {
        // Ignora o close de um socket que já foi substituído por outro.
        if (ws !== sock) return;
        stopHeartbeat();
        ws = null;
        wsReady = false;
        terminalAuthed = false;
        connState = 'offline';
        for (const [tabId, inst] of instances) {
          inst.started = false;
          setSessionState(tabId, 'offline');
          failDesktopCommand(tabId, 'Terminal connection closed');
        }
        scheduleReconnect();
      };

      sock.onerror = () => { try { sock.close(); } catch {} };
    } finally {
      connecting = false;
    }
  }

  // ── Reload ───────────────────────────────────────────────────────────────
  // Botão do cabeçalho. Reconecta o socket na hora e refaz o fit dos painéis — é o
  // que resolve o caso comum de "o terminal parou de responder" sem matar o que
  // estiver rodando: o PTY continua vivo do outro lado e é reatado. Para derrubar o
  // shell de fato existe o "reiniciar sessão" de cada aba.
  async function reloadTerminal() {
    haptic();
    if (!terminalAvailable) {
      terminalNotice = '';
      terminalAvailable = true;
      if (!await loadCapabilities()) return;
    }
    reconnectNow();
    refitActive();
  }

  // Mata o PTY da aba e sobe um shell novo no mesmo perfil.
  function restartTab(tabId) {
    haptic();
    const inst = instances.get(tabId);
    if (!inst) return;
    send({ action: 'kill', ptyId: tabId });
    inst.started = false;
    inst.term.reset();
    inst.term.write('\x1b[90m[session restarted]\x1b[0m\r\n');
    ensureStarted(tabId);
    closeTabsMenu();
  }

  function send(payload) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: CHANNEL, ...payload }));
  }

  function ensureStarted(ptyId) {
    const inst = instances.get(ptyId);
    if (!inst || inst.started || !wsReady) return;
    inst.started = true;
    setSessionState(ptyId, 'starting');
    const { cols, rows } = inst.term;
    const tab = tabs.find(t => t.id === ptyId);
    const profileId = tab?.profileId || 'default';
    // initCommand só existe em abas abertas por deeplink de sessão (widget
    // "Sessões Claude"); é consumido no primeiro start e nunca persistido, então
    // uma reconexão/reload não re-roda o `claude --resume`.
    const initCommand = tab?.initCommand;
    if (tab && initCommand) delete tab.initCommand;
    send({
      action: 'start',
      ptyId,
      cols,
      rows,
      profileId,
      initCommand,
    });
  }

  function createInstance(tabId) {
    if (typeof window === 'undefined') return;
    const container = document.createElement('div');
    container.className = 'xterm-pane';
    container.style.visibility = tabId === activeTabId ? 'visible' : 'hidden';
    containerRoot.appendChild(container);

    let term;
    let fitAddon;
    try {
      const FitAddonCtor = window.FitAddon.FitAddon || window.FitAddon;
      term = new window.Terminal({
        cursorBlink: true,
        fontFamily: "'Ubuntu Mono', Consolas, Monaco, monospace",
        fontSize,
        theme: currentXtermTheme(),
        scrollback: 5000,
        allowProposedApi: true,
      });
      fitAddon = new FitAddonCtor();
      term.loadAddon(fitAddon);
      term.open(container);
    } catch (error) {
      container.remove();
      terminalNotice = `Terminal renderer could not start: ${error?.message || 'unknown error'}`;
      setSessionState(tabId, 'error');
      return;
    }
    term.onWriteParsed(() => syncAccessibleOutput(tabId));

    term.onData(data => send({ action: 'input', ptyId: tabId, data: applyStickyModifiers(data) }));
    term.onResize(({ cols, rows }) => send({ action: 'resize', ptyId: tabId, cols, rows }));

    const resize = () => {
      if (container.style.visibility === 'visible') {
        try { fitAddon.fit(); } catch {}
      }
    };
    // ResizeObserver é ótimo para painéis em desktop, mas não existe em alguns
    // WebViews. Sem o fallback, a exceção aqui interrompia createInstance antes
    // de registrar/iniciar o PTY, deixando o mobile "conectado" sem terminal.
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    if (resizeObserver) resizeObserver.observe(container);
    else window.addEventListener('resize', resize);

    // O teclado virtual e a barra segura alteram o visualViewport sem disparar
    // resize em alguns Android WebViews. Reaplicar o fit nesses eventos evita o
    // canvas nascer com largura/altura zero e permanecer invisível.
    const onViewportResize = () => resize();
    window.visualViewport?.addEventListener('resize', onViewportResize);
    window.visualViewport?.addEventListener('scroll', onViewportResize);

    instances.set(tabId, { term, fitAddon, container, resizeObserver, resize, onViewportResize, started: false });
    updateInputAccessibility(tabId);

    // O primeiro frame do WebView pode ocorrer antes de o container receber
    // tamanho. Esperamos dimensões reais, mas mantemos um limite para não impedir
    // a sessão em navegadores que não reportam layout de forma confiável.
    let attempts = 0;
    const startWhenLaidOut = () => {
      const laidOut = container.clientWidth > 0 && container.clientHeight > 0;
      if (laidOut || attempts++ >= 20) {
        resize();
        try { term.refresh(0, term.rows - 1); } catch {}
        ensureStarted(tabId);
        return;
      }
      requestAnimationFrame(startWhenLaidOut);
    };
    requestAnimationFrame(startWhenLaidOut);
  }

  function destroyInstance(tabId) {
    const inst = instances.get(tabId);
    if (!inst) return;
    send({ action: 'kill', ptyId: tabId });
    if (inst.resizeObserver) inst.resizeObserver.disconnect();
    else window.removeEventListener('resize', inst.resize);
    if (typeof window !== 'undefined') {
      window.visualViewport?.removeEventListener('resize', inst.onViewportResize);
      window.visualViewport?.removeEventListener('scroll', inst.onViewportResize);
    }
    inst.term.dispose();
    inst.container.remove();
    instances.delete(tabId);
    const { [tabId]: _state, ...remainingStates } = sessionStates;
    const { [tabId]: _output, ...remainingOutput } = accessibleOutput;
    const { [tabId]: _mobileOutput, ...remainingMobileOutput } = mobileOutput;
    sessionStates = remainingStates;
    accessibleOutput = remainingOutput;
    mobileOutput = remainingMobileOutput;
  }

  function selectTab(id) {
    activeTabId = id;
    persistTabs();
    for (const [tabId, inst] of instances) {
      inst.container.style.visibility = tabId === id ? 'visible' : 'hidden';
    }
    const inst = instances.get(id);
    if (inst) {
      updateInputAccessibility(id);
      requestAnimationFrame(() => {
        try { inst.fitAddon.fit(); } catch {}
        inst.term.focus();
      });
    }
  }

  function addTab() {
    const id = newTabId();
    const profileId = tabs.find(t => t.id === activeTabId)?.profileId || 'default';
    tabs = [...tabs, { id, name: `Terminal ${nextTabNumber('Terminal')}`, profileId }];
    persistTabs();
    createInstance(id);
    selectTab(id);
  }

  // ── Deeplink de sessão do Claude (widget "Sessões Claude") ───────────────
  // Abre uma aba já no perfil da conta e injeta o comando de resume. O
  // initCommand fica só no objeto da aba em memória (persistTabs só grava
  // id/nome/perfil), então não é reenviado numa reconexão — ver ensureStarted.
  function openSessionTab({ profileId, initCommand, name }) {
    const id = newTabId();
    tabs = [...tabs, {
      id,
      name: name || `Sessão ${nextTabNumber('Sessão')}`,
      profileId: profileId || 'default',
      initCommand,
    }];
    persistTabs();
    createInstance(id);
    selectTab(id);
  }

  // Esvazia a fila do backend (consumo one-shot no GET). Chamado ao montar e num
  // intervalo enquanto a aba está visível — o widget enfileira e traz o terminal
  // pra frente; nós materializamos a aba aqui.
  let pendingTimer = null;
  async function pollPendingOpens() {
    if (typeof document !== 'undefined' && document.hidden) return;
    try {
      const results = await Promise.all([
        fetch('/agent/claude-sessions/pending'),
        fetch('/agent/codex-sessions/pending'),
        fetch('/agent/antigravity-sessions/pending'),
        fetch('/agent/gemini-sessions/pending'),
      ]);
      for (const res of results) {
        if (!res.ok) continue;
        const data = await res.json();
        for (const open of data?.opens ?? []) {
          openSessionTab({
            profileId: open.profileId,
            initCommand: open.initCommand,
            name: open.label,
          });
        }
      }
    } catch {}
  }

  function closeTab(e, id) {
    e.stopPropagation();
    destroyInstance(id);
    tabs = tabs.filter(t => t.id !== id);
    persistTabs();
    if (!tabs.length) {
      addTab();
      return;
    }
    if (activeTabId === id) selectTab(tabs[tabs.length - 1].id);
  }

  // ── Widget de abas ───────────────────────────────────────────────────────
  // A barra de abas no topo é apertada no celular — o nome não cabe e não dá pra
  // tocar pra renomear. Este menu lista todas as abas em coluna: tocar troca de
  // aba e o lápis abre um campo pra renomear ali mesmo (o nome novo reflete na
  // barra e é persistido, como qualquer outra edição de aba).
  let tabsMenuOpen = false;
  let renamingTabId = null;
  let renameValue = '';

  function toggleTabsMenu() {
    tabsMenuOpen = !tabsMenuOpen;
    renamingTabId = null;
    profileMenuFor = null;
  }

  function closeTabsMenu() {
    tabsMenuOpen = false;
    renamingTabId = null;
    profileMenuFor = null;
  }

  function selectTabFromMenu(id) {
    selectTab(id);
    closeTabsMenu();
  }

  function startRename(tab) {
    renamingTabId = tab.id;
    renameValue = tab.name;
    // Espera o input existir para focar e selecionar o texto (troca rápida de nome).
    tick().then(() => {
      const el = document.getElementById(`tab-rename-${tab.id}`);
      if (el) { el.focus(); el.select(); }
    });
  }

  function submitRename(id) {
    const name = renameValue.trim().slice(0, 40);
    const tab = tabs.find(t => t.id === id);
    if (tab && name) {
      tab.name = name;
      tabs = tabs;
      persistTabs();
      updateInputAccessibility(id);
    }
    renamingTabId = null;
  }

  // A aba ativa alimenta o rótulo do botão do menu — é o único lugar onde o nome
  // da aba corrente aparece agora que a tira horizontal de abas deixou de existir.
  $: activeTab = tabs.find(t => t.id === activeTabId) || null;

  onMount(async () => {
    applyTheme(readTheme());
    fontSize = readFontSize();
    loadSnippets();
    // Restaura as abas gravadas antes de subir o xterm, para recriar cada painel e
    // (re)atachar seu PTY na volta. Só depois disto ligamos a persistência.
    const persisted = loadPersistedTabs();
    if (persisted) {
      tabs = persisted.tabs;
      activeTabId = persisted.activeTabId;
    }
    hydrated = true;
    persistTabs();
    if (typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage);
      window.addEventListener('message', onDesktopCommand);
      refreshShowBar();
      updateBarPosition();
      window.addEventListener('resize', refreshShowBar);
      // A rede voltando ou a aba reaparecendo é evidência concreta de que dá para
      // reconectar agora — vale mais que o próximo passo do backoff.
      window.addEventListener('online', onOnline);
      document.addEventListener('visibilitychange', onVisibility);
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', updateBarPosition);
        window.visualViewport.addEventListener('scroll', updateBarPosition);
      }
    }
    loadProfiles();
    try {
      await loadXterm();
    } catch {
      terminalAvailable = false;
      connState = 'offline';
      terminalNotice = 'Terminal interface assets could not be loaded.';
      return;
    }
    if (!terminalAvailable) return;
    for (const tab of tabs) createInstance(tab.id);
    selectTab(activeTabId);
    // A sessão só pode começar depois de cada painel xterm existir. Se o socket
    // abrir antes, ensureStarted não encontra a instância e nenhum prompt nasce.
    const canStart = await loadCapabilities();
    if (canStart) connect();
    // Deeplink de sessão: consome já ao abrir e depois a cada 1.5s.
    pollPendingOpens();
    pendingTimer = setInterval(pollPendingOpens, 1500);
  });

  onDestroy(() => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (pendingTimer) clearInterval(pendingTimer);
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('message', onDesktopCommand);
      window.removeEventListener('resize', refreshShowBar);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', updateBarPosition);
        window.visualViewport.removeEventListener('scroll', updateBarPosition);
      }
    }
    for (const id of Array.from(instances.keys())) destroyInstance(id);
    if (desktopCommand) failDesktopCommand(desktopCommand.tabId, 'Terminal foi fechado');
    teardownWs();
  });
</script>

<svelte:head>
  <link rel="stylesheet" href="/vendor/xterm/xterm.css">
</svelte:head>

<div
  class="terminal-wrapper"
  data-theme={theme}
  style="--terminal-viewport-height:{viewportHeight > 0 ? `${viewportHeight}px` : '100dvh'}; padding-bottom:{showBar ? barHeight : 0}px"
>
  <div class="tabs-header">
    <div class="tabs-menu-wrap">
      <button
        class="tabs-menu-btn {tabsMenuOpen ? 'on' : ''}"
        on:mousedown={keepFocus}
        on:click={toggleTabsMenu}
        aria-label="Open tabs"
        title="Open tabs"
      >
        <span class="tabs-menu-ico">{@html ico.list}</span>
        <span class="tabs-menu-dot" style="background:{tabColor(activeTab)}"></span>
        <span class="tabs-menu-cur">{activeTab?.name || 'Terminal'}</span>
        <span class="tabs-menu-count">{tabs.length}</span>
        <span class="tabs-menu-chev {tabsMenuOpen ? 'on' : ''}">{@html ico.chevron}</span>
      </button>

      <button
        class="profile-quick-btn {profileMenuFor === activeTabId ? 'on' : ''}"
        on:mousedown={keepFocus}
        on:click={openActiveProfileMenu}
        aria-label="Change profile: {activeTab?.profileId || 'default'}"
        title="Change profile"
      >
        <span class="tabs-menu-dot" style="background:{tabColor(activeTab)}"></span>
        <span class="profile-quick-name">{activeTab?.profileId || 'default'}</span>
      </button>

      {#if tabsMenuOpen}
        <div class="tabs-menu-overlay" on:click={closeTabsMenu}></div>
        <div class="tabs-menu" on:click|stopPropagation>
          <div class="tabs-menu-title">Open tabs</div>
          {#each tabs as tab}
            <div class="tab-row {activeTabId === tab.id ? 'active' : ''}">
              {#if renamingTabId === tab.id}
                <span class="row-dot static" style="background:{tabColor(tab)}"></span>
                <input
                  id="tab-rename-{tab.id}"
                  class="tab-rename-input"
                  bind:value={renameValue}
                  on:click|stopPropagation
                  on:keydown={(e) => { if (e.key === 'Enter') submitRename(tab.id); else if (e.key === 'Escape') { renameValue = tab.name; renamingTabId = null; } }}
                  on:blur={() => submitRename(tab.id)}
                />
                <button class="tab-row-icon" on:click|stopPropagation={() => submitRename(tab.id)} aria-label="Save name">✓</button>
              {:else}
                <button
                  class="row-dot"
                  style="background:{tabColor(tab)}"
                  title={tabContextLabel(tab)}
                  aria-label="Tab profile"
                  on:click={(e) => toggleProfileMenu(e, tab.id)}
                ></button>
                <button class="tab-pick" on:click={() => selectTabFromMenu(tab.id)}>
                  <span class="name">{tab.name}</span>
                  {#if activeTabId === tab.id}<span class="here">●</span>{/if}
                </button>
                <button class="tab-row-icon" on:click|stopPropagation={() => restartTab(tab.id)} aria-label="Restart session" title="Restart session">{@html ico.reload}</button>
                <button class="tab-row-icon" on:click|stopPropagation={() => startRename(tab)} aria-label="Rename tab">{@html ico.pencil}</button>
                <button class="tab-row-icon danger" on:click={(e) => closeTab(e, tab.id)} aria-label="Close tab">✕</button>
              {/if}

              {#if profileMenuFor === tab.id}
                <div class="profile-inline" on:click|stopPropagation>
                  <div class="profile-menu-title">Tab profile</div>
                  {#each profileNames as name}
                    {#if profileEditing === name}
                      <div class="profile-edit-row">
                        <span class="dot" style="background:{colorForProfile(name)}"></span>
                        <input
                          id="profile-rename-{name}"
                          bind:value={profileEditValue}
                          on:click|stopPropagation
                          on:keydown={(e) => { if (e.key === 'Enter') submitProfileRename(name); else if (e.key === 'Escape') cancelProfileRename(); }}
                        />
                        <button class="profile-icon" disabled={profileBusy} on:click|stopPropagation={() => submitProfileRename(name)} aria-label="Save profile name">✓</button>
                        <button class="profile-icon" on:click|stopPropagation={cancelProfileRename} aria-label="Cancel">✕</button>
                      </div>
                    {:else if profileDeleting === name}
                      <!-- Confirmação inline: `confirm()` do navegador não existe no SSR
                           e trava a thread; isto renderiza igual dos dois lados. -->
                      <div class="profile-confirm">
                        <div class="profile-confirm-text">
                          Delete <strong>{name}</strong>? Its CLI logins, keys, and history will be moved to the server trash.
                        </div>
                        <div class="profile-confirm-actions">
                          <button class="secondary" on:click|stopPropagation={() => (profileDeleting = null)}>Cancel</button>
                          <button class="danger" disabled={profileBusy} on:click|stopPropagation={confirmDeleteProfile}>Delete</button>
                        </div>
                      </div>
                    {:else}
                      <div class="profile-row">
                        <button class="profile-option {tab.profileId === name ? 'selected' : ''}" on:click={() => setTabProfile(tab.id, name)}>
                          <span class="dot" style="background:{colorForProfile(name)}"></span>
                          <span class="name">{name}</span>
                          {#if profilesInUse.includes(name)}<span class="in-use" title="Profile has an open session">in use</span>{/if}
                          {#if tab.profileId === name}<span class="check">✓</span>{/if}
                        </button>
                        {#if name !== 'default'}
                          <button
                            class="profile-icon"
                            disabled={profilesInUse.includes(name)}
                            title={profilesInUse.includes(name) ? 'Profile has an open session' : 'Rename profile'}
                            aria-label="Rename profile"
                            on:click|stopPropagation={() => startProfileRename(name)}
                          >{@html ico.pencil}</button>
                          <button
                            class="profile-icon danger"
                            disabled={profilesInUse.includes(name)}
                            title={profilesInUse.includes(name) ? 'Profile has an open session' : 'Delete profile'}
                            aria-label="Delete profile"
                            on:click|stopPropagation={() => askDeleteProfile(name)}
                          >{@html ico.trash}</button>
                        {/if}
                      </div>
                    {/if}
                  {/each}

                  {#if profileError}<div class="profile-error">{profileError}</div>{/if}

                  <div class="profile-new">
                    <input
                      placeholder="New profile…"
                      bind:value={newProfileName}
                      on:click|stopPropagation
                      on:keydown={(e) => { if (e.key === 'Enter') submitNewProfile(tab.id); }}
                    />
                    <button disabled={profileBusy} on:click|stopPropagation={() => submitNewProfile(tab.id)} aria-label="Create profile">+</button>
                  </div>
                </div>
              {/if}
            </div>
          {/each}
          <button class="tabs-menu-new" on:click={() => { addTab(); closeTabsMenu(); }}>{@html ico.plus}<span>New tab</span></button>
        </div>
      {/if}
    </div>

    <span class="status conn-{connState}" title={connState === 'online' ? 'Connected' : terminalNotice || 'No server connection'}>
      <span class="conn-dot"></span>
      {#if connState !== 'online'}
        {connState === 'connecting' ? 'Connecting…' : terminalNotice || 'Offline'}
      {:else if sessionStates[activeTabId] !== 'ready'}
        {sessionStates[activeTabId] === 'error' ? 'Session error' : 'Starting session…'}
      {/if}
    </span>
    <button class="reload-btn" on:mousedown={keepFocus} on:click={reloadTerminal} aria-label="Reconnect" title="Reconnect">{@html ico.reload}</button>
    <div class="font-ctl">
      <button class="font-btn" on:mousedown={keepFocus} on:click={() => bumpFont(-1)} aria-label="Decrease text size">{@html ico.minus}</button>
      <span class="font-val">{fontSize}</span>
      <button class="font-btn" on:mousedown={keepFocus} on:click={() => bumpFont(1)} aria-label="Increase text size">{@html ico.plus}</button>
    </div>
  </div>

  <div class="terminal-body" bind:this={containerRoot}>
    {#if terminalNotice}<p class="terminal-notice">{terminalNotice}</p>{/if}
    <section class="mobile-terminal-console" aria-label="Mobile terminal">
      <pre class="mobile-terminal-output" aria-live="polite">{mobileOutput[activeTabId] || 'Waiting for terminal output…'}</pre>
      <form class="mobile-terminal-command" on:submit|preventDefault={submitMobileCommand}>
        <label for="mobile-terminal-command">Command</label>
        <input
          id="mobile-terminal-command"
          bind:value={mobileCommand}
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck={false}
          aria-label="Terminal command"
          disabled={sessionStates[activeTabId] !== 'ready'}
          placeholder={sessionStates[activeTabId] === 'ready' ? 'Type a command' : 'Starting terminal…'}
        />
        <button type="submit" disabled={sessionStates[activeTabId] !== 'ready'}>Run</button>
      </form>
    </section>
  </div>
  <output class="terminal-session-status" aria-live="polite">
    {sessionStates[activeTabId] === 'ready' ? 'Session ready' : 'Session is not ready yet'}
  </output>
  <pre
    class="terminal-accessible-output"
    role="log"
    aria-live="off"
    aria-busy={sessionStates[activeTabId] !== 'ready'}
    aria-label={`${activeTab?.name || 'Terminal'} output`}
  >{accessibleOutput[activeTabId] || ''}</pre>

  {#if showBar}
    <div class="kbd-bar" style="bottom:{kbOffset}px" use:measureBar>
      {#if barExpanded}
        <div class="kbd-row drawer">
          <button class="kbd-btn" on:mousedown={keepFocus} on:click={() => sendSpecialKey(KEYS.home)}>Home</button>
          <button class="kbd-btn" on:mousedown={keepFocus} on:click={() => sendSpecialKey(KEYS.end)}>End</button>
          <button class="kbd-btn" on:mousedown={keepFocus} on:click={() => sendSpecialKey(KEYS.pageUp)}>PgUp</button>
          <button class="kbd-btn" on:mousedown={keepFocus} on:click={() => sendSpecialKey(KEYS.pageDown)}>PgDn</button>
          <button class="kbd-btn ctl" on:mousedown={keepFocus} on:click={() => sendCtrlLetter('d')}>^D</button>
          <button class="kbd-btn ctl" on:mousedown={keepFocus} on:click={() => sendCtrlLetter('z')}>^Z</button>
          <button class="kbd-btn ctl" on:mousedown={keepFocus} on:click={() => sendCtrlLetter('l')}>^L</button>
          <button class="kbd-btn icon" on:mousedown={keepFocus} on:click={() => bumpFont(-1)} aria-label="Decrease text size">{@html ico.minus}</button>
          <button class="kbd-btn icon" on:mousedown={keepFocus} on:click={() => bumpFont(1)} aria-label="Increase text size">{@html ico.plus}</button>
        </div>

        <div class="kbd-row drawer">
          <div class="kbd-scroll">
            {#each snippets as snippet}
              <button class="kbd-btn snip" on:mousedown={keepFocus} on:click={() => useSnippet(snippet)}>{snippet.label}</button>
            {/each}
          </div>
          <button
            class="kbd-btn expand {snippetsOpen ? 'on' : ''}"
            on:mousedown={keepFocus}
            on:click={() => (snippetsOpen = !snippetsOpen)}
            aria-label="Manage snippets"
          >{@html ico.plus}</button>
        </div>

        {#if snippetsOpen}
          <div class="snippet-editor">
            {#each snippets as snippet, i}
              <div class="snippet-row">
                <span class="snippet-label">{snippet.label}</span>
                <code class="snippet-text">{snippet.text}</code>
                <button class="snippet-del" on:click={() => removeSnippet(i)} aria-label="Remove snippet">✕</button>
              </div>
            {/each}
            <div class="snippet-new">
              <input placeholder="Label" bind:value={newSnippetLabel} />
              <input
                placeholder="Command"
                bind:value={newSnippetText}
                on:keydown={(e) => { if (e.key === 'Enter') addSnippet(); }}
              />
              <button on:click={addSnippet} aria-label="Add snippet">+</button>
            </div>
          </div>
        {/if}
      {/if}

      <div class="kbd-row main">
        <div class="kbd-scroll">
          <button class="kbd-btn mod {ctrlActive ? 'active' : ''}" on:mousedown={keepFocus} on:click={toggleCtrl}>Ctrl</button>
          <button class="kbd-btn mod {altActive ? 'active' : ''}" on:mousedown={keepFocus} on:click={toggleAlt}>Alt</button>
          <button class="kbd-btn mod {shiftActive ? 'active' : ''}" on:mousedown={keepFocus} on:click={toggleShift}>Shift</button>
          <button class="kbd-btn" on:mousedown={keepFocus} on:click={() => sendSpecialKey(KEYS.tab)}>Tab</button>
          <button class="kbd-btn" on:mousedown={keepFocus} on:click={() => sendSpecialKey(KEYS.esc)}>Esc</button>
          <button class="kbd-btn icon" on:mousedown={keepFocus} on:click={() => sendSpecialKey(KEYS.left)} aria-label="Left">{@html ico.left}</button>
          <button class="kbd-btn icon" on:mousedown={keepFocus} on:click={() => sendSpecialKey(KEYS.up)} aria-label="Up">{@html ico.up}</button>
          <button class="kbd-btn icon" on:mousedown={keepFocus} on:click={() => sendSpecialKey(KEYS.down)} aria-label="Down">{@html ico.down}</button>
          <button class="kbd-btn icon" on:mousedown={keepFocus} on:click={() => sendSpecialKey(KEYS.right)} aria-label="Right">{@html ico.right}</button>
          <button class="kbd-btn ctl" on:mousedown={keepFocus} on:click={() => sendCtrlLetter('c')}>^C</button>
        </div>
        <button
          class="kbd-btn expand {barExpanded ? 'on' : ''}"
          on:mousedown={keepFocus}
          on:click={() => (barExpanded = !barExpanded)}
          aria-label="More keys"
        >{@html ico.chevron}</button>
      </div>
    </div>
  {/if}
</div>

<style>
  @import url('https://fonts.googleapis.com/css2?family=Ubuntu:ital,wght@0,300;0,400;0,500;0,700;1,400&family=Ubuntu+Mono:ital,wght@0,400;0,700;1,400&display=swap');

  .terminal-wrapper[data-theme="dark"] {
    --tk-bg: #111111;
    --tk-surface: #181818;
    --tk-surface-2: #1f1f1f;
    --tk-border: rgba(255, 255, 255, 0.09);
    --tk-border-hi: rgba(255, 255, 255, 0.16);
    --tk-text: #f5f5f5;
    --tk-muted: #888888;
    --tk-muted-2: rgba(136, 136, 136, 0.5);
    --tk-accent: #f5f5f5;
    --tk-on-accent: #111111;
    --tk-active-tab: #1e1e1e;
    --tk-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  }
  .terminal-wrapper[data-theme="light"] {
    --tk-bg: #ffffff;
    --tk-surface: #f5f5f5;
    --tk-surface-2: #ececec;
    --tk-border: rgba(0, 0, 0, 0.10);
    --tk-border-hi: rgba(0, 0, 0, 0.18);
    --tk-text: #1a1a1a;
    --tk-muted: #666666;
    --tk-muted-2: rgba(0, 0, 0, 0.4);
    --tk-accent: #111111;
    --tk-on-accent: #ffffff;
    --tk-active-tab: #ffffff;
    --tk-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  }

  :global(body) { margin: 0; overflow: hidden; }
  .terminal-wrapper {
    display: flex;
    flex-direction: column;
    height: var(--terminal-viewport-height, 100dvh);
    width: 100vw;
    box-sizing: border-box;
    /* Reserva a barra de atalhos; a altura vem do viewport visual quando o teclado
       móvel abre, para o xterm encolher junto com a área disponível. */
    transition: height 0.12s ease-out, padding-bottom 0.12s ease-out;
    background-color: var(--tk-bg);
    font-family: 'Ubuntu', system-ui, sans-serif;
    color: var(--tk-text);
    --tk-radius-md: 8px;
    --tk-radius-lg: 14px;
  }

  .tabs-header {
    display: flex;
    align-items: center;
    background-color: var(--tk-surface);
    border-bottom: 1px solid var(--tk-border);
    flex-shrink: 0;
  }
  /* Estado da conexão: um ponto sempre visível (verde quando ligado, sem texto) e o
     rótulo só quando há algo a dizer — reconectando ou offline. */
  .status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
    margin-right: 4px;
    color: var(--tk-muted);
    font-family: 'Ubuntu Mono', monospace;
    font-size: 12px;
  }
  .conn-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--tk-muted); }
  .status.conn-online .conn-dot { background: #3fbf6f; }
  .status.conn-connecting .conn-dot { background: #e0a02f; animation: conn-pulse 1.2s ease-in-out infinite; }
  .status.conn-offline .conn-dot { background: #e5484d; }
  @keyframes conn-pulse { 50% { opacity: 0.25; } }

  .reload-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    margin-right: 2px;
    background: none;
    border: none;
    border-radius: var(--tk-radius-md);
    color: var(--tk-muted);
    cursor: pointer;
  }
  .reload-btn:hover { background: var(--tk-surface-2); color: var(--tk-text); }
  .reload-btn:active :global(svg) { transform: rotate(-180deg); }
  .reload-btn :global(svg) { width: 15px; height: 15px; display: block; transition: transform 0.3s ease-out; }
  .terminal-body { flex-grow: 1; min-height: 0; position: relative; overflow: hidden; }
  .terminal-body :global(.xterm-pane) { position: absolute; inset: 0; padding: 8px; box-sizing: border-box; }
  .terminal-body :global(.xterm), .terminal-body :global(.xterm-screen) { width: 100%; height: 100%; }
  .mobile-terminal-console { display: none; }
  .terminal-notice {
    max-width: 360px;
    margin: 28px auto;
    padding: 10px 12px;
    color: var(--tk-muted);
    border: 1px solid var(--tk-border);
    border-radius: var(--tk-radius-md);
    font-size: 13px;
    line-height: 1.45;
    text-align: center;
  }
  .terminal-session-status, .terminal-accessible-output {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: pre-wrap;
    border: 0;
  }

  .profile-menu-title { color: var(--tk-muted); font-size: 11px; padding: 4px 8px 6px; text-transform: uppercase; letter-spacing: 0.5px; }
  .profile-option {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    background: none;
    border: none;
    color: var(--tk-text);
    text-align: left;
    padding: 7px 8px;
    border-radius: var(--tk-radius-md);
    cursor: pointer;
    font-size: 13px;
  }
  .profile-option:hover, .profile-option:active { background: var(--tk-surface); }
  .profile-option.selected { background: var(--tk-surface); outline: 1px solid var(--tk-border-hi); }
  .profile-option .dot { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto; }
  .profile-option .name { flex-grow: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .profile-option .check { color: var(--tk-text); font-size: 11px; }
  .profile-new { display: flex; gap: 6px; margin-top: 4px; padding-top: 6px; border-top: 1px solid var(--tk-border); }
  .profile-new input {
    flex-grow: 1;
    min-width: 0;
    background: var(--tk-bg);
    border: 1px solid var(--tk-border-hi);
    border-radius: var(--tk-radius-md);
    color: var(--tk-text);
    font-size: 13px;
    padding: 6px 8px;
  }
  .profile-new input:focus { outline: 2px solid var(--tk-accent); outline-offset: 1px; }

  /* ── CRUD de perfis ─────────────────────────────────────────────────────── */
  .profile-row { display: flex; align-items: center; gap: 2px; }
  .profile-row .profile-option { flex-grow: 1; min-width: 0; }
  .profile-option .in-use {
    flex: 0 0 auto;
    padding: 1px 5px;
    border: 1px solid var(--tk-border-hi);
    border-radius: 8px;
    color: var(--tk-muted);
    font-size: 10px;
  }
  .profile-icon {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    background: none;
    border: none;
    border-radius: var(--tk-radius-md);
    color: var(--tk-muted);
    cursor: pointer;
    font-size: 12px;
  }
  .profile-icon:hover:not(:disabled) { background: var(--tk-surface-2); color: var(--tk-text); }
  .profile-icon.danger:hover:not(:disabled) { color: #e5484d; }
  .profile-icon:disabled { opacity: 0.3; cursor: not-allowed; }
  .profile-icon :global(svg) { width: 13px; height: 13px; display: block; }
  .profile-edit-row { display: flex; align-items: center; gap: 6px; padding: 4px 8px; }
  .profile-edit-row .dot { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto; }
  .profile-edit-row input {
    flex-grow: 1;
    min-width: 0;
    background: var(--tk-bg);
    border: 1px solid var(--tk-border-hi);
    border-radius: var(--tk-radius-md);
    color: var(--tk-text);
    font-size: 13px;
    padding: 5px 8px;
  }
  .profile-edit-row input:focus { outline: 2px solid var(--tk-accent); outline-offset: 1px; }
  .profile-confirm {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 2px 0;
    padding: 8px;
    background: var(--tk-bg);
    border: 1px solid var(--tk-border-hi);
    border-radius: var(--tk-radius-md);
  }
  .profile-confirm-text { color: var(--tk-text); font-size: 12px; line-height: 1.4; }
  .profile-confirm-actions { display: flex; justify-content: flex-end; gap: 6px; }
  .profile-confirm-actions button {
    padding: 6px 12px;
    border-radius: var(--tk-radius-md);
    cursor: pointer;
    font-size: 12px;
  }
  .profile-confirm-actions .secondary { background: transparent; border: 1px solid var(--tk-border-hi); color: var(--tk-text); }
  .profile-confirm-actions .danger { background: #e5484d; border: 1px solid #e5484d; color: #ffffff; }
  .profile-confirm-actions button:disabled { opacity: 0.5; cursor: not-allowed; }
  .profile-error { margin: 4px 8px 0; color: #e5484d; font-size: 11px; line-height: 1.4; }
  .profile-new button:disabled { opacity: 0.5; cursor: not-allowed; }
  .profile-new button {
    flex: 0 0 auto;
    width: 28px;
    background: var(--tk-accent);
    border: none;
    border-radius: var(--tk-radius-md);
    color: var(--tk-on-accent);
    font-size: 15px;
    cursor: pointer;
  }

  /* ── Widget de abas ─────────────────────────────────────────────────────── */
  .tabs-menu-wrap { position: relative; display: flex; align-items: center; }
  .tabs-menu-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: 60vw;
    height: 36px;
    padding: 0 10px;
    margin: 5px 6px;
    background: var(--tk-surface-2);
    border: 1px solid var(--tk-border);
    border-radius: var(--tk-radius-md);
    color: var(--tk-text);
    cursor: pointer;
    font-size: 13px;
  }
  .tabs-menu-btn:hover, .tabs-menu-btn.on { background: var(--tk-surface); border-color: var(--tk-border-hi); }
  .profile-quick-btn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    max-width: 34vw;
    height: 32px;
    margin: 5px 2px;
    padding: 0 9px;
    overflow: hidden;
    background: transparent;
    border: 1px solid var(--tk-border);
    border-radius: 999px;
    color: var(--tk-muted);
    cursor: pointer;
    font-size: 11px;
  }
  .profile-quick-btn:hover, .profile-quick-btn.on { background: var(--tk-surface); color: var(--tk-text); border-color: var(--tk-border-hi); }
  .profile-quick-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tabs-menu-ico { display: inline-flex; color: var(--tk-muted); }
  .tabs-menu-ico :global(svg) { width: 17px; height: 17px; display: block; }
  .tabs-menu-dot { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto; }
  .tabs-menu-cur { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
  .tabs-menu-count {
    flex: 0 0 auto;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--tk-bg);
    border: 1px solid var(--tk-border);
    border-radius: 9px;
    color: var(--tk-muted);
    font-family: 'Ubuntu Mono', monospace;
    font-size: 11px;
  }
  .tabs-menu-chev { display: inline-flex; color: var(--tk-muted); }
  .tabs-menu-chev :global(svg) { width: 15px; height: 15px; display: block; transition: transform 0.2s ease-out; transform: rotate(180deg); }
  .tabs-menu-chev.on :global(svg) { transform: rotate(0deg); }

  .row-dot {
    flex: 0 0 auto;
    width: 14px;
    height: 14px;
    margin-left: 4px;
    padding: 0;
    border-radius: 50%;
    border: 1px solid var(--tk-border-hi);
    cursor: pointer;
  }
  .row-dot.static { cursor: default; width: 10px; height: 10px; margin-left: 6px; }

  .profile-inline {
    flex-basis: 100%;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 2px 4px 4px;
    padding: 6px;
    background: var(--tk-surface);
    border: 1px solid var(--tk-border);
    border-radius: var(--tk-radius-md);
    cursor: default;
  }
  .profile-inline .profile-option:hover, .profile-inline .profile-option:active { background: var(--tk-surface-2); }
  .profile-inline .profile-option.selected { background: var(--tk-surface-2); }
  .tabs-menu-overlay { position: fixed; inset: 0; z-index: 90; }
  .tabs-menu {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 91;
    width: min(320px, calc(100vw - 12px));
    min-width: 0;
    max-width: calc(100vw - 12px);
    box-sizing: border-box;
    max-height: 70dvh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
    background: var(--tk-surface-2);
    border: 1px solid var(--tk-border-hi);
    border-radius: var(--tk-radius-lg);
    box-shadow: var(--tk-shadow);
    padding: 6px;
    font-size: 13px;
    cursor: default;
  }
  .tabs-menu-title { color: var(--tk-muted); font-size: 11px; padding: 4px 8px 6px; text-transform: uppercase; letter-spacing: 0.5px; }
  .tab-row { display: flex; align-items: center; flex-wrap: wrap; gap: 2px; min-width: 0; border-radius: var(--tk-radius-md); }
  .tab-row.active { background: var(--tk-surface); outline: 1px solid var(--tk-border-hi); }
  .tab-pick {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-grow: 1;
    min-width: 0;
    background: none;
    border: none;
    color: var(--tk-text);
    text-align: left;
    padding: 8px;
    border-radius: var(--tk-radius-md);
    cursor: pointer;
    font-size: 13px;
  }
  .tab-pick:hover, .tab-pick:active { background: var(--tk-surface); }
  .tab-row .dot { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto; }
  .tab-pick .name { flex-grow: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tab-pick .here { color: var(--tk-accent); font-size: 9px; flex: 0 0 auto; }
  .tab-row-icon {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    padding: 0;
    margin-right: 0;
    background: none;
    border: none;
    border-radius: var(--tk-radius-md);
    color: var(--tk-muted);
    cursor: pointer;
    font-size: 14px;
  }
  .tab-row-icon:hover, .tab-row-icon:active { background: var(--tk-surface); color: var(--tk-text); }
  .tab-row-icon.danger:hover, .tab-row-icon.danger:active { color: #e5484d; }
  .tab-row-icon :global(svg) { width: 15px; height: 15px; display: block; }
  .tab-rename-input {
    flex-grow: 1;
    min-width: 0;
    margin-left: 2px;
    background: var(--tk-bg);
    border: 1px solid var(--tk-border-hi);
    border-radius: var(--tk-radius-md);
    color: var(--tk-text);
    font-size: 13px;
    padding: 6px 8px;
    font-family: 'Ubuntu', system-ui, sans-serif;
  }
  .tab-rename-input:focus { outline: 2px solid var(--tk-accent); outline-offset: 1px; }
  .tabs-menu-new {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    margin-top: 4px;
    padding: 8px;
    background: none;
    border: none;
    border-top: 1px solid var(--tk-border);
    border-radius: 0 0 var(--tk-radius-md) var(--tk-radius-md);
    color: var(--tk-muted);
    text-align: left;
    cursor: pointer;
    font-size: 13px;
  }
  .tabs-menu-new:hover { color: var(--tk-text); }
  .tabs-menu-new :global(svg) { width: 15px; height: 15px; display: block; flex: 0 0 auto; }

  .kbd-bar {
    position: fixed;
    left: 0;
    right: 0;
    z-index: 200;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px 8px calc(6px + env(safe-area-inset-bottom, 0px));
    background: var(--tk-surface);
    border-top: 1px solid var(--tk-border);
    box-shadow: var(--tk-shadow);
    user-select: none;
    transition: bottom 0.12s ease-out;
  }
  .kbd-row { display: flex; align-items: center; gap: 6px; }
  .kbd-row.main { flex-wrap: nowrap; }
  .kbd-row.drawer { flex-wrap: wrap; }
  .kbd-scroll {
    display: flex;
    gap: 6px;
    flex: 1;
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }
  .kbd-scroll::-webkit-scrollbar { display: none; }

  .kbd-btn {
    flex: 0 0 auto;
    min-width: 40px;
    height: 38px;
    padding: 0 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--tk-surface-2);
    color: var(--tk-text);
    border: 1px solid var(--tk-border);
    border-radius: var(--tk-radius-md);
    font-family: 'Ubuntu', system-ui, sans-serif;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: transform 0.08s ease-out, background 0.2s ease-out;
  }
  .kbd-btn:active { transform: translateY(1px); background: var(--tk-border-hi); }
  .kbd-btn.icon { min-width: 40px; padding: 0; }
  .kbd-btn.icon :global(svg) { width: 18px; height: 18px; display: block; }
  .kbd-btn.ctl { font-family: 'Ubuntu Mono', monospace; color: var(--tk-muted); }

  .kbd-btn.mod.active {
    background: var(--tk-accent);
    border-color: var(--tk-accent);
    color: var(--tk-on-accent);
  }

  .kbd-btn.expand { flex: 0 0 auto; min-width: 38px; padding: 0; color: var(--tk-muted); }
  .kbd-btn.expand :global(svg) { width: 18px; height: 18px; display: block; transition: transform 0.2s ease-out; }
  .kbd-btn.expand.on :global(svg) { transform: rotate(180deg); }

  /* ── Font size control ──────────────────────────────────────────────────── */
  .font-ctl { display: flex; align-items: center; gap: 2px; margin-left: auto; padding-right: 8px; }
  .font-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    background: none;
    border: none;
    border-radius: var(--tk-radius-md);
    color: var(--tk-muted);
    cursor: pointer;
  }
  .font-btn:hover { background: var(--tk-surface-2); color: var(--tk-text); }
  .font-btn :global(svg) { width: 14px; height: 14px; display: block; }
  .font-val {
    min-width: 18px;
    text-align: center;
    color: var(--tk-muted);
    font-family: 'Ubuntu Mono', monospace;
    font-size: 11px;
  }
  /* O status e o reload já reivindicaram o espaço livre à esquerda; sem isto o
     controle de fonte tentaria reivindicar de novo e colaria nos vizinhos. */
  .reload-btn + .font-ctl { margin-left: 0; }

  /* ── Snippets ───────────────────────────────────────────────────────────── */
  .kbd-btn.snip { font-family: 'Ubuntu Mono', monospace; font-size: 12px; color: var(--tk-muted); }
  .snippet-editor {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 40dvh;
    overflow-y: auto;
    padding: 6px;
    background: var(--tk-surface-2);
    border: 1px solid var(--tk-border);
    border-radius: var(--tk-radius-md);
  }
  .snippet-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .snippet-label { flex: 0 0 auto; max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--tk-text); }
  .snippet-text {
    flex-grow: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--tk-muted);
    font-family: 'Ubuntu Mono', monospace;
  }
  .snippet-del { flex: 0 0 auto; background: none; border: none; color: var(--tk-muted); cursor: pointer; padding: 2px 5px; line-height: 1; }
  .snippet-new { display: flex; gap: 6px; padding-top: 6px; border-top: 1px solid var(--tk-border); }
  .snippet-new input {
    flex-grow: 1;
    min-width: 0;
    background: var(--tk-bg);
    border: 1px solid var(--tk-border-hi);
    border-radius: var(--tk-radius-md);
    color: var(--tk-text);
    font-size: 13px;
    padding: 6px 8px;
  }
  .snippet-new input:focus { outline: 2px solid var(--tk-accent); outline-offset: 1px; }
  .snippet-new button {
    flex: 0 0 auto;
    width: 28px;
    background: var(--tk-accent);
    border: none;
    border-radius: var(--tk-radius-md);
    color: var(--tk-on-accent);
    font-size: 15px;
    cursor: pointer;
  }

  /* Desktop / fine-pointer: the bar is hidden (physical keyboard already has these keys). */
  @media (pointer: fine) and (min-width: 821px) {
    .kbd-bar { display: none; }
  }

  /* A superfície interativa do xterm também precisa permanecer visível no mobile. */
  @media (pointer: coarse), (max-width: 820px) {
    .mobile-terminal-console {
      position: absolute;
      inset: 0;
      z-index: 1;
      display: none;
      flex-direction: column;
      background: var(--tk-bg);
      padding: 8px;
      box-sizing: border-box;
      gap: 8px;
    }
    .mobile-terminal-output {
      flex: 1 1 auto;
      min-height: 0;
      margin: 0;
      overflow: auto;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      color: var(--tk-text);
      font: 14px/1.4 'Ubuntu Mono', Consolas, monospace;
      -webkit-overflow-scrolling: touch;
    }
    .mobile-terminal-command { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
    .mobile-terminal-command label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); }
    .mobile-terminal-command input {
      min-width: 0;
      flex: 1 1 auto;
      height: 38px;
      box-sizing: border-box;
      border: 1px solid var(--tk-border-hi);
      border-radius: var(--tk-radius-md);
      background: var(--tk-surface-2);
      color: var(--tk-text);
      padding: 0 10px;
      font: 14px 'Ubuntu Mono', Consolas, monospace;
    }
    .mobile-terminal-command button {
      flex: 0 0 auto;
      height: 38px;
      border: 1px solid var(--tk-border-hi);
      border-radius: var(--tk-radius-md);
      background: var(--tk-accent);
      color: var(--tk-on-accent);
      padding: 0 12px;
      font: 600 13px 'Ubuntu', system-ui, sans-serif;
    }
    .mobile-terminal-command input:disabled, .mobile-terminal-command button:disabled { opacity: .55; }
  }
</style>
