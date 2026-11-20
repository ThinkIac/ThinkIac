import { createWorkspacePersistence } from './workspace_persistence.js';
import { createRecentSessions } from './recent_sessions.js';
import { createSessionTabs } from './session_tabs.js';
import { createMobileNavigation } from './mobile_navigation.js';
import { createAppNavigation } from './app_navigation.js';
import { createAppTabs } from './app_tabs.js';
import { createDesktopIntegration } from './desktop_integration.js';
import { createWidgetBus } from './widget_bus.js';
import { createConnectionStatus } from './connection_status.js';
import { createMobileControls } from './mobile_controls.js';
import { createChatTools } from './chat_tools.js';
import { createAppDetails } from './app_details.js';
import { createComposerLayout } from './composer_layout.js';
import { createDesktopShortcuts } from './desktop_shortcuts.js';
import { createStructuredMessages } from './structured_messages.js';
import { createShellLifecycle } from './shell_lifecycle.js';
import { createChatEvents } from './chat_events.js';
import { createSessionLoading } from './session_loading.js';
import { createChatCommands } from './chat_commands.js';

// Copy accessor descriptors without reading browser globals or uninitialized state.
function selectState(state, keys) {
    return Object.defineProperties({}, Object.fromEntries(keys.map(key => [key, Object.getOwnPropertyDescriptor(state, key)])));
}

/** Compose independent controllers. Creation is safe during SSR. */
export function createShellControllers({ state, services }) {
    const workspacePersistenceController = createWorkspacePersistence({
        state: selectState(state, [
            "activeIsApp", "activeTab", "appTabs", "mobileNavigation", "sessionCache",
            "sessionId", "shellScope", "tabOrder", "tabs", "unreadMap",
        ]),
        deps: {
            get normalizeTabOrder() { return services.normalizeTabOrder; },
            get restoreSessionState() { return services.restoreSessionState; },
            get saveSessionState() { return services.saveSessionState; },
        },
    });

    const recentSessionsController = createRecentSessions({
        state: selectState(state, [
            "RECENT_SESSIONS_BATCH_SIZE", "activeAgentId", "activeIsApp", "activeTab", "history",
            "initialId", "recentSessions", "recentSessionsLoading", "recentSessionsRequested", "recentSessionsVisibleCount",
            "sessionCache", "sessionId", "tabs",
        ]),
        deps: {
            get activateSession() { return sessionLoading.activateSession; },
            get agentRuntime() { return services.agentRuntime; },
            get fullSaveSessionState() { return workspacePersistenceController.fullSaveSessionState; },
            get markChatRead() { return chatEvents.markChatRead; },
            get recordMobileNavigation() { return mobileNavigationController.recordMobileNavigation; },
        },
    });

    const sessionTabsController = createSessionTabs({
        state: selectState(state, [
            "activeIsApp", "activeTab", "appTabs", "history", "isMobile",
            "loadingMap", "refreshTrigger", "sessionCache", "sessionId", "sessionPreferences",
            "tabOrder", "tabs", "unreadMap",
        ]),
        deps: {
            get activateSession() { return sessionLoading.activateSession; },
            get agentRuntime() { return services.agentRuntime; },
            get closeAllChatTabs() { return services.closeAllChatTabs; },
            get closeChatTab() { return services.closeChatTab; },
            get closePanel() { return mobileControlsController.closePanel; },
            get createNewTopicWorkspace() { return services.createNewTopicWorkspace; },
            get fetch() { return services.fetch; },
            get fullSaveSessionState() { return workspacePersistenceController.fullSaveSessionState; },
            get markChatRead() { return chatEvents.markChatRead; },
            get moveTab() { return services.moveTab; },
            get recordMobileNavigation() { return mobileNavigationController.recordMobileNavigation; },
        },
    });

    const mobileNavigationController = createMobileNavigation({
        state: selectState(state, [
            "activeIsApp", "activeTab", "appLoadingMap", "appMenuOpen", "appTabs",
            "canGoBackMobile", "chatMenuOpen", "history", "isMobile", "loadingMap",
            "mobileForwardNavigation", "mobileNavigation", "sessionCache", "sessionId", "tabOrder",
            "tabs", "unreadMap",
        ]),
        deps: {
            get activateSession() { return sessionLoading.activateSession; },
            get closePanel() { return mobileControlsController.closePanel; },
            get dismissMobileMenus() { return mobileControlsController.dismissMobileMenus; },
            get fullSaveSessionState() { return workspacePersistenceController.fullSaveSessionState; },
            get historyStateWithMobileDestination() { return services.historyStateWithMobileDestination; },
            get mobileDestinationFromHistoryState() { return services.mobileDestinationFromHistoryState; },
            get window() { return services.window; },
        },
    });

    const appNavigationController = createAppNavigation({
        state: selectState(state, [
            "activeIsApp", "activeTab", "appTabs", "isMobile", "tabs",
        ]),
        deps: {
            get activateSession() { return sessionLoading.activateSession; },
            get api() { return services.api; },
            get closePanel() { return mobileControlsController.closePanel; },
            get filePreviewUrl() { return services.filePreviewUrl; },
            get handleOpenApp() { return appTabsController.handleOpenApp; },
            get recordMobileNavigation() { return mobileNavigationController.recordMobileNavigation; },
        },
    });

    const appTabsController = createAppTabs({
        state: selectState(state, [
            "APP_LOAD_FALLBACK_MS", "activeIsApp", "activeTab", "appLoadTimers", "appLoadingMap",
            "appMenuOpen", "appRefreshingMap", "appReloadKeys", "appTabs", "iframeRefs",
            "isMobile", "sessionCache", "sessionId", "tabs",
        ]),
        deps: {
            get activateSession() { return sessionLoading.activateSession; },
            get closeAllAppTabs() { return services.closeAllAppTabs; },
            get closePanel() { return mobileControlsController.closePanel; },
            get fullSaveSessionState() { return workspacePersistenceController.fullSaveSessionState; },
            get reconcileSession() { return sessionLoading.reconcileSession; },
            get recordMobileNavigation() { return mobileNavigationController.recordMobileNavigation; },
        },
    });

    const desktopIntegrationController = createDesktopIntegration({
        state: selectState(state, [
            "activeAgentId", "activeIsApp", "activeTab", "agentId", "appTabs",
            "desktopHost", "desktopSession", "handoff", "history", "loadingMap",
            "refreshTrigger", "sessionId", "shellControlApps", "tabs", "unreadMap",
        ]),
        deps: {
            get agentRuntime() { return services.agentRuntime; },
            get api() { return services.api; },
            get applyDefaultModelToNewSession() { return sessionTabsController.applyDefaultModelToNewSession; },
            get createNewTopicWorkspace() { return services.createNewTopicWorkspace; },
            get generateSessionId() { return sessionTabsController.generateSessionId; },
            get handleOpenApp() { return appTabsController.handleOpenApp; },
            get installShellControlBridge() { return services.installShellControlBridge; },
            get localStorage() { return services.localStorage; },
            get send() { return chatCommands.send; },
            get tick() { return services.tick; },
            get window() { return services.window; },
            get writeSessionAgent() { return services.writeSessionAgent; },
        },
    });

    const widgetBusController = createWidgetBus({
        state: selectState(state, [
            "busOffs", "sessionId", "statusModal",
        ]),
        deps: {
            get FILE_MANAGER_PREVIEW_EVENT() { return services.FILE_MANAGER_PREVIEW_EVENT; },
            get abrirAppComPath() { return appNavigationController.abrirAppComPath; },
            get abrirAppPorDeepLink() { return appNavigationController.abrirAppPorDeepLink; },
            get abrirAppPorPacote() { return appNavigationController.abrirAppPorPacote; },
            get abrirChatPorDeepLink() { return appNavigationController.abrirChatPorDeepLink; },
            get abrirIframe() { return appNavigationController.abrirIframe; },
            get abrirPreviewNoFileManager() { return appNavigationController.abrirPreviewNoFileManager; },
            get abrirResultadoPorDeepLink() { return appNavigationController.abrirResultadoPorDeepLink; },
            get agentRuntime() { return services.agentRuntime; },
            get bootstrapMessageActions() { return services.bootstrapMessageActions; },
            get bootstrapPackageWidgets() { return services.bootstrapPackageWidgets; },
            get busOn() { return services.busOn; },
            get handleOpenCanvas() { return services.handleOpenCanvas; },
            get send() { return chatCommands.send; },
            get setGlobalLoading() { return connectionStatusController.setGlobalLoading; },
            get setServerForwarder() { return services.setServerForwarder; },
            get window() { return services.window; },
        },
    });

    const connectionStatusController = createConnectionStatus({
        state: selectState(state, [
            "globalLoading", "globalLoadingTimer", "isOnline", "reconnectTimer", "reconnecting",
            "system", "wasOffline",
        ]),
        deps: {
            get agentRuntime() { return services.agentRuntime; },
            get api() { return services.api; },
            get fullSaveSessionState() { return workspacePersistenceController.fullSaveSessionState; },
            get window() { return services.window; },
        },
    });

    const mobileControlsController = createMobileControls({
        state: selectState(state, [
            "activeIsApp", "activeTab", "appMenuOpen", "appRefreshingMap", "chatMenuOpen",
            "chatRefreshing", "gestureOffs", "iframeRefs", "isMobile", "mobileHeaderCollapsed",
            "mobilePanel", "nativeApp", "refreshTrigger", "shellEl",
        ]),
        deps: {
            get createGestureRouter() { return services.createGestureRouter; },
            get createIframeGestureBridge() { return services.createIframeGestureBridge; },
            get installEdgeSwipeDetector() { return services.installEdgeSwipeDetector; },
            get installNativeGestureBridge() { return services.installNativeGestureBridge; },
            get maybeLoadRecentSessions() { return recentSessionsController.maybeLoadRecentSessions; },
            get refreshChat() { return appTabsController.refreshChat; },
            get reloadApp() { return appTabsController.reloadApp; },
            get window() { return services.window; },
        },
    });

    const chatToolsController = createChatTools({
        state: selectState(state, [
            "activeIsApp", "activeTab", "appTabs", "bagError", "bagLoading",
            "bagSheetOpen", "bagStatus", "chatFeatureAvailability", "chatInfoOpen", "chatMenuMessage",
            "chatMenuMessageTimer", "chatMenuOpen", "sessionId",
        ]),
        deps: {
            get api() { return services.api; },
            get handleOpenApp() { return appTabsController.handleOpenApp; },
            get navigator() { return services.navigator; },
        },
    });

    const appDetailsController = createAppDetails({
        state: selectState(state, [
            "activeAppInfo", "activeTab", "appInfoOpen", "appInfoTarget", "appMenuOpen",
            "headerActionCatalog", "iframeRefs",
        ]),
        deps: {
            get api() { return services.api; },
            get headerActionMessage() { return services.headerActionMessage; },
            get window() { return services.window; },
        },
    });

    const composerLayoutController = createComposerLayout({
        state: selectState(state, [
            "composerDockHeight", "composerStage",
        ]),
        deps: {
            get tick() { return services.tick; },
            get window() { return services.window; },
        },
    });

    const desktopShortcutsController = createDesktopShortcuts({
        state: selectState(state, [
            "activeTab", "allTabs", "canvasOpen", "isMobile", "rightSidebarCollapsed",
            "sidebarCollapsed",
        ]),
        deps: {
            get adjacentTabId() { return services.adjacentTabId; },
            get busEmit() { return services.busEmit; },
            get desktopShortcutAction() { return services.desktopShortcutAction; },
            get handleCloseAllApps() { return appTabsController.handleCloseAllApps; },
            get handleCloseAllChats() { return sessionTabsController.handleCloseAllChats; },
            get handleCloseTab() { return sessionTabsController.handleCloseTab; },
            get handleSelectTab() { return sessionTabsController.handleSelectTab; },
            get isEditableShortcutTarget() { return services.isEditableShortcutTarget; },
            get isTextEditingShortcut() { return services.isTextEditingShortcut; },
            get refreshActive() { return appTabsController.refreshActive; },
            get refreshAllTabs() { return appTabsController.refreshAllTabs; },
        },
    });

    const structuredMessagesController = createStructuredMessages({
        state: selectState(state, [
            "history", "lastMessage", "structuredProps",
        ]),
        deps: {
            get extractAttachmentRefs() { return services.extractAttachmentRefs; },
            get extractStructuredInput() { return services.extractStructuredInput; },
            get mergeAttachments() { return services.mergeAttachments; },
        },
    });

    const shellLifecycleController = createShellLifecycle({
        state: selectState(state, [
            "activeAgentId", "activeIsApp", "app", "busOffs", "composerStage",
            "desktopHost", "file", "floatingShell", "gestureOffs", "globalLoadingTimer",
            "history", "layoutReady", "listen", "nativeApp", "open",
            "pkg", "reconnectTimer", "refreshTrigger", "session", "sessionId",
            "shellDesktopControl", "showLoading", "tabs", "theme", "title",
            "url",
        ]),
        deps: {
            get CustomEvent() { return services.CustomEvent; },
            get abrirAppPorDeepLink() { return appNavigationController.abrirAppPorDeepLink; },
            get abrirCaminhoInterno() { return appNavigationController.abrirCaminhoInterno; },
            get abrirChatPorDeepLink() { return appNavigationController.abrirChatPorDeepLink; },
            get abrirResultadoPorDeepLink() { return appNavigationController.abrirResultadoPorDeepLink; },
            get activateSession() { return sessionLoading.activateSession; },
            get agentRuntime() { return services.agentRuntime; },
            get applyChatEvent() { return chatEvents.applyChatEvent; },
            get bootstrapBackgroundViews() { return services.bootstrapBackgroundViews; },
            get bootstrapHeaderActions() { return appDetailsController.bootstrapHeaderActions; },
            get bootstrapMenuItems() { return services.bootstrapMenuItems; },
            get busEmitLocal() { return services.busEmitLocal; },
            get checkMobile() { return mobileControlsController.checkMobile; },
            get consumeDesktopHandoff() { return desktopIntegrationController.consumeDesktopHandoff; },
            get disposeBackgroundViews() { return services.disposeBackgroundViews; },
            get document() { return services.document; },
            get fullRestoreSessionState() { return workspacePersistenceController.fullRestoreSessionState; },
            get fullSaveSessionState() { return workspacePersistenceController.fullSaveSessionState; },
            get getTheme() { return services.getTheme; },
            get handleMobileBrowserBack() { return mobileNavigationController.handleMobileBrowserBack; },
            get handleOffline() { return connectionStatusController.handleOffline; },
            get handleOnline() { return connectionStatusController.handleOnline; },
            get handleSelectSession() { return sessionTabsController.handleSelectSession; },
            get handleStop() { return chatCommands.handleStop; },
            get installShellDesktopControl() { return desktopIntegrationController.installShellDesktopControl; },
            get isHostedByDesktop() { return services.isHostedByDesktop; },
            get loadChatFeatureAvailability() { return chatToolsController.loadChatFeatureAvailability; },
            get loadSessionPreferences() { return sessionTabsController.loadSessionPreferences; },
            get loadSystem() { return connectionStatusController.loadSystem; },
            get loadWorkspace() { return sessionTabsController.loadWorkspace; },
            get localStorage() { return services.localStorage; },
            get maybeLoadRecentSessions() { return recentSessionsController.maybeLoadRecentSessions; },
            get measureComposerDock() { return composerLayoutController.measureComposerDock; },
            get navigator() { return services.navigator; },
            get openDesktopComposition() { return desktopIntegrationController.openDesktopComposition; },
            get postEdgeStatus() { return connectionStatusController.postEdgeStatus; },
            get publishBackgroundContext() { return services.publishBackgroundContext; },
            get readSessionAgent() { return services.readSessionAgent; },
            get reconcileSession() { return sessionLoading.reconcileSession; },
            get replaceMobileBrowserHistoryEntry() { return mobileNavigationController.replaceMobileBrowserHistoryEntry; },
            get setupGestureProtocol() { return mobileControlsController.setupGestureProtocol; },
            get setupWidgetBus() { return widgetBusController.setupWidgetBus; },
            get tick() { return services.tick; },
            get window() { return services.window; },
        },
    });

    const chatEvents = createChatEvents({
        state: selectState(state, [
            "activeIsApp", "activeTab", "cursorMap", "history", "listRef",
            "loadingMap", "sessionCache", "sessionId", "unreadMap",
        ]),
        deps: {
            get busEmitLocal() { return services.busEmitLocal; },
            get extractAttachmentRefs() { return services.extractAttachmentRefs; },
            get processAssistantMessage() { return structuredMessagesController.processAssistantMessage; },
            get window() { return services.window; },
        },
    });

    const sessionLoading = createSessionLoading({
        state: selectState(state, [
            "activeAgentId", "activeIsApp", "cursorMap", "history", "historyTruncated",
            "isMobile", "listRef", "loadingFullHistory", "loadingMap", "reconcileGeneration",
            "sessionActivation", "sessionCache", "sessionId",
        ]),
        deps: {
            get agentRuntime() { return services.agentRuntime; },
            get api() { return services.api; },
            get applyChatEvent() { return chatEvents.applyChatEvent; },
            get busEmitLocal() { return services.busEmitLocal; },
            get fetch() { return services.fetch; },
            get localStorage() { return services.localStorage; },
            get markChatUnread() { return chatEvents.markChatUnread; },
            get readSessionAgent() { return services.readSessionAgent; },
            get sanitizeHistoryMessages() { return services.sanitizeHistoryMessages; },
            get tick() { return services.tick; },
        },
    });

    const chatCommands = createChatCommands({
        state: selectState(state, [
            "lastMessage", "cursorMap", "history", "listRef", "loadingMap",
            "message", "reconcileGeneration", "refreshTrigger", "sessionCache", "sessionId",
            "structuredProps", "tabs",
        ]),
        deps: {
            get activateSession() { return sessionLoading.activateSession; },
            get api() { return services.api; },
            get busEmit() { return services.busEmit; },
            get busEmitLocal() { return services.busEmitLocal; },
            get clearComposerDraft() { return services.clearComposerDraft; },
            get ensureStreamingAssistant() { return chatEvents.ensureStreamingAssistant; },
            get fetch() { return services.fetch; },
            get insertUserMessage() { return chatEvents.insertUserMessage; },
            get retryTurnInput() { return services.retryTurnInput; },
            get tick() { return services.tick; },
            get updateSessionHistory() { return chatEvents.updateSessionHistory; },
        },
    });

    return {
        ...workspacePersistenceController,
        ...recentSessionsController,
        ...sessionTabsController,
        ...mobileNavigationController,
        ...appNavigationController,
        ...appTabsController,
        ...desktopIntegrationController,
        ...widgetBusController,
        ...connectionStatusController,
        ...mobileControlsController,
        ...chatToolsController,
        ...appDetailsController,
        ...composerLayoutController,
        ...desktopShortcutsController,
        ...structuredMessagesController,
        ...shellLifecycleController,
        ...chatEvents,
        ...sessionLoading,
        ...chatCommands,
    };
}
