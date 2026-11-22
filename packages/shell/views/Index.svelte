<script>
    import ComposerArea from "./components/shell/ComposerArea.svelte";
    import { createShellControllers } from './controllers/index.js';

    import { createHistoryMessages } from "./lib/history_messages.js";
    import { retryTurnInput } from './lib/retry-turn.js';
    import { onMount, tick } from "svelte";
    import Dialogs from "../../ui-dialogs/views/components/Dialogs.svelte";
    import ModalSheet from "../../ui-dialogs/views/components/ModalSheet.svelte";
    import { FILE_MANAGER_PREVIEW_EVENT, filePreviewUrl } from "../../file-manager/views/lib/protocol.js";

    import Sidebar from "./Sidebar.svelte";
    import MessageList from "./MessageList.svelte";
    import Canvas from "./Canvas.svelte";
    import SessionTabs from "./SessionTabs.svelte";

    import AppSurface from "./components/shell/AppSurface.svelte";
    import GlobalLoading from "./components/GlobalLoading.svelte";
    import ActivitySlot from "./components/ActivitySlot.svelte";
    import NtfyInbox from "./components/NtfyInbox.svelte";

    import { api } from "./api";
    import {
        historyStateWithMobileDestination,
        mobileDestinationFromHistoryState,
    } from "./lib/mobile_browser_history.js";
    import {
        $ as busEmit,
        on as busOn,
        emitLocal as busEmitLocal,
        setServerForwarder,
        createGestureRouter,
        createIframeGestureBridge,
        installNativeGestureBridge,
        installEdgeSwipeDetector,
    } from "./lib/bus.js";
    import { bootstrapPackageWidgets } from "./lib/widget_bootstrap.js";
    import { bootstrapMessageActions } from "./lib/message_actions.js";
    import { bootstrapMenuItems } from "./lib/menu_bootstrap.js";
    import { headerActionMessage, headerActionsForView } from "./lib/header_actions.js";
    import { bootstrapBackgroundViews, publishBackgroundContext, disposeBackgroundViews } from "./lib/background_bootstrap.js";
    import { createNewTopicWorkspace } from "./lib/new_topic.js";
    import { closeAllChatTabs, closeChatTab } from "./lib/chat_tabs.js";
    import { createSessionActivationGuard } from "./lib/session_activation.js";
    import { closeAllAppTabs } from "./lib/app_tabs.js";
    import { moveTab, normalizeTabOrder } from "./lib/tab_groups.js";
    import { adjacentTabId, desktopShortcutAction, isEditableShortcutTarget, isTextEditingShortcut } from "./lib/desktop_shortcuts.js";
    import { isHostedByDesktop } from "./lib/desktop-host.js";
    import { installShellControlBridge } from "./lib/shell-control-bridge.js";
    import {
        clearComposerDraft,
        loadComposerDraft,
        saveComposerDraft,
    } from "./lib/composer_drafts.js";
    import * as agentRuntime from "./agents/runtime.js";
    import {
        DEFAULT_AGENT_ID,
        getAgentCatalog,
        readSessionAgent,
        writeSessionAgent,
    } from "./agents/catalog.js";

    import {
        saveSessionState,
        restoreSessionState,
        clearSessionState,
    } from "./persistence.js";
    import { applyThemeToDocument, getTheme, setTheme, THEME_KEY } from "./theme.js";
    import { registerProfileScope } from "./lib/profiles_bootstrap.js";
    import { extractStructuredInput } from "./lib/structured_input.js";

    const controllers = createShellControllers({
        state: {
            get activeAgentId() { return activeAgentId; },
            set activeAgentId(value) { activeAgentId = value; },
            get activeAppInfo() { return activeAppInfo; },
            set activeAppInfo(value) { activeAppInfo = value; },
            get activeIsApp() { return activeIsApp; },
            set activeIsApp(value) { activeIsApp = value; },
            get activeTab() { return activeTab; },
            set activeTab(value) { activeTab = value; },
            get agentId() { return agentId; },
            set agentId(value) { agentId = value; },
            get allTabs() { return allTabs; },
            set allTabs(value) { allTabs = value; },
            get app() { return app; },
            set app(value) { app = value; },
            get APP_LOAD_FALLBACK_MS() { return APP_LOAD_FALLBACK_MS; },
            get appInfoOpen() { return appInfoOpen; },
            set appInfoOpen(value) { appInfoOpen = value; },
            get appInfoTarget() { return appInfoTarget; },
            set appInfoTarget(value) { appInfoTarget = value; },
            get appLoadingMap() { return appLoadingMap; },
            set appLoadingMap(value) { appLoadingMap = value; },
            get appLoadTimers() { return appLoadTimers; },
            get appMenuOpen() { return appMenuOpen; },
            set appMenuOpen(value) { appMenuOpen = value; },
            get appRefreshingMap() { return appRefreshingMap; },
            set appRefreshingMap(value) { appRefreshingMap = value; },
            get appReloadKeys() { return appReloadKeys; },
            set appReloadKeys(value) { appReloadKeys = value; },
            get appTabs() { return appTabs; },
            set appTabs(value) { appTabs = value; },
            get bagError() { return bagError; },
            set bagError(value) { bagError = value; },
            get bagLoading() { return bagLoading; },
            set bagLoading(value) { bagLoading = value; },
            get bagSheetOpen() { return bagSheetOpen; },
            set bagSheetOpen(value) { bagSheetOpen = value; },
            get bagStatus() { return bagStatus; },
            set bagStatus(value) { bagStatus = value; },
            get busOffs() { return busOffs; },
            set busOffs(value) { busOffs = value; },
            get canGoBackMobile() { return canGoBackMobile; },
            set canGoBackMobile(value) { canGoBackMobile = value; },
            get canvasOpen() { return canvasOpen; },
            set canvasOpen(value) { canvasOpen = value; },
            get chatFeatureAvailability() { return chatFeatureAvailability; },
            set chatFeatureAvailability(value) { chatFeatureAvailability = value; },
            get chatInfoOpen() { return chatInfoOpen; },
            set chatInfoOpen(value) { chatInfoOpen = value; },
            get chatMenuMessage() { return chatMenuMessage; },
            set chatMenuMessage(value) { chatMenuMessage = value; },
            get chatMenuMessageTimer() { return chatMenuMessageTimer; },
            set chatMenuMessageTimer(value) { chatMenuMessageTimer = value; },
            get chatMenuOpen() { return chatMenuOpen; },
            set chatMenuOpen(value) { chatMenuOpen = value; },
            get chatRefreshing() { return chatRefreshing; },
            set chatRefreshing(value) { chatRefreshing = value; },
            get composerDockHeight() { return composerDockHeight; },
            set composerDockHeight(value) { composerDockHeight = value; },
            get composerStage() { return composerStage; },
            set composerStage(value) { composerStage = value; },
            get cursorMap() { return cursorMap; },
            set cursorMap(value) { cursorMap = value; },
            get desktopHost() { return desktopHost; },
            set desktopHost(value) { desktopHost = value; },
            get desktopSession() { return desktopSession; },
            set desktopSession(value) { desktopSession = value; },
            get file() { return file; },
            set file(value) { file = value; },
            get floatingShell() { return floatingShell; },
            set floatingShell(value) { floatingShell = value; },
            get gestureOffs() { return gestureOffs; },
            set gestureOffs(value) { gestureOffs = value; },
            get globalLoading() { return globalLoading; },
            set globalLoading(value) { globalLoading = value; },
            get globalLoadingTimer() { return globalLoadingTimer; },
            set globalLoadingTimer(value) { globalLoadingTimer = value; },
            get handoff() { return handoff; },
            set handoff(value) { handoff = value; },
            get headerActionCatalog() { return headerActionCatalog; },
            set headerActionCatalog(value) { headerActionCatalog = value; },
            get history() { return history; },
            set history(value) { history = value; },
            get historyTruncated() { return historyTruncated; },
            set historyTruncated(value) { historyTruncated = value; },
            get iframeRefs() { return iframeRefs; },
            get initialId() { return initialId; },
            get isMobile() { return isMobile; },
            set isMobile(value) { isMobile = value; },
            get isOnline() { return isOnline; },
            set isOnline(value) { isOnline = value; },
            get lastMessage() { return lastMessage; },
            set lastMessage(value) { lastMessage = value; },
            get layoutReady() { return layoutReady; },
            set layoutReady(value) { layoutReady = value; },
            get listen() { return listen; },
            set listen(value) { listen = value; },
            get listRef() { return listRef; },
            set listRef(value) { listRef = value; },
            get loadingFullHistory() { return loadingFullHistory; },
            set loadingFullHistory(value) { loadingFullHistory = value; },
            get loadingMap() { return loadingMap; },
            set loadingMap(value) { loadingMap = value; },
            get message() { return message; },
            set message(value) { message = value; },
            get mobileForwardNavigation() { return mobileForwardNavigation; },
            set mobileForwardNavigation(value) { mobileForwardNavigation = value; },
            get mobileHeaderCollapsed() { return mobileHeaderCollapsed; },
            set mobileHeaderCollapsed(value) { mobileHeaderCollapsed = value; },
            get mobileNavigation() { return mobileNavigation; },
            set mobileNavigation(value) { mobileNavigation = value; },
            get mobilePanel() { return mobilePanel; },
            set mobilePanel(value) { mobilePanel = value; },
            get nativeApp() { return nativeApp; },
            set nativeApp(value) { nativeApp = value; },
            get open() { return open; },
            set open(value) { open = value; },
            get pkg() { return pkg; },
            set pkg(value) { pkg = value; },
            get RECENT_SESSIONS_BATCH_SIZE() { return RECENT_SESSIONS_BATCH_SIZE; },
            get recentSessions() { return recentSessions; },
            set recentSessions(value) { recentSessions = value; },
            get recentSessionsLoading() { return recentSessionsLoading; },
            set recentSessionsLoading(value) { recentSessionsLoading = value; },
            get recentSessionsRequested() { return recentSessionsRequested; },
            set recentSessionsRequested(value) { recentSessionsRequested = value; },
            get recentSessionsVisibleCount() { return recentSessionsVisibleCount; },
            set recentSessionsVisibleCount(value) { recentSessionsVisibleCount = value; },
            get reconcileGeneration() { return reconcileGeneration; },
            set reconcileGeneration(value) { reconcileGeneration = value; },
            get reconnecting() { return reconnecting; },
            set reconnecting(value) { reconnecting = value; },
            get reconnectTimer() { return reconnectTimer; },
            set reconnectTimer(value) { reconnectTimer = value; },
            get refreshTrigger() { return refreshTrigger; },
            set refreshTrigger(value) { refreshTrigger = value; },
            get rightSidebarCollapsed() { return rightSidebarCollapsed; },
            set rightSidebarCollapsed(value) { rightSidebarCollapsed = value; },
            get session() { return session; },
            set session(value) { session = value; },
            get sessionActivation() { return sessionActivation; },
            get sessionCache() { return sessionCache; },
            set sessionCache(value) { sessionCache = value; },
            get sessionId() { return sessionId; },
            set sessionId(value) { sessionId = value; },
            get sessionPreferences() { return sessionPreferences; },
            set sessionPreferences(value) { sessionPreferences = value; },
            get shellControlApps() { return shellControlApps; },
            set shellControlApps(value) { shellControlApps = value; },
            get shellDesktopControl() { return shellDesktopControl; },
            set shellDesktopControl(value) { shellDesktopControl = value; },
            get shellEl() { return shellEl; },
            set shellEl(value) { shellEl = value; },
            get shellScope() { return shellScope; },
            set shellScope(value) { shellScope = value; },
            get showLoading() { return showLoading; },
            set showLoading(value) { showLoading = value; },
            get sidebarCollapsed() { return sidebarCollapsed; },
            set sidebarCollapsed(value) { sidebarCollapsed = value; },
            get statusModal() { return statusModal; },
            set statusModal(value) { statusModal = value; },
            get structuredProps() { return structuredProps; },
            set structuredProps(value) { structuredProps = value; },
            get system() { return system; },
            set system(value) { system = value; },
            get tabOrder() { return tabOrder; },
            set tabOrder(value) { tabOrder = value; },
            get tabs() { return tabs; },
            set tabs(value) { tabs = value; },
            get theme() { return theme; },
            set theme(value) { theme = value; },
            get title() { return title; },
            set title(value) { title = value; },
            get unreadMap() { return unreadMap; },
            set unreadMap(value) { unreadMap = value; },
            get url() { return url; },
            set url(value) { url = value; },
            get wasOffline() { return wasOffline; },
            set wasOffline(value) { wasOffline = value; },
        },
        services: {
            get CustomEvent() { return CustomEvent; },
            get FILE_MANAGER_PREVIEW_EVENT() { return FILE_MANAGER_PREVIEW_EVENT; },
            get adjacentTabId() { return adjacentTabId; },
            get agentRuntime() { return agentRuntime; },
            get api() { return api; },
            get bootstrapBackgroundViews() { return bootstrapBackgroundViews; },
            get bootstrapMenuItems() { return bootstrapMenuItems; },
            get bootstrapMessageActions() { return bootstrapMessageActions; },
            get bootstrapPackageWidgets() { return bootstrapPackageWidgets; },
            get busEmit() { return busEmit; },
            get busEmitLocal() { return busEmitLocal; },
            get busOn() { return busOn; },
            get clearComposerDraft() { return clearComposerDraft; },
            get closeAllAppTabs() { return closeAllAppTabs; },
            get closeAllChatTabs() { return closeAllChatTabs; },
            get closeChatTab() { return closeChatTab; },
            get createGestureRouter() { return createGestureRouter; },
            get createIframeGestureBridge() { return createIframeGestureBridge; },
            get createNewTopicWorkspace() { return createNewTopicWorkspace; },
            get desktopShortcutAction() { return desktopShortcutAction; },
            get disposeBackgroundViews() { return disposeBackgroundViews; },
            get document() { return document; },
            get extractAttachmentRefs() { return extractAttachmentRefs; },
            get extractStructuredInput() { return extractStructuredInput; },
            get fetch() { return fetch; },
            get filePreviewUrl() { return filePreviewUrl; },
            get getTheme() { return getTheme; },
            get handleOpenCanvas() { return handleOpenCanvas; },
            get headerActionMessage() { return headerActionMessage; },
            get historyStateWithMobileDestination() { return historyStateWithMobileDestination; },
            get installEdgeSwipeDetector() { return installEdgeSwipeDetector; },
            get installNativeGestureBridge() { return installNativeGestureBridge; },
            get installShellControlBridge() { return installShellControlBridge; },
            get isEditableShortcutTarget() { return isEditableShortcutTarget; },
            get isHostedByDesktop() { return isHostedByDesktop; },
            get isTextEditingShortcut() { return isTextEditingShortcut; },
            get localStorage() { return localStorage; },
            get mergeAttachments() { return mergeAttachments; },
            get mobileDestinationFromHistoryState() { return mobileDestinationFromHistoryState; },
            get moveTab() { return moveTab; },
            get navigator() { return navigator; },
            get normalizeTabOrder() { return normalizeTabOrder; },
            get publishBackgroundContext() { return publishBackgroundContext; },
            get readSessionAgent() { return readSessionAgent; },
            get restoreSessionState() { return restoreSessionState; },
            get retryTurnInput() { return retryTurnInput; },
            get sanitizeHistoryMessages() { return sanitizeHistoryMessages; },
            get saveSessionState() { return saveSessionState; },
            get setServerForwarder() { return setServerForwarder; },
            get tick() { return tick; },
            get window() { return window; },
            get writeSessionAgent() { return writeSessionAgent; },
        },
    });

    const {
        recentSessionLabel, recentSessionMeta, handleRecentSessionsScroll, recentSessionInfiniteScroll,
        openRecentSession, generateSessionId, handleSelectTab, handleNewSpecialistSession,
        handleRenameTab, handleTogglePin, handleMoveTab, handleCloseTab,
        handleCloseAllChats, handleSelectSession, handleSessionDelete, handleSelectChat,
        handleCloseChat, isMobileDestinationAvailable, goBackMobile, goForwardMobile,
        closeActiveMobileTab, mobileHome, abrirChatPorDeepLink, finishAppLoad,
        handleOpenApp, handleSelectApp, handleCloseApp, handleCloseAllApps,
        handleReorderApps, handleOpenSeparateWindow, reportEdgeError, reportEdgeRejection,
        openLeft, openRight, closePanel, dismissMobileMenus,
        refreshMobileChat, refreshMobileApp, enterMobileFullscreen, returnToLauncher,
        openChatInfo, openBag, openArtifactLibrary, copyActiveSessionId,
        buildAppDetails, openAppInfo, runHeaderAction, openCatalogAppInfo,
        closeAppInfo, animateComposerToDock, handleDesktopShortcut, processAssistantMessage,
        onEscape, mountShell, loadFullHistory, handleResolvePermission,
        handleMessageFeedback, handleStop, retryTimedOutTurn, send,
        onStructuredSend,
    } = controllers;

    export let open; // "chat" | "app" | "result" | "path" — deep-link vindo de notificação push (ver packages/ntfy/AGENT.md)
    export let session; // sessionId para open=chat
    export let listen; // "1" solicita ditado nativo após a Shell montar
    export let app; // id do app (getActiveApps/getPackageViews) para open=app
    export let url; // caminho interno para open=path
    export let title; // rótulo opcional para open=path
    export let pkg; // nome do pacote de origem (ex.: "cnpj-scraper")
    export let file; // caminho relativo do resultado (ex.: "uploads/companies/x.csv")
    export let appId;
    export let handoff;
    export let desktopSession;
    export let agentId;
    export let workspaceId;
    export let shellId;
    export let surface;
    $: floatingShell = surface === "floating-shell";

    let theme = "dark";
    let desktopHost = false;
    let nativeApp = false;
    let shellDesktopControl = null;
    let shellControlApps = [];
    $: shellScope = workspaceId && shellId ? { workspaceId, shellId } : null;
    const agentCatalog = getAgentCatalog();
    let activeAgentId = DEFAULT_AGENT_ID;

    $: activeAgent = agentCatalog.find((agent) => agent.id === activeAgentId)
        ?? agentCatalog.find((agent) => agent.id === DEFAULT_AGENT_ID);

    function handleToggleTheme() {
        theme = theme === "dark" ? "light" : "dark";
        setTheme(theme);
        anunciarTema();
    }

    function anunciarTema() {
        window.dispatchEvent(new CustomEvent("think:theme-changed", { detail: theme }));
    }

    registerProfileScope({
        key: THEME_KEY,
        hydrate() {
            theme = getTheme();
            anunciarTema();
        },
    });

    let showLoading = true;
    let globalLoading = { active: false, id: null };
    let globalLoadingTimer = null;
    let mobileHeaderCollapsed = false;

    let isOnline = true;
    let wasOffline = false;
    let reconnecting = false;
    let reconnectTimer = null;

    let structuredProps = null; // Inicializa oculto por padrão

    $: lastMessage =
        history && history.length > 0 ? history[history.length - 1] : null;

    $: structuredProps =
        lastMessage &&
        lastMessage.role === "assistant" &&
        !lastMessage.streaming
            ? lastMessage._structuredData
                ? Array.isArray(lastMessage._structuredData)
                    ? lastMessage._structuredData
                    : [lastMessage._structuredData]
                : null
            : null;

    let canvasOpen = false;
    let canvasHtml = "";

    function handleOpenCanvas(e) {
        canvasHtml = e.detail.html;
        canvasOpen = true;
    }

    let message = "";
    let sessionPreferences = { idPrefix: "", defaultModel: null };
    const initialId = generateSessionId();
    let sessionId = initialId;
    let history = [];
    let system = { provider: "—", model: "—", connections: [] };
    let listRef;
    let composerStage;
    let composerDockHeight = 122;

    let sessionCache = {};
    let recentSessions = [];
    let recentSessionsLoading = false;
    let recentSessionsRequested = false;
    let recentSessionsVisibleCount = 5;
    const RECENT_SESSIONS_BATCH_SIZE = 5;

    $: visibleRecentSessions = recentSessions.slice(0, recentSessionsVisibleCount);

    let historyTruncated = false;
    let loadingFullHistory = false;

    let composerSessionId = "";
    $: if (
        typeof window !== "undefined" &&
        sessionId &&
        sessionId !== composerSessionId
    ) {
        if (composerSessionId) saveComposerDraft(composerSessionId, message);
        message = loadComposerDraft(sessionId);
        composerSessionId = sessionId;
    }
    $: if (
        typeof window !== "undefined" &&
        composerSessionId &&
        composerSessionId === sessionId
    ) {
        saveComposerDraft(composerSessionId, message);
    }
    let cursorMap = {};
    let reconcileGeneration = {};
    const sessionActivation = createSessionActivationGuard();

    const { extractAttachmentRefs, mergeAttachments, sanitizeHistoryMessages } =
        createHistoryMessages({
            resourceUrl: (path) => agentRuntime.resourceUrl(path),
            processAssistantMessage,
        });

    let isMobile = false;
    let layoutReady = false;
    let mobilePanel = null;
    let mobileNavigation = [];
    let mobileForwardNavigation = [];
    let canGoBackMobile = false;
    let canGoForwardMobile = false;
    let chatMenuOpen = false;
    let chatMenuMessage = "";
    let chatMenuMessageTimer;
    let chatRefreshing = false;
    let chatInfoOpen = false;
    let bagSheetOpen = false;
    let bagStatus = null;
    let bagLoading = false;
    let bagError = "";
    let chatFeatureAvailability = { artifacts: false, bags: false };
    let shellEl;
    const iframeRefs = {};
    let gestureOffs = [];

    $: canGoBackMobile = mobileNavigation.some(isMobileDestinationAvailable);
    $: canGoForwardMobile = mobileForwardNavigation.some(isMobileDestinationAvailable);

    function bagStepLabel(status) {
        return {
            done: "Done",
            skipped: "Skipped",
            in_progress: "In progress",
            failed: "Failed",
            pending: "Pending",
        }[status] ?? "Pending";
    }

    $: chatInfoHistory = sessionCache[activeTab] ?? history;
    $: chatInfoUsage = chatInfoHistory.reduce((total, message) => {
        const usage = message?.usage || {};
        return {
            prompt: total.prompt + Number(usage.prompt_tokens || usage.input_tokens || 0),
            completion: total.completion + Number(usage.completion_tokens || usage.output_tokens || 0),
            cost: total.cost + Number(usage.cost || 0),
        };
    }, { prompt: 0, completion: 0, cost: 0 });
    $: chatInfoTotalTokens = chatInfoUsage.prompt + chatInfoUsage.completion;
    $: chatInfoMessages = chatInfoHistory.filter((message) => String(message?.content ?? '').trim()).length;

    function formatChatNumber(value) {
        return new Intl.NumberFormat('en-US').format(value || 0);
    }

    function formatChatCost(value) {
        if (!Number.isFinite(value) || value <= 0) return 'Not available';
        return value < 0.01 ? `${value.toFixed(4)}` : `${value.toFixed(2)}`;
    }

    let tabs = [{ sessionId: initialId, name: "New Mission", pinned: false }];
    let activeTab = initialId;
    let loadingMap = {};
    let unreadMap = {};
    let refreshTrigger = 0;
    let sidebarCollapsed = false;
    let rightSidebarCollapsed = false;
    let desktopSidebarWidth = 280;
    let desktopRightSidebarWidth = 280;
    let appReloadKeys = {};
    let tabOrder = [];
    let appMenuOpen = false;
    let appRefreshingMap = {};

    export function handleNewTab(...args) { return controllers.handleNewTab(...args); }

    let appTabs = [];
    let activeIsApp = false;
    $: {
        const current = activeIsApp ? appTabs.find((tab) => tab.id === activeTab) : null;
        publishBackgroundContext(activeIsApp
            ? { category: "app", contextId: current?.id || "unknown-app", contextLabel: current?.name || current?.label || "App" }
            : { category: "chat", contextId: "chat", contextLabel: "Chat" });
    }
    let appLoadingMap = {};
    const appLoadTimers = {};
    const APP_LOAD_FALLBACK_MS = 1200;

    let statusModal = null;
    let notificationCenterOpen = false;
    let notificationCount = 0;
    let appInfoOpen = false;
    let appInfoTarget = null;
    let headerActionCatalog = [];

    $: activeAppInfo = activeIsApp
        ? appTabs.find((tab) => tab.id === activeTab) ?? null
        : null;
    $: activeHeaderActions = headerActionsForView(headerActionCatalog, activeAppInfo);
    $: activeAppIcon = (() => {
        if (!activeAppInfo) return null;
        if (theme === "dark") {
            if (activeAppInfo.iconDarkSvg) return { kind: "svg", value: activeAppInfo.iconDarkSvg };
            if (activeAppInfo.iconDark) return { kind: "image", value: activeAppInfo.iconDark };
        }
        if (activeAppInfo.iconSvg) return { kind: "svg", value: activeAppInfo.iconSvg };
        if (activeAppInfo.icon) return { kind: "image", value: activeAppInfo.icon };
        return null;
    })();
    $: activeAppInitials = String(activeAppInfo?.name || activeAppInfo?.packageName || "App")
        .trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "AP";
    $: appInfoIcon = (() => {
        if (!appInfoTarget) return null;
        if (theme === "dark") {
            if (appInfoTarget.iconDarkSvg) return { kind: "svg", value: appInfoTarget.iconDarkSvg };
            if (appInfoTarget.iconDark) return { kind: "image", value: appInfoTarget.iconDark };
        }
        if (appInfoTarget.iconSvg) return { kind: "svg", value: appInfoTarget.iconSvg };
        if (appInfoTarget.icon) return { kind: "image", value: appInfoTarget.icon };
        return null;
    })();
    $: appInfoInitials = String(appInfoTarget?.name || appInfoTarget?.packageName || "App")
        .trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "AP";
    $: appInfoDetails = buildAppDetails(appInfoTarget);

    $: rawTabs = [
        ...tabs.map((t) => ({ ...t, type: "chat" })),
        ...appTabs.map((t) => ({ ...t, type: "app", sessionId: t.id })),
    ];
    $: {
        const normalizedOrder = normalizeTabOrder(tabOrder, rawTabs);
        if (normalizedOrder.length !== tabOrder.length ||
            normalizedOrder.some((id, index) => id !== tabOrder[index])) {
            tabOrder = normalizedOrder;
        }
    }
    $: allTabs = tabOrder.map((id) => rawTabs.find((tab) => tab.sessionId === id)).filter(Boolean);

    $: {
        sessionId;
        appTabs;
        activeTab;
        activeIsApp;
        shellControlApps;
        shellDesktopControl?.updateState();
    }

    let busOffs = [];

    $: activeTabName = (() => {
        if (activeIsApp)
            return appTabs.find((t) => t.id === activeTab)?.name ?? "App";
        return tabs.find((t) => t.sessionId === activeTab)?.name ?? "Chat";
    })();

    $: chatTabsForWindows = tabs.map((t) => ({ ...t, type: "chat" }));

    $: agentRuntime.subscribeAll(tabs.map((t) => t.sessionId));
    $: if (agentRuntime.isReady()) {
        agentRuntime.setUiState({
            activeChatSessionId: activeIsApp ? null : sessionId,
        });
    }

    onMount(() => mountShell());
</script>

<svelte:head>
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>ThinkIac</title>
</svelte:head>

<!--
    Safe-area: no browser/PWA usa env(); dentro do app nativo a presença da
    ponte confirma que a WebView já vem envolta por SafeArea, então zeramos pra não
    contar o inset duas vezes (padding-top/​bottom fantasma). A var cascateia
    pro componente filho (Sidebar).
-->
<svelte:window
    on:keydown={handleDesktopShortcut}
    on:click={dismissMobileMenus}
    on:error={reportEdgeError}
    on:unhandledrejection={reportEdgeRejection}
/>
<div
    class="shell"
    class:floating-shell={floatingShell}
    class:layout-ready={layoutReady}
    data-thinkiac-shell="ready"
    bind:this={shellEl}
    data-theme={theme}
    style="--safe-top: {nativeApp ? '0px' : 'env(safe-area-inset-top)'}; --safe-bottom: {nativeApp ? '0px' : 'env(safe-area-inset-bottom)'};"
>
    {#if isMobile && !mobilePanel}
        <!-- Fica acima de iframes no browser/PWA: eventos iniciados dentro de
             um iframe não atravessam para o documento pai. -->
        <div class="mobile-swipe-edge mobile-swipe-edge-left" aria-hidden="true"></div>
        <div class="mobile-swipe-edge mobile-swipe-edge-right" aria-hidden="true"></div>
    {/if}
    <GlobalLoading
        active={showLoading || globalLoading.active || !isOnline}
    />

    <div class="bg-layer" aria-hidden="true">
        <div class="bg-noise"></div>
    </div>

    <!-- Sidebar -->
    {#if !floatingShell}
    <Sidebar
        {system}
        {sessionId}
        {tabs}
        {isMobile}
        {mobilePanel}
        {theme}
        {refreshTrigger}
        {appTabs}
        chatTabs={chatTabsForWindows}
        {activeTab}
        {activeIsApp}
        {loadingMap}
        {unreadMap}
        desktopHost={desktopHost}
        {nativeApp}
            bind:collapsed={sidebarCollapsed}
            bind:rightCollapsed={rightSidebarCollapsed}
        bind:sidebarWidth={desktopSidebarWidth}
        bind:rightSidebarWidth={desktopRightSidebarWidth}
        on:selectSession={handleSelectSession}
        on:clear={handleNewTab}
        on:openApp={handleOpenApp}
        on:appInfo={openCatalogAppInfo}
        on:deleteSession={handleSessionDelete}
        on:close={closePanel}
        on:selectApp={handleSelectApp}
        on:closeApp={handleCloseApp}
        on:closeAllApps={handleCloseAllApps}
        on:reorderApps={handleReorderApps}
        on:selectChat={handleSelectChat}
        on:closeChat={handleCloseChat}
        on:closeAllChats={handleCloseAllChats}
        on:togglePin={handleTogglePin}
        on:toggleTheme={handleToggleTheme}
        on:returnToModeChoice={returnToLauncher}
    />
    {/if}

    {#if isMobile && !floatingShell && mobileHeaderCollapsed}
        <nav class="mobile-fullscreen-sidebar-controls" aria-label="Open side panels">
            {#if mobilePanel !== "right"}
                <button
                    type="button"
                    class="mobile-fullscreen-sidebar-toggle mobile-fullscreen-sidebar-toggle-left"
                    class:open={mobilePanel === "left"}
                    on:click={openLeft}
                    aria-label={mobilePanel === "left" ? "Close conversations panel" : "Open conversations panel"}
                    aria-expanded={mobilePanel === "left"}
                    title={mobilePanel === "left" ? "Close conversations panel" : "Open conversations panel"}
                >
                    <svg viewBox="0 0 16 24" width="10" height="16" fill="none" aria-hidden="true">
                        <path d="m5 4 7 8-7 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </button>
            {/if}
            {#if mobilePanel !== "left"}
                <button
                    type="button"
                    class="mobile-fullscreen-sidebar-toggle mobile-fullscreen-sidebar-toggle-right"
                    class:open={mobilePanel === "right"}
                    on:click={openRight}
                    aria-label={mobilePanel === "right" ? "Close applications panel" : "Open applications panel"}
                    aria-expanded={mobilePanel === "right"}
                    title={mobilePanel === "right" ? "Close applications panel" : "Open applications panel"}
                >
                    <svg viewBox="0 0 16 24" width="10" height="16" fill="none" aria-hidden="true">
                        <path d="m11 4-7 8 7 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </button>
            {/if}
        </nav>
    {/if}

    <div
        class="main-area"
        class:push-left={isMobile && mobilePanel === 'left'}
        class:push-right={isMobile && mobilePanel === 'right'}
        style="--shell-left-rail: {!floatingShell && !isMobile && !sidebarCollapsed ? `${desktopSidebarWidth}px` : '0px'}; --shell-right-rail: {!floatingShell && !isMobile && !rightSidebarCollapsed ? `${desktopRightSidebarWidth}px` : '0px'};"
    >
        {#if isMobile && mobilePanel}
            <!-- Gaveta empurra o conteúdo em vez de escurecê-lo com um véu —
                 este botão invisível cobre o conteúdo deslocado e fecha a
                 gaveta ao tocar nele, como tocar a borda exposta de uma
                 gaveta física. -->
            <button
                class="push-catcher"
                on:click={closePanel}
                aria-label="Close drawer"
            ></button>
        {/if}
        <!-- Tab bar desktop -->
        {#if !isMobile}
            <SessionTabs
                tabs={allTabs}
                {appTabs}
                {activeTab}
                {loadingMap}
                {theme}
                headerActions={activeHeaderActions}
                isMobile={false}
                on:selectTab={handleSelectTab}
                on:newTab={handleNewTab}
                on:renameTab={handleRenameTab}
                on:closeTab={handleCloseTab}
                on:moveTab={handleMoveTab}
                on:openSeparate={handleOpenSeparateWindow}
                on:headerAction={(event) => runHeaderAction(event.detail)}
                hostedByDesktop={desktopHost}
            />
        {/if}

        <!-- Os menus de Widget permanecem acessíveis também nas views de
             pacote. Os controles específicos do pacote entram ao lado do
             nome, sem substituir os atalhos declarativos das gavetas. -->
        {#if isMobile && !floatingShell}
            <div class="mobile-topbar-dock" class:collapsed={mobileHeaderCollapsed}>
            <div
                class="mobile-topbar"
                class:collapsed={mobileHeaderCollapsed}
                aria-hidden={mobileHeaderCollapsed}
                inert={mobileHeaderCollapsed}
            >
                {#if activeIsApp}
                    <button class="mtb-btn" on:click={openLeft} aria-label="Docks and sessions"><svg viewBox="0 0 16 16" fill="none" width="17" height="17"><path d="M2 4.5h12M2 8h12M2 11.5h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
                    <button class="mtb-btn" on:click={mobileHome} aria-label="Back" title="Back">
                        <svg viewBox="0 0 16 16" fill="none" width="17" height="17"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                    <button class="mtb-btn" on:click={goForwardMobile} disabled={!canGoForwardMobile} aria-label="Forward" title="Forward">
                        <svg viewBox="0 0 16 16" fill="none" width="17" height="17" aria-hidden="true"><path d="m6 3 5 5-5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                    <button
                        type="button"
                        class="mtb-app-title"
                        on:click={() => (mobileHeaderCollapsed = true)}
                        aria-label={`Collapse header for ${activeTabName}`}
                        title="Collapse header"
                    >{activeTabName}</button>
                    <div class="mtb-app-menu" on:click|stopPropagation>
                        <button class="mtb-btn" class:active={appMenuOpen} on:click={() => (appMenuOpen = !appMenuOpen)} aria-label="App options" aria-expanded={appMenuOpen}>
                            <svg viewBox="0 0 16 16" fill="currentColor" width="17" height="17" aria-hidden="true"><circle cx="3" cy="8" r="1.25"/><circle cx="8" cy="8" r="1.25"/><circle cx="13" cy="8" r="1.25"/></svg>
                        </button>
                        {#if appMenuOpen}
                            <div class="mtb-app-dropdown" role="menu" aria-label="App options">
                                {#each activeHeaderActions as action (`${action.sourcePackage}:${action.id}`)}
                                    <button type="button" role="menuitem" class="mtb-header-action" on:click={() => runHeaderAction(action)}>
                                        <span><strong>{action.label}</strong>{#if action.description}<small>{action.description}</small>{/if}</span>
                                    </button>
                                {/each}
                                <div class="mtb-menu-actions" aria-label="Package actions">
                                    <button type="button" role="menuitem" on:click={openAppInfo} aria-label="Information" title="Information"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5.75" stroke="currentColor" stroke-width="1.35"/><path d="M8 7.1v4M8 4.75v.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
                                    <button type="button" role="menuitem" on:click={enterMobileFullscreen} aria-label="Full Screen" title="Full Screen"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6.25 2.75-3.5 3.5m0 0V3.4m0 2.85H5.6m4.15 7 3.5-3.5m0 0v2.85m0-2.85H10.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
                                    <button type="button" role="menuitem" on:click={refreshMobileApp} disabled={appRefreshingMap[activeTab]} aria-label="Refresh" title="Refresh"><svg class:refreshing={appRefreshingMap[activeTab]} viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13 5.5A5.5 5.5 0 1 0 13.2 10M13 2.7v3h-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
                                    <button type="button" role="menuitem" on:click={closeActiveMobileTab} aria-label="Close" title="Close"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m5 5 6 6m0-6-6 6" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"/></svg></button>
                                </div>
                            </div>
                        {/if}
                    </div>
                    <button class="mtb-btn" on:click={openRight} aria-label="Apps"><svg viewBox="0 0 20 20" fill="none" width="17" height="17"><rect x="2" y="2" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.4"/><rect x="11" y="2" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.4"/><rect x="2" y="11" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.4"/><rect x="11" y="11" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.4"/></svg></button>
                {:else}
                    <button class="mtb-btn" on:click={openLeft} aria-label="Docks and sessions"><svg viewBox="0 0 16 16" fill="none" width="17" height="17"><path d="M2 4.5h12M2 8h12M2 11.5h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
                    <button class="mtb-btn" on:click={goBackMobile} disabled={!canGoBackMobile} aria-label="Back" title="Back">
                        <svg viewBox="0 0 16 16" fill="none" width="17" height="17" aria-hidden="true"><path d="M10 3 5 8l5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                    <button class="mtb-btn" on:click={goForwardMobile} disabled={!canGoForwardMobile} aria-label="Forward" title="Forward">
                        <svg viewBox="0 0 16 16" fill="none" width="17" height="17" aria-hidden="true"><path d="m6 3 5 5-5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                    <button
                        type="button"
                        class="mtb-title"
                        on:click={() => (mobileHeaderCollapsed = true)}
                        aria-label={`Collapse header for ${activeTabName}`}
                        title="Collapse header"
                    ><span class="mtb-title-text">{activeTabName}</span></button>
                    <div class="mtb-app-menu" on:click|stopPropagation>
                        <button class="mtb-btn" class:active={chatMenuOpen} on:click={() => (chatMenuOpen = !chatMenuOpen)} aria-label="Chat options" aria-expanded={chatMenuOpen}>
                            <svg viewBox="0 0 16 16" fill="currentColor" width="17" height="17" aria-hidden="true"><circle cx="3" cy="8" r="1.25"/><circle cx="8" cy="8" r="1.25"/><circle cx="13" cy="8" r="1.25"/></svg>
                        </button>
                        {#if chatMenuOpen}
                            <div class="mtb-app-dropdown" role="menu" aria-label="Chat options">
                                <div class="mtb-menu-actions" aria-label="Chat actions">
                                    <button type="button" role="menuitem" on:click={openChatInfo} aria-label="Information" title="Information"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5.75" stroke="currentColor" stroke-width="1.35"/><path d="M8 7.1v4M8 4.75v.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
                                    <button type="button" role="menuitem" on:click={enterMobileFullscreen} aria-label="Full Screen" title="Full Screen"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6.25 2.75-3.5 3.5m0 0V3.4m0 2.85H5.6m4.15 7 3.5-3.5m0 0v2.85m0-2.85H10.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
                                    <button type="button" role="menuitem" on:click={refreshMobileChat} disabled={chatRefreshing} aria-label="Refresh" title="Refresh"><svg class:refreshing={chatRefreshing} viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13 5.5A5.5 5.5 0 1 0 13.2 10M13 2.7v3h-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
                                    <button type="button" role="menuitem" on:click={closeActiveMobileTab} aria-label="Close" title="Close"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m5 5 6 6m0-6-6 6" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"/></svg></button>
                                </div>
                                {#if chatFeatureAvailability.artifacts}
                                    <button type="button" role="menuitem" on:click={openArtifactLibrary}>
                                        <span class="mtb-menu-icon"><svg viewBox="0 0 16 16" fill="none" width="16" height="16" aria-hidden="true"><path d="M3 2.75h6.2l3.8 3.8v6.7H3z" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/><path d="M9.2 2.75v3.8H13M5.4 9.25h5.2m-5.2 2.25h3.4" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
                                        <span><strong>Artifacts</strong><small>Browse generated files</small></span>
                                    </button>
                                {/if}
                                {#if chatFeatureAvailability.bags}
                                    <button type="button" role="menuitem" on:click={openBag}>
                                        <span class="mtb-menu-icon"><svg viewBox="0 0 16 16" fill="none" width="16" height="16" aria-hidden="true"><path d="M3 2.5h10v11H3z" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/><path d="M5.25 5.5h5.5M5.25 8h5.5M5.25 10.5h3.4" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/></svg></span>
                                        <span><strong>Bag</strong><small>View session plan</small></span>
                                    </button>
                                {/if}
                            </div>
                        {/if}
                    </div>
                    <button class="mtb-btn" on:click={openRight} aria-label="Apps"><svg viewBox="0 0 20 20" fill="none" width="17" height="17"><rect x="2" y="2" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.4"/><rect x="11" y="2" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.4"/><rect x="2" y="11" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.4"/><rect x="11" y="11" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.4"/></svg></button>
                {/if}
            </div>
            {#if mobileHeaderCollapsed}
                <div class="mobile-fullscreen-center">
                    <button type="button" class="mobile-topbar-toggle" on:click={() => (mobileHeaderCollapsed = false)} aria-expanded="false" aria-label="Show header" title="Show header">
                        <svg viewBox="0 0 20 12" width="18" height="11" fill="none" aria-hidden="true"><path d="M3 3.5 10 9l7-5.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
                    </button>
                </div>
            {/if}
            </div>
        {/if}

        <div class="tab-content">
            <div class="chat-panel" class:hidden={activeIsApp} style={`--composer-reserve: ${composerDockHeight}px`}>
                {#if isMobile && historyTruncated}
                    <button
                        class="mobile-history-expand"
                        on:click={loadFullHistory}
                        disabled={loadingFullHistory}
                    >
                        {loadingFullHistory ? "Loading full conversation…" : "Load full conversation history"}
                    </button>
                {/if}
                <MessageList
                    {history}
                    {isMobile}
                    agentName={activeAgent?.name ?? "Agent"}
                    sessionId={activeTab}
                    loading={loadingMap[activeTab] ?? false}
                    bind:this={listRef}
                    on:openCanvas={handleOpenCanvas}
                    on:resolvePermission={handleResolvePermission}
                    on:messageFeedback={handleMessageFeedback}
                    on:retry={(e) => retryTimedOutTurn(e.detail.sessionId, e.detail.index)}
                    on:useSuggestion={(e) => (message = e.detail)}
                />

                <ActivitySlot sessionId={activeTab} on:openSession={(e) => abrirChatPorDeepLink(e.detail)}>
                </ActivitySlot>

                <ComposerArea {structuredProps} {onStructuredSend} {onEscape} {appId} {history} {isMobile} {loadingMap} {activeTab} {isOnline} {animateComposerToDock} {send} {handleStop} {handleNewSpecialistSession} {recentSessionsLoading} {visibleRecentSessions} {recentSessions} {recentSessionInfiniteScroll} {handleRecentSessionsScroll} {openRecentSession} {recentSessionLabel} {recentSessionMeta}
                    bind:composerStage bind:message />
            </div>

            <AppSurface {appTabs} {activeTab} {isMobile} {appLoadingMap}
                {appReloadKeys} {iframeRefs} {applyThemeToDocument} {finishAppLoad} />
        </div>

    </div>

    <Canvas
        html={canvasHtml}
        open={canvasOpen}
        on:close={() => (canvasOpen = false)}
    />

    <NtfyInbox bind:centerOpen={notificationCenterOpen} on:count={(event) => (notificationCount = event.detail.count)} />

    {#if statusModal}
        <div class="status-modal-backdrop" role="presentation" on:click={() => (statusModal = null)}>
            <section class="status-modal" role="dialog" aria-modal="true" aria-label={statusModal.label} on:click|stopPropagation>
                <header>
                    <h2>{statusModal.label}</h2>
                    <button type="button" aria-label="Close {statusModal.label}" on:click={() => (statusModal = null)}>×</button>
                </header>
                <iframe src={statusModal.url} title={statusModal.label} sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"></iframe>
            </section>
        </div>
    {/if}

    {#if appInfoTarget}
        <ModalSheet open={appInfoOpen} centered label="Package information" on:close={closeAppInfo}>
                <div class="app-info-hero">
                    <div class="app-info-icon" aria-hidden="true">
                        {#if appInfoIcon?.kind === "svg"}
                            <span class="app-info-icon-svg">{@html appInfoIcon.value}</span>
                        {:else if appInfoIcon?.kind === "image"}
                            <img src={appInfoIcon.value} alt="" />
                        {:else}
                            <span class="app-info-initials">{appInfoInitials}</span>
                        {/if}
                    </div>
                    <div>
                        <p class="app-info-eyebrow">Package information</p>
                        <h2 id="app-info-title">{appInfoTarget.name || appInfoTarget.packageName || "Application"}</h2>
                        {#if appInfoTarget.version}<p class="app-info-version">Version {appInfoTarget.version}</p>{/if}
                    </div>
                </div>
                <div class="app-info-details" aria-label="Package details">
                    {#each appInfoDetails as detail}
                        <div class="app-info-row"><dt>{detail.label}</dt><dd>{detail.value}</dd></div>
                    {/each}
                </div>
        </ModalSheet>
    {/if}

    <ModalSheet open={chatInfoOpen} centered label="Chat information" on:close={() => (chatInfoOpen = false)}>
        <div class="app-info-hero">
            <div class="app-info-icon chat-info-icon" aria-hidden="true">Σ</div>
            <div><p class="app-info-eyebrow">Chat information</p><h2>Current conversation</h2></div>
        </div>
        <div class="app-info-details" aria-label="Chat details">
            <div class="app-info-row"><dt>Identifier</dt><dd><button type="button" class="chat-info-identifier" on:click={copyActiveSessionId} title="Copy identifier">{chatMenuMessage || sessionId}</button></dd></div>
            <div class="app-info-row"><dt>Context</dt><dd>{formatChatNumber(chatInfoMessages)} messages</dd></div>
            <div class="app-info-row"><dt>Input tokens</dt><dd>{formatChatNumber(chatInfoUsage.prompt)}</dd></div>
            <div class="app-info-row"><dt>Output tokens</dt><dd>{formatChatNumber(chatInfoUsage.completion)}</dd></div>
            <div class="app-info-row"><dt>Total usage</dt><dd>{formatChatNumber(chatInfoTotalTokens)} tokens</dd></div>
            <div class="app-info-row"><dt>Cost</dt><dd>{formatChatCost(chatInfoUsage.cost)}</dd></div>
        </div>
    </ModalSheet>

    <ModalSheet open={bagSheetOpen} centered label="Session bag" on:close={() => (bagSheetOpen = false)}>
        <div class="app-info-hero">
            <div class="app-info-icon chat-info-icon" aria-hidden="true">□</div>
            <div><p class="app-info-eyebrow">Session bag</p><h2>Plan and progress</h2></div>
        </div>
        {#if bagLoading}
            <p class="bag-sheet-message">Loading plan…</p>
        {:else if bagError}
            <p class="bag-sheet-message bag-sheet-error">{bagError}</p>
        {:else if !bagStatus}
            <p class="bag-sheet-message">No plan has been created for this conversation.</p>
        {:else}
            <div class="bag-sheet-summary">
                <p>{bagStatus.objective}</p>
                <span>{bagStatus.status === "done" ? "Complete" : "In progress"} · {bagStatus.steps?.filter((step) => step.status === "done" || step.status === "skipped").length ?? 0}/{bagStatus.steps?.length ?? 0} steps</span>
            </div>
            {#if bagStatus.steps?.length}
                <ol class="bag-sheet-steps" aria-label="Plan steps">
                    {#each bagStatus.steps as step (step.seq)}
                        <li class:done={step.status === "done" || step.status === "skipped"} class:failed={step.status === "failed"}>
                            <span class="bag-step-state">{step.seq}</span>
                            <span><strong>{step.description}</strong><small>{bagStepLabel(step.status)}{step.result ? ` · ${step.result}` : ""}</small></span>
                        </li>
                    {/each}
                </ol>
            {/if}
        {/if}
    </ModalSheet>

    <!-- Pai direto dos apps em abas: recebe os pedidos postMessage deles. -->
    <Dialogs host={true} />

</div>

<style>
    /* Sobre Canvas, drawers e qualquer app em modo tela cheia. */
    :global(.dlg-backdrop) { z-index: 2147483647; }
    .status-modal-backdrop { position: fixed; inset: 0; z-index: 2147483645; display: grid; place-items: center; padding: 2rem; background: color-mix(in srgb, var(--tk-bg) 74%, transparent); }
    .status-modal { display: flex; width: min(100%, 58rem); height: min(78dvh, 46rem); flex-direction: column; overflow: hidden; border: 1px solid var(--tk-border); border-radius: var(--tk-radius-lg); background: var(--tk-surface); box-shadow: 0 2px 8px rgba(0,0,0,.08); }
    .status-modal header { display: flex; align-items: center; justify-content: space-between; min-height: 2.75rem; padding: 0 .75rem 0 1rem; border-bottom: 1px solid var(--tk-border); color: var(--tk-text); }
    .status-modal h2 { margin: 0; font-size: .875rem; font-weight: 600; }.status-modal button { width: 2rem; height: 2rem; border: 0; border-radius: var(--tk-radius-md); background: transparent; color: var(--tk-text); font-size: 1.25rem; cursor: pointer; }.status-modal button:hover, .status-modal button:focus-visible { background: var(--tk-surface-2); outline: none; }.status-modal iframe { min-height: 0; flex: 1; border: 0; }
    .app-info-backdrop { position: fixed; inset: 0; z-index: 2147483646; display: grid; place-items: center; padding: 1rem; background: color-mix(in srgb, var(--tk-bg) 78%, transparent); backdrop-filter: blur(14px); }
    .app-info-modal { position: relative; width: min(100%, 23rem); max-height: calc(100dvh - 2rem); overflow: auto; border: 1px solid color-mix(in srgb, var(--tk-border) 72%, transparent); border-radius: 1.1rem; padding: 1.15rem; background: color-mix(in srgb, var(--tk-surface) 96%, transparent); color: var(--tk-text); box-shadow: 0 1.2rem 3.5rem color-mix(in srgb, var(--tk-bg) 65%, transparent); outline: none; }
    .app-info-close { position: absolute; top: .55rem; right: .55rem; width: 1.8rem; height: 1.8rem; border: 0; border-radius: 999px; background: transparent; color: var(--tk-text-muted, var(--tk-text)); font: 400 1.15rem/1 system-ui; cursor: pointer; }
    .app-info-hero { display: flex; align-items: center; gap: .85rem; padding-right: 1.75rem; }
    .app-info-icon { display: grid; width: 3.8rem; height: 3.8rem; flex: 0 0 auto; place-items: center; overflow: hidden; border: 1px solid color-mix(in srgb, var(--tk-border) 60%, transparent); border-radius: .95rem; background: linear-gradient(145deg, var(--tk-surface-2), var(--tk-surface)); box-shadow: 0 .45rem 1rem color-mix(in srgb, var(--tk-bg) 32%, transparent); }
    .app-info-icon img, .app-info-icon-svg, .app-info-icon-svg :global(svg) { display: block; width: 100%; height: 100%; object-fit: cover; }
    .app-info-initials { font-size: 1.25rem; font-weight: 720; letter-spacing: -.04em; color: var(--tk-text); }
    .app-info-eyebrow { margin: 0 0 .18rem; color: var(--tk-text-muted, var(--tk-text)); font-size: .62rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    .app-info-modal h2 { margin: 0; font-size: 1.15rem; letter-spacing: -.025em; }
    .app-info-version { margin: .18rem 0 0; color: var(--tk-text-muted, var(--tk-text)); font-size: .74rem; }
    .app-info-description { margin: .85rem 0 0; color: var(--tk-text-muted, var(--tk-text)); font-size: .82rem; line-height: 1.42; }
    .app-info-details { display: grid; margin-top: .9rem; overflow: hidden; border: 1px solid color-mix(in srgb, var(--tk-border) 70%, transparent); border-radius: .7rem; background: color-mix(in srgb, var(--tk-surface-2) 58%, transparent); }
    .app-info-row { display: grid; grid-template-columns: minmax(4.8rem, .72fr) minmax(0, 1.28fr); gap: .65rem; padding: .5rem .65rem; border-bottom: 1px solid color-mix(in srgb, var(--tk-border) 55%, transparent); }
    .app-info-row:last-child { border-bottom: 0; }
    .app-info-row dt { color: var(--tk-text-muted, var(--tk-text)); font-size: .69rem; font-weight: 600; }
    .app-info-row dd { min-width: 0; margin: 0; overflow-wrap: anywhere; color: var(--tk-text); font-size: .69rem; text-align: right; }
    .chat-info-icon { color: var(--tk-accent, var(--tk-text)); font-size: 1.25rem; }
    .chat-info-identifier { max-width: 100%; border: 0; padding: 0; background: transparent; color: inherit; font: inherit; text-align: right; text-decoration: underline; cursor: copy; overflow-wrap: anywhere; }
    .bag-sheet-message { margin: 1rem 0 0; color: var(--tk-text-muted, var(--tk-text)); font-size: .82rem; line-height: 1.45; }
    .bag-sheet-error { color: var(--tk-danger, #d14d4d); }
    .bag-sheet-summary { display: grid; gap: .35rem; margin-top: .9rem; padding: .7rem; border: 1px solid color-mix(in srgb, var(--tk-border) 70%, transparent); border-radius: .7rem; background: color-mix(in srgb, var(--tk-surface-2) 58%, transparent); }
    .bag-sheet-summary p { margin: 0; color: var(--tk-text); font-size: .84rem; font-weight: 600; line-height: 1.4; }
    .bag-sheet-summary span, .bag-sheet-steps small { color: var(--tk-text-muted, var(--tk-text)); font-size: .7rem; }
    .bag-sheet-steps { display: grid; gap: .5rem; margin: .8rem 0 0; padding: 0; list-style: none; }
    .bag-sheet-steps li { display: grid; grid-template-columns: 1.5rem minmax(0, 1fr); gap: .55rem; align-items: start; padding: .5rem; border: 1px solid color-mix(in srgb, var(--tk-border) 58%, transparent); border-radius: .65rem; }
    .bag-sheet-steps li.done { opacity: .7; }.bag-sheet-steps li.failed { border-color: color-mix(in srgb, var(--tk-danger, #d14d4d) 60%, var(--tk-border)); }
    .bag-step-state { display: grid; width: 1.5rem; height: 1.5rem; place-items: center; border-radius: 999px; background: var(--tk-surface-2); color: var(--tk-text-muted, var(--tk-text)); font-size: .68rem; font-weight: 700; }
    .bag-sheet-steps strong, .bag-sheet-steps small { display: block; }.bag-sheet-steps strong { color: var(--tk-text); font-size: .76rem; line-height: 1.35; }.bag-sheet-steps small { margin-top: .12rem; line-height: 1.35; }
    .widget-panel-toggle {
        position: fixed;
        bottom: 1.25rem;
        right: 1.25rem;
        z-index: 55;
        width: 2.5rem;
        height: 2.5rem;
        border-radius: 9999px;
        border: 1px solid var(--border);
        background: var(--surface-2);
        color: var(--txt-2);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: color 0.15s, border-color 0.15s;
    }
    .widget-panel-toggle:hover {
        color: var(--txt);
        border-color: var(--border-strong);
    }

    /* ── Top bar mobile ── */
    .mobile-topbar-dock {
        --mobile-topbar-height: calc(56px + var(--safe-top, env(safe-area-inset-top)));
        position: relative;
        z-index: 10;
        flex: 0 0 auto;
        height: var(--mobile-topbar-height);
        transition: height 280ms cubic-bezier(0.22, 0.75, 0.18, 1);
    }
    .mobile-topbar-dock::after {
        content: "";
        position: absolute;
        right: 0;
        bottom: 0;
        left: 0;
        z-index: 0;
        height: 18px;
        background: linear-gradient(to bottom, transparent, color-mix(in srgb, var(--bg) 28%, transparent));
        pointer-events: none;
        transition: opacity 180ms ease;
    }
    .mobile-topbar-dock.collapsed {
        /* Em fullscreen, o controle não reserva uma faixa do cabeçalho: ele
           flutua sobre o conteúdo, como as setas das laterais. */
        height: 0;
    }
    .mobile-topbar-dock.collapsed::after {
        opacity: 0;
    }
    .mobile-topbar {
        display: flex;
        align-items: center;
        gap: 8px;
        height: calc(56px + var(--safe-top, env(safe-area-inset-top)));
        padding: var(--safe-top, env(safe-area-inset-top)) 10px 0;
        position: absolute;
        inset: 0 0 auto;
        z-index: 1;
        border: 0;
        border-bottom: 1px solid color-mix(in srgb, var(--border) 52%, transparent);
        background: transparent;
        opacity: 1;
        transform: translateY(0);
        transition: transform 280ms cubic-bezier(0.22, 0.75, 0.18, 1), opacity 180ms ease;
    }
    .mobile-topbar.collapsed {
        opacity: 0;
        pointer-events: none;
        transform: translateY(calc(-1 * var(--mobile-topbar-height)));
    }
    .mobile-fullscreen-center {
        position: absolute;
        z-index: 2;
        top: 0;
        left: 50%;
        display: flex;
        height: 38px;
        align-items: center;
        justify-content: center;
        gap: 5px;
        transform: translateX(-50%);
    }
    .mobile-topbar-toggle {
        display: flex;
        width: 38px;
        height: 38px;
        align-items: center;
        justify-content: center;
        padding: 0;
        border: 0;
        border-radius: 0;
        background-color: transparent;
        box-shadow: none;
        color: var(--txt-2);
        opacity: 0.52;
        cursor: pointer;
        transition: color 150ms ease, opacity 150ms ease;
        -webkit-tap-highlight-color: transparent;
    }
    .mobile-topbar-toggle:active {
        color: var(--txt);
        opacity: 0.9;
    }
    .mobile-topbar-toggle:focus-visible {
        outline: 2px solid var(--border-strong);
        outline-offset: 2px;
    }
    /* Em tela cheia o cabeçalho deixa de ocupar espaço, mas os dois destinos
       de navegação continuam acessíveis no centro das bordas. A área de toque
       conserva o tamanho de uma aba mobile, embora a seta fique sem superfície
       própria. Ao abrir, ela percorre junto a borda exposta da gaveta. */
    .mobile-fullscreen-sidebar-controls {
        position: fixed;
        inset: 0;
        z-index: 25;
        pointer-events: none;
    }
    .mobile-fullscreen-sidebar-toggle {
        position: absolute;
        top: 50%;
        display: flex;
        width: 38px;
        height: 38px;
        align-items: center;
        justify-content: center;
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--txt-2);
        cursor: pointer;
        opacity: .42;
        pointer-events: auto;
        transform: translateY(-50%);
        transition: transform 320ms cubic-bezier(0.32, 0.72, 0, 1), color 180ms ease, opacity 180ms ease;
        -webkit-tap-highlight-color: transparent;
    }
    .mobile-fullscreen-sidebar-toggle-left {
        left: 0;
        border-radius: 0;
    }
    .mobile-fullscreen-sidebar-toggle-right {
        right: 0;
        border-radius: 0;
    }
    .mobile-fullscreen-sidebar-toggle svg {
        transition: transform 240ms ease-out;
    }
    .mobile-fullscreen-sidebar-toggle.open svg {
        transform: rotate(180deg);
    }
    .mobile-fullscreen-sidebar-toggle-left.open {
        transform: translate(min(86vw, 340px), -50%);
    }
    .mobile-fullscreen-sidebar-toggle-right.open {
        transform: translate(calc(-1 * min(92vw, 400px)), -50%);
    }
    .mobile-fullscreen-sidebar-toggle:active {
        color: var(--txt);
        opacity: 1;
    }
    .mobile-fullscreen-sidebar-toggle:focus-visible {
        outline: 2px solid var(--border-strong);
        outline-offset: 2px;
        opacity: 1;
    }
    .mtb-btn {
        width: 40px;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 12px;
        border: 1px solid transparent;
        background: transparent;
        color: var(--txt-2);
        cursor: pointer;
        flex-shrink: 0;
        -webkit-tap-highlight-color: transparent;
        transition: background 0.15s, color 0.15s, border-color 0.15s;
    }
    .mtb-btn:active {
        background: var(--w06);
        color: var(--txt);
        border-color: var(--border);
        transform: scale(0.93);
    }
    .mtb-title {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 0 6px;
        background: transparent;
        border: none;
        color: var(--txt);
        font-family: var(--font-body);
        font-size: 15px;
        font-weight: 600;
        letter-spacing: 0.01em;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
    }
    .mtb-title-text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .mtb-app-title {
        flex: 1;
        min-width: 0;
        padding: 0 6px;
        border: 0;
        background: transparent;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--txt);
        font: 600 15px var(--font-body);
        letter-spacing: 0.01em;
        text-align: center;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
    }
    .mtb-title:focus-visible,
    .mtb-app-title:focus-visible {
        outline: 2px solid var(--border-strong);
        outline-offset: 2px;
        border-radius: 4px;
    }
    .mtb-app-menu { position: relative; flex-shrink: 0; }
    .mtb-btn.active { background: var(--w06); color: var(--txt); border-color: var(--border); }
    .mtb-btn.refreshing { cursor: wait; }
    .mtb-btn.refreshing svg { animation: mtb-refresh-spin .7s linear infinite; }
    .mtb-btn:disabled { cursor: not-allowed; opacity: .48; }
    @keyframes mtb-refresh-spin { to { transform: rotate(360deg); } }
    .mtb-app-dropdown {
        position: absolute;
        top: calc(100% + 5px);
        right: 0;
        min-width: 158px;
        padding: 4px;
        border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
        border-radius: 10px;
        background: color-mix(in srgb, var(--bg) 94%, transparent);
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.18);
        backdrop-filter: blur(20px) saturate(1.15);
        animation: mtb-menu-in 160ms cubic-bezier(.22,.75,.18,1);
    }
    .mtb-menu-actions { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2px; }
    .mtb-header-action { min-height: 42px; text-align: left; }
    .mtb-header-action + .mtb-header-action { border-top: 1px solid color-mix(in srgb, var(--border) 52%, transparent); }
    .mtb-header-action > span { display: grid; gap: 2px; }
    .mtb-app-dropdown .mtb-menu-actions button {
        display: grid;
        width: 30px;
        height: 30px;
        min-height: 30px;
        place-items: center;
        padding: 0;
        border: 1px solid transparent;
        border-radius: 7px;
        color: var(--txt-2);
    }
    .mtb-app-dropdown .mtb-menu-actions button:hover, .mtb-app-dropdown .mtb-menu-actions button:focus-visible { border-color: color-mix(in srgb, var(--border) 72%, transparent); background: var(--w06); color: var(--txt); outline: none; }
    .mtb-menu-actions button svg { width: 15px; height: 15px; }
    .mtb-app-dropdown > button {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 9px;
        min-height: 36px;
        margin-top: 3px;
        padding: 6px;
        border: 0;
        border-radius: 7px;
        background: transparent;
        color: var(--txt);
        font: 500 12px var(--font-body);
        text-align: left;
        transition: background 140ms ease, transform 140ms ease;
    }
    .mtb-app-dropdown > button:hover, .mtb-app-dropdown > button:focus-visible { background: var(--w06); outline: none; }
    .mtb-app-dropdown > button:active { background: var(--w06); transform: scale(.985); }
    .mtb-app-dropdown button:disabled { cursor: wait; opacity: .62; }
    .mtb-menu-icon { display: grid; width: 32px; height: 32px; flex: 0 0 auto; place-items: center; border: 1px solid color-mix(in srgb, var(--border) 65%, transparent); border-radius: 9px; background: var(--w03); color: var(--txt-2); }
    .mtb-app-dropdown button > span:last-child { display: grid; gap: 2px; }
    .mtb-app-dropdown strong { font: 600 13px var(--font-body); }
    .mtb-app-dropdown small { color: var(--txt-3); font: 400 10px var(--font-body); }
    .mtb-session-id small { max-width: 148px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono, ui-monospace, monospace); }
    .mtb-app-dropdown svg { flex: 0 0 auto; }
    .mtb-app-dropdown svg.refreshing { animation: mtb-refresh-spin .7s linear infinite; }
    @keyframes mtb-menu-in { from { opacity: 0; transform: translateY(-4px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }

    @media (max-width: 767px) {
        .widget-panel-toggle {
            display: none;
        }
    }

    :global(*),
    :global(*::before),
    :global(*::after) {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
    }
    :global(body) {
        overflow: hidden;
        height: 100%;
        height: -webkit-fill-available;
    }
    :global(html) {
        height: 100%;
        height: -webkit-fill-available;
    }

    .shell {
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
        --tk-radius-md: 8px;
        --tk-radius-lg: 14px;
        --tk-font: 'Ubuntu', system-ui, sans-serif;
        --tk-mono: 'Ubuntu Mono', monospace;

        --bg: #111111;
        --surface: #111111;
        --surface-2: #181818;
        --bg-elevated: #151515;
        --border: rgba(255, 255, 255, 0.07);
        --border-hi: rgba(255, 255, 255, 0.14);
        --border-strong: rgba(255, 255, 255, 0.22);
        --txt: #f5f5f5;
        --txt-2: #888888;
        --txt-3: rgba(136, 136, 136, 0.45);
        --accent: #ffffff;
        --accent-dim: rgba(255, 255, 255, 0.06);
        --accent-2: #ffffff;
        --overlay-1: rgba(255, 255, 255, 0.03);
        --overlay-2: rgba(255, 255, 255, 0.06);
        --overlay-3: rgba(255, 255, 255, 0.1);
        --aurora-bg: var(--bg);
        --aurora-surface: var(--surface);
        --aurora-surface2: var(--surface-2);
        --aurora-border: var(--border);
        --aurora-border-hi: var(--border-hi);
        --aurora-text: var(--txt);
        --aurora-muted: var(--txt-2);
        --aurora-muted2: var(--txt-3);
        --aurora-teal: #ffffff;
        --aurora-violet: #cccccc;
        --aurora-pink: #aaaaaa;
        --aurora-glow: rgba(255, 255, 255, 0.06);
        --aurora-dim: rgba(255, 255, 255, 0.04);
        --btn-bg: rgba(255, 255, 255, 0.06);
        --btn-hover: rgba(255, 255, 255, 0.11);
        --user-bg: rgba(255, 255, 255, 0.05);
        --user-border: rgba(255, 255, 255, 0.1);
        --bot-bg: #111111;

        /* Generic white/black-wash opacity tokens for Sidebar/Apps/Sessions/
           InputBar2/SessionTabs — same values as Tailwind's white/[X]
           arbitrary opacities used throughout those components, but
           theme-reactive: white wash in dark mode, black wash in light. */
        --w01: rgba(255, 255, 255, 0.01);
        --w015: rgba(255, 255, 255, 0.015);
        --w018: rgba(255, 255, 255, 0.018);
        --w02: rgba(255, 255, 255, 0.02);
        --w025: rgba(255, 255, 255, 0.025);
        --w03: rgba(255, 255, 255, 0.03);
        --w04: rgba(255, 255, 255, 0.04);
        --w045: rgba(255, 255, 255, 0.045);
        --w05: rgba(255, 255, 255, 0.05);
        --w06: rgba(255, 255, 255, 0.06);
        --w07: rgba(255, 255, 255, 0.07);
        --w08: rgba(255, 255, 255, 0.08);
        --w09: rgba(255, 255, 255, 0.09);
        --w10: rgba(255, 255, 255, 0.1);
        --w12: rgba(255, 255, 255, 0.12);
        --w13: rgba(255, 255, 255, 0.13);
        --w14: rgba(255, 255, 255, 0.14);
        --w15: rgba(255, 255, 255, 0.15);
        --w18: rgba(255, 255, 255, 0.18);
        --w20: rgba(255, 255, 255, 0.2);
        --w22: rgba(255, 255, 255, 0.22);
        --w25: rgba(255, 255, 255, 0.25);
        --w30: rgba(255, 255, 255, 0.3);
        --w35: rgba(255, 255, 255, 0.35);
        --w40: rgba(255, 255, 255, 0.4);
        --w45: rgba(255, 255, 255, 0.45);
        --w50: rgba(255, 255, 255, 0.5);
        --w60: rgba(255, 255, 255, 0.6);
        --w70: rgba(255, 255, 255, 0.7);
        --w75: rgba(255, 255, 255, 0.75);
        --w80: rgba(255, 255, 255, 0.8);
        --w85: rgba(255, 255, 255, 0.85);
        --w90: rgba(255, 255, 255, 0.9);

        --r-lg: 14px;
        --r-md: 8px;
        /* Referenced throughout Sidebar.svelte as var(--radius-md/lg) — alias
           to the existing --r-* tokens instead of duplicating the value. */
        --radius-md: var(--r-md);
        --radius-lg: var(--r-lg);
        /* --tk-radius-* aliases — referenced by MenuList (New Topic) and
           InputBar2; same values as --radius-*, kept under the --tk-* name
           for consistency with the app-level design system. */
        --tk-radius-md: var(--r-md);
        --tk-radius-lg: var(--r-lg);

        /* Rail — Sidebar + mobile drawers. It shares the canonical theme
           ground. Package widgets are intentionally transparent, so a
           separate near-black token would leak through as a blue/navy band. */
        --rail-bg: var(--bg);
        --rail-surface: #1c1d20;
        --rail-flat: rgba(255, 255, 255, 0.03);
        --rail-flat-hover: rgba(255, 255, 255, 0.055);
        --rail-border: rgba(255, 255, 255, 0.06);
        --rail-border-hi: rgba(255, 255, 255, 0.14);
        --rail-txt: #f0f1f3;
        --rail-txt-2: #8b8e96;
        --rail-txt-3: rgba(139, 142, 150, 0.5);
        --rail-shadow-rest: 0 4px 14px -6px rgba(0, 0, 0, 0.55), 0 12px 26px -16px rgba(0, 0, 0, 0.45);
        --rail-shadow-hover: 0 8px 20px -8px rgba(0, 0, 0, 0.6), 0 16px 32px -18px rgba(0, 0, 0, 0.5);
        --rail-active: rgba(255, 255, 255, 0.07);
        --rail-active-ring: rgba(255, 255, 255, 0.16);
        --rail-emphasis: rgba(255, 255, 255, 0.09);
        --push-shadow: rgba(0, 0, 0, 0.4);

        /* Content-area floating objects (InputBar, tabs, chips) — softer
           than the rail shadow since the content ground is never as dark. */
        --shadow-soft: 0 4px 14px -6px rgba(0, 0, 0, 0.5), 0 12px 28px -16px rgba(0, 0, 0, 0.4);
        --shadow-soft-hover: 0 8px 20px -8px rgba(0, 0, 0, 0.55), 0 18px 36px -18px rgba(0, 0, 0, 0.45);

        --font-head: "DM Sans", system-ui, sans-serif;
        --font-body: "DM Sans", system-ui, sans-serif;
        --font-mono: "DM Mono", "Courier New", monospace;

        /* Bootstrap 5 loads globally (other packages use its components);
           every one of its utility classes is !important, and some share a
           name with a Tailwind utility used here (border, rounded, shadow*).
           Bootstrap reads its own color/radius/shadow through these vars, so
           pointing them at Agent's tokens reclaims those classes without
           touching every occurrence in the markup below. */
        --bs-border-color: var(--border);
        --bs-border-width: 1px;
        --bs-border-style: solid;
        --bs-border-radius: 0.25rem;
        --bs-box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);
        --bs-box-shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
        --bs-box-shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);

        display: flex;
         height: 100dvh;
        background: var(--bg);
        color: var(--txt);
        font-family: var(--font-body);
        font-size: 15px;
        position: relative;
        overflow: hidden;
    }

    /* Camadas transparentes de borda permitem que o fallback web comece até
       quando um app em iframe ocupa todo o conteúdo. Só existem com as
       gavetas fechadas, portanto não interferem na interação do sidebar. */
    .mobile-swipe-edge {
        position: fixed;
        z-index: 31;
        top: 0;
        bottom: 0;
        width: 24px;
        touch-action: pan-y;
    }
    .mobile-swipe-edge-left { left: 0; }
    .mobile-swipe-edge-right { right: 0; }

    /* A resposta SSR é desktop por padrão, porque não tem acesso ao viewport.
       Em uma tela que o Shell reconhece como mobile, não a exponha durante o
       intervalo até a hidratação. `layoutReady` é liberado no mesmo flush que
       troca `isMobile`, portanto a primeira pintura visível já é mobile. */
    @media (max-width: 767px), (pointer: coarse) {
        .shell:not(.layout-ready) {
            visibility: hidden;
        }
    }

    /* Light variant — same token names, DESIGN.md palette (soft neutrals,
       never pure black/white). Everything under .shell reads these through
       var(), so this is the only place a new theme needs color values. */
    .shell[data-theme="light"] {
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

        --bg: #fafafa;
        --surface: #ffffff;
        --surface-2: #f0f0f0;
        --bg-elevated: #ffffff;
        --border: rgba(0, 0, 0, 0.08);
        --border-hi: rgba(0, 0, 0, 0.14);
        --border-strong: rgba(0, 0, 0, 0.22);
        --txt: #1a1a1a;
        --txt-2: #6b6b6b;
        --txt-3: rgba(107, 107, 107, 0.55);
        --accent: #1a1a1a;
        --accent-dim: rgba(0, 0, 0, 0.06);
        --accent-2: #1a1a1a;
        --overlay-1: rgba(0, 0, 0, 0.03);
        --overlay-2: rgba(0, 0, 0, 0.06);
        --overlay-3: rgba(0, 0, 0, 0.1);
        --aurora-teal: #1a1a1a;
        --aurora-violet: #444444;
        --aurora-pink: #666666;
        --aurora-glow: rgba(0, 0, 0, 0.06);
        --aurora-dim: rgba(0, 0, 0, 0.04);
        --btn-bg: rgba(0, 0, 0, 0.05);
        --btn-hover: rgba(0, 0, 0, 0.09);
        --user-bg: rgba(0, 0, 0, 0.04);
        --user-border: rgba(0, 0, 0, 0.08);
        --bot-bg: #ffffff;

        --w01: rgba(0, 0, 0, 0.01);
        --w015: rgba(0, 0, 0, 0.015);
        --w018: rgba(0, 0, 0, 0.018);
        --w02: rgba(0, 0, 0, 0.02);
        --w025: rgba(0, 0, 0, 0.025);
        --w03: rgba(0, 0, 0, 0.03);
        --w04: rgba(0, 0, 0, 0.04);
        --w045: rgba(0, 0, 0, 0.045);
        --w05: rgba(0, 0, 0, 0.05);
        --w06: rgba(0, 0, 0, 0.06);
        --w07: rgba(0, 0, 0, 0.07);
        --w08: rgba(0, 0, 0, 0.08);
        --w09: rgba(0, 0, 0, 0.09);
        --w10: rgba(0, 0, 0, 0.1);
        --w12: rgba(0, 0, 0, 0.12);
        --w13: rgba(0, 0, 0, 0.13);
        --w14: rgba(0, 0, 0, 0.14);
        --w15: rgba(0, 0, 0, 0.15);
        --w18: rgba(0, 0, 0, 0.18);
        --w20: rgba(0, 0, 0, 0.2);
        --w22: rgba(0, 0, 0, 0.22);
        --w25: rgba(0, 0, 0, 0.25);
        --w30: rgba(0, 0, 0, 0.3);
        --w35: rgba(0, 0, 0, 0.35);
        --w40: rgba(0, 0, 0, 0.4);
        --w45: rgba(0, 0, 0, 0.45);
        --w50: rgba(0, 0, 0, 0.5);
        --w60: rgba(0, 0, 0, 0.6);
        --w70: rgba(0, 0, 0, 0.7);
        --w75: rgba(0, 0, 0, 0.75);
        --w80: rgba(0, 0, 0, 0.8);
        --w85: rgba(0, 0, 0, 0.85);
        --w90: rgba(0, 0, 0, 0.9);

        /* Rail in light theme is white — same family as the content, not a
           dark smudge — separated only by a hairline border. See the dark
           block above for why this isn't a fixed color across themes. */
        --rail-bg: #ffffff;
        --rail-surface: #f5f6f7;
        --rail-flat: rgba(16, 17, 20, 0.025);
        --rail-flat-hover: rgba(16, 17, 20, 0.045);
        --rail-border: rgba(16, 17, 20, 0.08);
        --rail-border-hi: rgba(16, 17, 20, 0.15);
        --rail-txt: #14151a;
        --rail-txt-2: #63666d;
        --rail-txt-3: rgba(99, 102, 109, 0.55);
        --rail-shadow-rest: 0 4px 14px -6px rgba(20, 20, 26, 0.10), 0 12px 26px -16px rgba(20, 20, 26, 0.08);
        --rail-shadow-hover: 0 8px 20px -8px rgba(20, 20, 26, 0.14), 0 16px 32px -18px rgba(20, 20, 26, 0.10);
        --rail-active: rgba(16, 17, 20, 0.05);
        --rail-active-ring: rgba(16, 17, 20, 0.14);
        --rail-emphasis: rgba(16, 17, 20, 0.055);
        --push-shadow: rgba(20, 20, 26, 0.14);

        --shadow-soft: 0 4px 14px -6px rgba(20, 20, 26, 0.10), 0 12px 26px -16px rgba(20, 20, 26, 0.08);
        --shadow-soft-hover: 0 8px 20px -8px rgba(20, 20, 26, 0.14), 0 16px 32px -18px rgba(20, 20, 26, 0.10);
    }

    /* The Σ mark — Agent's brand chip, used in Sidebar's header, the
       Agent entry in Apps.svelte's grid, and the Agent tab in
       SessionTabs.svelte. Global (not scoped) since it's applied from
       several sibling components. Fixed black/white regardless of theme —
       it's identity, not themed UI — with a very rounded square and a
       glyph sized down from the box to read as generously padded. */
    :global(.shell .sigma-mark) {
        background: #050505;
        color: #ffffff;
        font-family: "Ubuntu", -apple-system, "Segoe UI", sans-serif;
        border-radius: 30%;
        box-shadow: var(--rail-shadow-rest);
        transition: transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.18s ease;
    }
    :global(.shell .sigma-mark:hover) { transform: translateY(-2px); box-shadow: var(--rail-shadow-hover); }

    /* Bootstrap's spacing utilities (p-, m-, gap- variants) hardcode rem
       values with !important instead of reading a var, and their 0-5 scale
       collides by name with Tailwind's, so the border/shadow var-bridge
       above can't reach them — each colliding class needs its Tailwind
       value restored directly, scoped under .shell so nothing outside
       Agent is touched. */
    :global(.shell .p-0) { padding: 0 !important; }
    :global(.shell .p-1) { padding: 0.25rem !important; }
    :global(.shell .p-2) { padding: 0.5rem !important; }
    :global(.shell .p-3) { padding: 0.75rem !important; }
    :global(.shell .p-4) { padding: 1rem !important; }
    :global(.shell .p-5) { padding: 1.25rem !important; }

    :global(.shell .px-0) { padding-inline: 0 !important; }
    :global(.shell .px-1) { padding-inline: 0.25rem !important; }
    :global(.shell .px-2) { padding-inline: 0.5rem !important; }
    :global(.shell .px-3) { padding-inline: 0.75rem !important; }
    :global(.shell .px-4) { padding-inline: 1rem !important; }
    :global(.shell .px-5) { padding-inline: 1.25rem !important; }

    :global(.shell .py-0) { padding-block: 0 !important; }
    :global(.shell .py-1) { padding-block: 0.25rem !important; }
    :global(.shell .py-2) { padding-block: 0.5rem !important; }
    :global(.shell .py-3) { padding-block: 0.75rem !important; }
    :global(.shell .py-4) { padding-block: 1rem !important; }
    :global(.shell .py-5) { padding-block: 1.25rem !important; }

    :global(.shell .pt-0) { padding-top: 0 !important; }
    :global(.shell .pt-1) { padding-top: 0.25rem !important; }
    :global(.shell .pt-2) { padding-top: 0.5rem !important; }
    :global(.shell .pt-3) { padding-top: 0.75rem !important; }
    :global(.shell .pt-4) { padding-top: 1rem !important; }
    :global(.shell .pt-5) { padding-top: 1.25rem !important; }

    :global(.shell .pb-0) { padding-bottom: 0 !important; }
    :global(.shell .pb-1) { padding-bottom: 0.25rem !important; }
    :global(.shell .pb-2) { padding-bottom: 0.5rem !important; }
    :global(.shell .pb-3) { padding-bottom: 0.75rem !important; }
    :global(.shell .pb-4) { padding-bottom: 1rem !important; }
    :global(.shell .pb-5) { padding-bottom: 1.25rem !important; }

    :global(.shell .m-0) { margin: 0 !important; }
    :global(.shell .m-1) { margin: 0.25rem !important; }
    :global(.shell .m-2) { margin: 0.5rem !important; }
    :global(.shell .m-3) { margin: 0.75rem !important; }
    :global(.shell .m-4) { margin: 1rem !important; }
    :global(.shell .m-5) { margin: 1.25rem !important; }

    :global(.shell .mx-0) { margin-inline: 0 !important; }
    :global(.shell .mx-1) { margin-inline: 0.25rem !important; }
    :global(.shell .mx-2) { margin-inline: 0.5rem !important; }
    :global(.shell .mx-3) { margin-inline: 0.75rem !important; }
    :global(.shell .mx-4) { margin-inline: 1rem !important; }
    :global(.shell .mx-5) { margin-inline: 1.25rem !important; }

    :global(.shell .my-0) { margin-block: 0 !important; }
    :global(.shell .my-1) { margin-block: 0.25rem !important; }
    :global(.shell .my-2) { margin-block: 0.5rem !important; }
    :global(.shell .my-3) { margin-block: 0.75rem !important; }
    :global(.shell .my-4) { margin-block: 1rem !important; }
    :global(.shell .my-5) { margin-block: 1.25rem !important; }

    :global(.shell .mt-0) { margin-top: 0 !important; }
    :global(.shell .mt-1) { margin-top: 0.25rem !important; }
    :global(.shell .mt-2) { margin-top: 0.5rem !important; }
    :global(.shell .mt-3) { margin-top: 0.75rem !important; }
    :global(.shell .mt-4) { margin-top: 1rem !important; }
    :global(.shell .mt-5) { margin-top: 1.25rem !important; }

    :global(.shell .mb-0) { margin-bottom: 0 !important; }
    :global(.shell .mb-1) { margin-bottom: 0.25rem !important; }
    :global(.shell .mb-2) { margin-bottom: 0.5rem !important; }
    :global(.shell .mb-3) { margin-bottom: 0.75rem !important; }
    :global(.shell .mb-4) { margin-bottom: 1rem !important; }
    :global(.shell .mb-5) { margin-bottom: 1.25rem !important; }

    :global(.shell .gap-0) { gap: 0 !important; }
    :global(.shell .gap-1) { gap: 0.25rem !important; }
    :global(.shell .gap-2) { gap: 0.5rem !important; }
    :global(.shell .gap-3) { gap: 0.75rem !important; }
    :global(.shell .gap-4) { gap: 1rem !important; }
    :global(.shell .gap-5) { gap: 1.25rem !important; }

    /* ── Loading ── */
    .loading-screen {
        position: fixed;
        inset: 0;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: var(--bg);
        color: var(--txt);
        font-family: var(--font-body);
    }
    @keyframes shimmer {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(100%); }
    }

    /* ── Offline toast ── */
    .offline-toast {
        position: fixed;
        top: 16px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 9000;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 9px 18px;
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-radius: 24px;
        backdrop-filter: blur(12px);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        animation: toast-in 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        white-space: nowrap;
    }
    @keyframes toast-in {
        from {
            opacity: 0;
            transform: translateX(-50%) translateY(-10px);
        }
        to {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }
    }
    .offline-shimmer {
        width: 40px;
        height: 3px;
        border-radius: 2px;
        background: var(--overlay-1);
        overflow: hidden;
        flex-shrink: 0;
        position: relative;
    }
    .offline-shimmer::after {
        content: "";
        position: absolute;
        inset: 0;
        background: linear-gradient(90deg, transparent 0%, var(--overlay-2) 50%, transparent 100%);
        animation: shimmer 1.6s ease-in-out infinite;
    }
    .offline-text {
        font-family: var(--font-mono);
        font-size: 11px;
        color: var(--txt-2);
        letter-spacing: 0.06em;
    }
    .offline-dot-row {
        display: flex;
        gap: 3px;
        align-items: center;
    }
    .off-dot {
        width: 3px;
        height: 3px;
        border-radius: 50%;
        background: var(--w30, rgba(255, 255, 255, 0.3));
        animation: off-pulse 1.4s ease-in-out infinite;
    }
    .off-dot:nth-child(2) {
        animation-delay: 0.18s;
    }
    .off-dot:nth-child(3) {
        animation-delay: 0.36s;
    }
    @keyframes off-pulse {
        0%,
        80%,
        100% {
            opacity: 0.15;
            transform: scale(0.8);
        }
        40% {
            opacity: 0.85;
            transform: scale(1.1);
        }
    }

    /* ── Background ── */
    .bg-layer {
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 0;
    }
    .bg-noise {
        position: absolute;
        inset: 0;
        opacity: 0.025;
        background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
        background-size: 128px 128px;
    }

    /* ── Main ── */
    .main-area {
        position: relative;
        z-index: 20;
        flex: 1;
        /* Sidebar emits two sibling slots. The explicit ordering makes the
           desktop composition stable: left rail, content, right rail. */
        order: 1;
        display: flex;
        flex-direction: column;
        height: 100dvh;
        overflow: hidden;
        min-width: 0;
        background: var(--bg);
        transform: translateX(0);
        transition: transform 0.32s cubic-bezier(0.32, 0.72, 0, 1), box-shadow 0.32s cubic-bezier(0.32, 0.72, 0, 1);
    }
    /* The desktop rails are rendered by Sidebar as sibling slots. Declare the
       available width here too, rather than relying only on flex shrink: the
       tab strip is absolutely positioned within its slot and must never draw
       beneath the right rail while it is open or resized. */
    @media (min-width: 769px) {
        .main-area {
            flex: 0 0 calc(100% - var(--shell-left-rail, 0px) - var(--shell-right-rail, 0px));
            width: calc(100% - var(--shell-left-rail, 0px) - var(--shell-right-rail, 0px));
        }
    }
    .shell.floating-shell .main-area {
        width: 100%;
        height: 100%;
    }
    /* Push mechanic — the mobile Sidebar panels (Sidebar.svelte, z-index 10)
       sit behind .main-area at rest; opening one shifts the content by
       exactly the panel's own width so the panel is revealed underneath,
       not overlaid with a scrim. */
    .main-area.push-left {
        transform: translateX(min(86vw, 340px));
        box-shadow: -14px 0 28px -16px var(--push-shadow);
        /* Keep the drawer above the shifted page so its controls stay clickable. */
        z-index: 5;
    }
    .main-area.push-right {
        transform: translateX(calc(-1 * min(92vw, 400px)));
        box-shadow: 14px 0 28px -16px var(--push-shadow);
        z-index: 5;
    }
    .push-catcher {
        position: absolute;
        inset: 0;
        z-index: 30;
        border: none;
        background: transparent;
        cursor: pointer;
        padding: 0;
    }
    .tab-content {
        flex: 1;
        position: relative;
        overflow: hidden;
    }
    .chat-panel {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        transition: opacity 0.15s;
    }
    .mobile-history-expand {
        position: relative;
        z-index: 2;
        flex: 0 0 auto;
        align-self: center;
        margin: 8px 12px 0;
        padding: 7px 12px;
        border: 1px solid var(--rail-border);
        border-radius: 999px;
        background: var(--rail-bg);
        color: var(--rail-txt-2);
        font: inherit;
        font-size: 11px;
        cursor: pointer;
    }
    .mobile-history-expand:disabled {
        cursor: wait;
        opacity: 0.65;
    }
    .chat-panel :global(.ml-root) { padding-bottom: var(--composer-reserve, 122px); }
    .chat-panel.hidden {
        opacity: 0;
        pointer-events: none;
    }
</style>
