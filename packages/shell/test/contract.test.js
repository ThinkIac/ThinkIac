import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { readPinnedApps } from '../views/lib/pinned_apps.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('contrato do ThinkIac Shell', () => {
  test('preferência legada inválida não interrompe a hidratação', () => {
    const values = new Map([['aura-pinned-packages', '{invalid-json']])
    const storage = {
      getItem: (key) => values.get(key) ?? null,
      removeItem: (key) => values.delete(key),
    }
    expect(readPinnedApps(storage)).toEqual([])
    expect(values.has('aura-pinned-packages')).toBe(false)
    expect(readPinnedApps({ getItem: () => JSON.stringify(['Shell', null, 3, 'Terminal']) })).toEqual(['Shell', 'Terminal'])
  })
  test('possui superfície floating-shell explícita e compacta', () => {
    const shell = read('../views/Index.svelte')
    expect(shell).toContain('surface === "floating-shell"')
    expect(shell).toMatch(/\{#if !floatingShell\}\s*<Sidebar/)
    expect(shell).toContain('class:floating-shell={floatingShell}')
  })
  test('declara um ícone Sigma vetorial, sem raster, para o catálogo Aura System', () => {
    const manifest = JSON.parse(read('../package.json')).manifest
    expect(manifest.icon).toBe('icon.svg')
    expect(manifest.icon).not.toMatch(/\.(png|jpe?g)$/i)
    const icon = read('../icon.svg')
    expect(icon).toContain('<svg')
    expect(icon).toContain('fill="#050505"')
    expect(icon).toContain('>Σ</text>')
  })
  test('replica a composição visual da Aurora sem importar suas views', () => {
    const shell = read('../views/Index.svelte')
    for (const component of ['Sidebar', 'MessageList', 'Canvas', 'SessionTabs', 'InputBar']) expect(shell).toContain(`<${component}`)
    expect(shell).not.toContain('packages/aurora')
    expect(shell).not.toContain('../../../agent/')
  })
  test('o Shell não conhece o transporte nem as rotas do harness Aurora', () => {
    const shell = read('../views/Index.svelte'), input = read('../views/InputBar.svelte'), api = read('../views/api.js')
    expect(shell).not.toContain('chatSocket'); expect(shell).not.toContain('endpointFor'); expect(input).not.toContain('endpointFor')
    expect(shell).not.toContain('/agent/provider'); expect(shell).not.toContain('/agent/session'); expect(shell).toContain('agentRuntime')
    expect(api).toContain('agentRuntime.request'); expect(api).toContain('route_not_found'); expect(api).toContain('runtime_or_provider_unavailable'); expect(api).toContain('network_unavailable')
  })
  test('somente o adapter Agent conhece suas rotas e a chave legada', () => {
    const catalog = read('../views/agents/catalog.js'), adapter = read('../views/agents/adapters/agent.js')
    expect(catalog).not.toContain("routeBase: '/aurora'"); expect(catalog).not.toContain('endpointFor'); expect(adapter).toContain("const ROUTE_BASE = '/agent'")
  })
  test('a InputBar usa Agent sem seletor e exibe resumo das escolhas', () => {
    const input = read('../views/InputBar.svelte')
    expect(input).not.toContain('AgentSelector'); expect(input).not.toContain('on:selectAgent'); expect(input).toContain('class="selection-inline"'); expect(input).toContain('class="selection-footer"'); expect(input).not.toContain('Session controls'); expect(input).toContain('aria-label="Development settings"')
  })
  test('remove a camada modal das configurações quando a gaveta está fechada', () => { const input = read('../views/InputBar.svelte'); expect(input).toContain('{#if optionsHydrated && stateOpen}'); expect(input).not.toContain('hidden={!stateOpen}') })
  test('normaliza o envelope de rota ao carregar e salvar o modelo da sessão', () => { const input = read('../views/InputBar.svelte'); expect(input).toContain('function unwrapRouteData(payload)'); expect(input).toContain('unwrapRouteData(await response.json())') })
  test('o UI bus é neutro e mantém compatibilidade com widgets Aurora', () => { const bus = read('../views/lib/bus.js'); expect(bus).toContain('thinkiac-shell'); expect(bus).toContain('"aurora"'); expect(bus).toContain('window.$thinkiac') })
  test('mantém tema canônico e viewport dinâmica', () => { const shell = read('../views/Index.svelte'); expect(shell).toContain('data-theme={theme}'); for (const token of ['--tk-bg', '--tk-surface', '--tk-border', '--tk-text', '--tk-accent', '--tk-font']) expect(shell).toContain(token); expect(shell).toContain('100dvh'); expect(shell).not.toContain('100vh') })
  test('usa o fundo canônico do tema em toda a raiz do sidebar', () => { const shell = read('../views/Index.svelte'); expect(shell).toContain('--rail-bg: var(--bg);'); expect(shell).not.toContain('--rail-bg: #0a0b0c;') })
  test('usa a ponte nativa, não appId, para evitar insets duplicados', () => { const shell = read('../views/Index.svelte'); expect(shell).toContain("--safe-top: {nativeApp ? '0px'"); expect(shell).not.toContain("--safe-top: {appId ? '0px'") })
  test('mantém o evento legado do Sidebar ligado ao launcher nativo existente', () => { const shell = read('../views/Index.svelte'); expect(shell).toContain('function returnToLauncher()'); expect(shell).toContain('on:returnToModeChoice={returnToLauncher}'); expect(shell).not.toContain('on:returnToModeChoice={returnToModeChoice}') })
  test('mantém a estrutura crítica das gavetas mesmo sem utilitários', () => { const sidebar = read('../views/Sidebar.svelte'); expect(sidebar).toContain('class="drawer-scroll'); expect(sidebar).toContain('height: 100dvh'); expect(sidebar).toContain('min-height: 0'); expect(sidebar).toContain('width: 44px'); expect(sidebar).toContain('height: 44px') })
  test('limita resize e recolhimento à Sidebar desktop', () => { const sidebar = read('../views/Sidebar.svelte'); expect(sidebar).toContain('const SIDEBAR_MIN_WIDTH = 244'); expect(sidebar).toContain('const SIDEBAR_DEFAULT_WIDTH = 280'); expect(sidebar).toContain('const SIDEBAR_EDGE_WIDTH = 28'); expect(sidebar).toContain('window.innerWidth * 0.25'); expect(sidebar).toContain('setPointerCapture?.(pointerId)'); expect(sidebar).toContain('lostpointercapture'); expect(sidebar).toContain('window.addEventListener("blur", end)'); expect(sidebar).toContain('class="sidebar-resize-handle"'); expect(sidebar).toContain('class="sidebar-toggle"'); expect(sidebar.indexOf('class="sidebar-resize-handle"')).toBeGreaterThan(sidebar.indexOf('{:else}\n    <!-- ══ DESKTOP')); expect(sidebar).not.toContain('Enter fullscreen') })
  test('filtra passagens rápidas na borda, preserva uma zona neutra na seta e fecha após a saída', () => { const sidebar = read('../views/Sidebar.svelte'); const desktop = sidebar.slice(sidebar.indexOf('<!-- ══ DESKTOP')); expect(desktop).toContain('{#if collapsed}'); expect(desktop).toContain('sidebar-edge-trigger-top'); expect(desktop).toContain('sidebar-edge-trigger-bottom'); expect(desktop).toContain('on:mouseenter={showHoverPreview}'); expect(desktop).toContain('on:mouseleave={cancelHoverPreviewOpen}'); expect(desktop).toContain('on:mouseleave={handleHoverPreviewLeave}'); expect(desktop).toContain("hoverPreview ? `${sidebarWidth === null ? SIDEBAR_DEFAULT_WIDTH : sidebarWidth}px` : '0px'"); expect(sidebar).toContain('const HOVER_OPEN_DELAY = 140;'); expect(sidebar).toContain('const HOVER_CLOSE_DELAY = 120;'); expect(sidebar).toContain('hoverOpenTimer = setTimeout'); expect(sidebar).toContain('hoverCloseTimer = setTimeout'); expect(sidebar).not.toContain('hoverCloseArmed'); expect(desktop).toContain('class:preview-hidden={hoverPreview}'); expect(desktop).toContain('collapsed ? openSidebar : collapseSidebar'); expect(desktop).toContain('border: 0'); expect(desktop).toContain('background: transparent') })
  test('mantém no cabeçalho somente engrenagem e ações de edição', () => { const sidebar = read('../views/Sidebar.svelte'); expect(sidebar).toContain('Desktop/Shell shortcuts reserved'); expect(sidebar).not.toContain('aria-label="Open Desktop"'); expect(sidebar).not.toContain('aria-label="Abrir interno"') })
  test('Cloud e Mobile compilam os utilitários Tailwind da Shell', () => {
    for (const path of ['../../../index.js', '../../../../mobile/runtime-template/server.cjs']) { const host = read(path); expect(host).toMatch(/tailwind:\s*true/); expect(host).toMatch(/precompileCss:\s*true/) }
  })
  test('mostra o loading inicial apenas até o primeiro frame útil', () => { const shell = read('../views/Index.svelte'); expect(shell).toContain('let showLoading = true;'); const mounted = shell.slice(shell.indexOf('onMount(() => {')); expect(mounted).toContain('requestAnimationFrame(() => {\n            showLoading = false;') })
  test('oferece loading global por evento e o reutiliza na reconexão', () => { const shell = read('../views/Index.svelte'); const loading = read('../views/components/GlobalLoading.svelte'); expect(shell).toContain('busOn("shell:loading"'); expect(shell).toContain('busOn("shell:reload"'); expect(shell).toContain('globalLoading.active || !isOnline'); expect(shell).toContain('120000'); expect(loading).toContain('<SigmaLoader />'); expect(loading).not.toContain('phrase-window'); expect(loading).not.toContain('phraseIndex'); expect(loading).toContain('background: var(--bg);') })
  test('envia o tema canônico do Shell para widgets em iframe', () => { const widget = read('../views/components/PackageWidget.svelte'); const menu = read('../views/MenuList.svelte'); expect(widget).toContain('type: "shell:context"'); expect(widget).toContain('on:load={sendShellContext}'); expect(menu).toContain('flat {theme}') })
  test('links externos de widgets escapam do sandbox ao abrir outra aba', () => { const widget = read('../views/components/PackageWidget.svelte'); expect(widget).toMatch(/sandbox=\"[^\"]*allow-popups[^\"]*allow-popups-to-escape-sandbox[^\"]*\"/) })
  test('não pinta o layout desktop do SSR antes da hidratação em mobile', () => { const shell = read('../views/Index.svelte'); expect(shell).toContain('let layoutReady = false;'); expect(shell).toContain('layoutReady = true;'); expect(shell).toContain('class:layout-ready={layoutReady}'); expect(shell).toContain('@media (max-width: 767px), (pointer: coarse)'); expect(shell).toContain('.shell:not(.layout-ready)') })
  test('mantém a composição inicial do chat no Android', () => {
    const shell = read('../views/Index.svelte')
    expect(shell).toContain('function maybeLoadRecentSessions() {\n        if (recentSessionsRequested) return;')
    expect(shell).toContain('class:initial={history.length === 0}')
    expect(shell).toContain('initial={history.length === 0}')
    expect(shell).toContain('{#if !isMobile && history.length === 0 && (recentSessionsLoading || visibleRecentSessions.length)}')
  })
  test('atualiza o chat apenas pelo dropdown compacto', () => { const shell = read('../views/Index.svelte'); const input = read('../views/InputBar.svelte'); const messages = read('../views/MessageList.svelte'); expect(shell).toContain('async function refreshMobileChat()'); expect(shell).toContain('on:click={refreshMobileChat}'); expect(shell).toContain('aria-label="Refresh"'); expect(shell).not.toContain('handlePullRefresh'); expect(shell).not.toContain('app-refresh-rail'); expect(shell).not.toContain('APP_REFRESH_THRESHOLD'); expect(input).not.toContain('REFRESH_PULL_THRESHOLD'); expect(messages).not.toContain('function startBottomPull') })
  test('oferece quatro ações compactas iguais em chat e app', () => { const shell = read('../views/Index.svelte'); expect(shell).toContain('class="mtb-menu-actions"'); expect(shell).toContain('on:click={refreshMobileApp}'); expect(shell).toContain('on:click={enterMobileFullscreen}'); expect(shell).toContain('aria-label="Full Screen"'); expect(shell).toContain('aria-label="Information"'); expect(shell).toContain('aria-label="Close"'); expect(shell).toContain('appRefreshingMap = { ...appRefreshingMap, [activeTab]: true };') })
  test('abre informações completas em inglês com dados canônicos do pacote', () => { const shell = read('../views/Index.svelte'); const catalog = read('../runtime/system/apps/index.js'); expect(shell).toContain('on:click={openAppInfo}'); expect(shell).toContain('<ModalSheet'); expect(shell).toContain('Package information'); expect(shell).toContain('activeAppInfo.iconDarkSvg'); expect(shell).toContain('activeAppInitials'); expect(shell).toContain('class="app-info-details"'); expect(shell).toContain('internal compatibility key'); expect(shell).toContain('label: "Repository"'); expect(shell).toContain('relativeUrl'); expect(catalog).toContain('version: pkg.package.version || null'); expect(catalog).toContain('view: viewName'); expect(catalog).toContain('entrypoint: typeof pkg.package.main'); expect(catalog).toContain('dependencyCount:'); expect(catalog).toContain('function packageRepository') })
  test('remove controles de privacidade e abertura externa, centralizando os painéis de informação', () => { const shell = read('../views/Index.svelte'); const sheet = read('../../ui-dialogs/views/components/ModalSheet.svelte'); expect(shell).not.toContain('id="app-info-visibility"'); expect(shell).not.toContain('saveAppVisibility'); expect(shell).not.toContain('Copy full public URL'); expect(shell).not.toContain('app-info-public-link'); expect(shell).not.toContain('label: "Visibility"'); expect(shell).not.toContain('Open externally'); expect(shell).not.toContain('openAppExternally'); expect(shell).toContain('<ModalSheet open={appInfoOpen} centered'); expect(shell).toContain('<ModalSheet open={chatInfoOpen} centered'); expect(sheet).toContain('export let centered = false;'); expect(sheet).toContain('.modal-sheet-backdrop.centered { align-items:center;'); expect(shell).toContain('function openChatInfo()'); expect(shell).toContain('Total usage'); expect(shell).toContain('chatInfoTotalTokens') })
  test('recolhe o cabeçalho mobile mantendo as setas laterais, sem gesto de atualizar', () => { const shell = read('../views/Index.svelte'); expect(shell).toContain('let mobileHeaderCollapsed = false;'); expect(shell).toContain('class="mobile-fullscreen-center"'); expect(shell).toContain('class="mobile-topbar-toggle"'); expect(shell).toContain('class="mobile-fullscreen-sidebar-controls"'); expect(shell).toContain('class="mobile-fullscreen-sidebar-toggle mobile-fullscreen-sidebar-toggle-left"'); expect(shell).toContain('class="mobile-fullscreen-sidebar-toggle mobile-fullscreen-sidebar-toggle-right"'); expect(shell).toContain('class:open={mobilePanel === "left"}'); expect(shell).toContain('class:open={mobilePanel === "right"}'); expect(shell).toContain('on:click={openLeft}'); expect(shell).toContain('on:click={openRight}'); expect(shell).toContain('on:click={closePanel}'); expect(shell).not.toContain('mobile-fullscreen-actions'); expect(shell).not.toContain('mobile-fullscreen-edge'); expect(shell).not.toContain('class:fullscreen={mobileHeaderCollapsed}'); expect(shell).toContain('inert={mobileHeaderCollapsed}'); expect(shell).not.toContain('startChatRefresh'); expect(shell).not.toContain('aria-label="Puxe para baixo para atualizar"') })
  test('mantém voltar, avançar e fechar no cabeçalho e não no fullscreen', () => { const shell = read('../views/Index.svelte'); expect(shell).toContain('let mobileNavigation = [];'); expect(shell).toContain('function recordMobileNavigation(next)'); expect(shell).toContain('async function goBackMobile()'); expect(shell).not.toContain('function goBackFromMobileFullscreen()'); expect(shell).toContain('on:click={goForwardMobile}'); expect(shell).toContain('on:click={closeActiveMobileTab}'); expect(shell).toContain('chatMenuMessage || sessionId'); expect(shell).toContain('on:click={copyActiveSessionId}'); expect(shell).toContain('function openArtifactLibrary()'); expect(shell).toContain('if (!chatFeatureAvailability.artifacts) return;'); expect(shell).toContain('on:click={openArtifactLibrary}'); expect(shell).toContain('url: `/view/artifacts/Index?sessionId=${filter}`'); expect(shell).toContain('const artifactTabId = `artifacts:${targetSessionId}`'); expect(shell).toContain('appTabs.some((tab) => tab.id === artifactTabId)'); expect(shell).toContain('`${artifactTabId}:${Date.now()}`'); expect(shell).toContain('{#if chatFeatureAvailability.artifacts}'); expect(shell).toContain('>Artifacts<'); expect(shell).not.toContain('openConversationArtifacts'); expect(shell).toContain('aria-label="Refresh"'); expect(shell).toContain('on:click={refreshMobileChat}') })
  test('oferece o Bag no menu mobile somente com o pacote disponível e exibe um estado vazio seguro', () => { const shell = read('../views/Index.svelte'); const routes = read('../runtime/system/apps/routes.js'); expect(shell).toContain('async function openBag()'); expect(shell).toContain('if (!chatFeatureAvailability.bags) return;'); expect(shell).toContain('on:click={openBag}'); expect(shell).toContain('{#if chatFeatureAvailability.bags}'); expect(shell).toContain('api(`/status/${encodeURIComponent(targetSessionId)}`, "GET", null, "bags"'); expect(shell).toContain('<ModalSheet open={bagSheetOpen} centered label="Session bag"'); expect(shell).toContain('No plan has been created for this conversation.'); expect(shell).toContain('loadChatFeatureAvailability();'); expect(shell).toContain('/apps/availability?packages=artifacts,bags'); expect(routes).toContain('@register_router apps/availability') })
  test('artefatos abrem em aba filtrada somente após a disponibilidade ser confirmada', () => { const shell = read('../views/Index.svelte'); expect(shell).toContain('chatFeatureAvailability.artifacts'); expect(shell).toContain('/view/artifacts/Index?sessionId=${filter}') })
  test('não expõe trace de execução no menu compacto', () => { const shell = read('../views/Index.svelte'); expect(shell).not.toContain('function openExecutionTrace()'); expect(shell).not.toContain('>Execution trace<') })
  test('mantém a linha discreta e a sombra do cabeçalho dentro do dock sem cobrir o chat', () => { const shell = read('../views/Index.svelte'); expect(shell).toMatch(/\.mobile-topbar\s*\{[^}]*border-bottom:\s*1px solid color-mix\(in srgb, var\(--border\) 52%, transparent\);/s); expect(shell).toContain('.mobile-topbar-dock::after'); expect(shell).toContain('.mobile-topbar-dock.collapsed::after'); expect(shell).not.toContain('.chat-panel::before'); })
  test('abre um chat vazio sem introdução ou tour automático', () => { const shell = read('../views/Index.svelte'); expect(shell).not.toContain('createShellWelcomeMessage'); expect(shell).not.toContain('showFirstVisitWelcome'); expect(shell).not.toContain('SHELL_ONBOARDING_START_EVENT'); expect(shell).not.toContain('onboarding-tour') })
  test('oferece o Desktop no catálogo mobile quando o manifesto o declara compatível', () => { const apps = read('../views/Apps.svelte'); const desktopManifest = JSON.parse(read('../../desktop/package.json')).manifest; expect(desktopManifest.mobile).toBe(true); expect(apps).toContain('.filter(a => a?.mobileSupported !== false || !mobileViewport)') })
  test('persiste imediatamente a seleção e o fechamento de abas', () => { const shell = read('../views/Index.svelte'); expect(shell).toContain('activeIsApp,'); expect(shell).toContain('if (state.activeIsApp !== undefined) activeIsApp = state.activeIsApp;'); expect(shell).toContain('activeIsApp = isApp;\n        if (!isApp) sessionId = sid;\n        fullSaveSessionState();'); expect(shell).toContain('activeIsApp = next.activeIsApp;\n        fullSaveSessionState();') })
})
describe('contrato de entrega do chat', () => { test('preserva o eco otimista durante reconexão e exige aceite explícito', () => { const shell = read('../views/Index.svelte'); expect(shell).toMatch(/const hasLocalEcho = cached\?\.some/); expect(shell).toMatch(/\(staleStreaming \|\| loadingMap\[sid\]\) && !hasLocalEcho/); expect(shell).toMatch(/if \(!cached\?\.length\)/); expect(shell).toMatch(/!r\?\.accepted && !r\?\.queued && !r\?\.forwarded/) }) })

describe('controles externos do sidebar desktop', () => {
  test('mantém a seta externa acima da área principal', () => {
    const sidebar = read('../views/Sidebar.svelte')
    const shell = read('../views/Index.svelte')
    expect(sidebar).toMatch(/\.desktop-sidebar\s*\{[^}]*z-index:\s*30;/s)
    expect(sidebar).toMatch(/\.sidebar-toggle\s*\{[^}]*position:\s*fixed;/s)
    expect(shell).toMatch(/\.main-area\s*\{[^}]*z-index:\s*20;/s)
  })
})
