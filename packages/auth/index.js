import './runtime/config.js';
// Public composition and compatibility boundary. Registration lives in adapters/.
import { startSession as startSessionHandler } from './services/browser-sessions.js';
import { identityProvider } from './services/identity.js';
import { provisionInitialAdmin, manageUserCommand } from './services/local-users.js';
import { npmGroupsFor } from './services/registry-devices.js';
import { accessGate as accessGateHandler } from './services/access-gate.js';
import { hashPassword as hashPasswordHandler } from './services/password-login.js';

export { authorizeRequest, requirePermission } from './authorization.js';

export { isPublicPath, requiredDelegatedCapability, expectsHtmlDocument } from './services/access-gate.js';

export { mcpAuth } from './services/mcp-administration.js';



export function hashPassword(password) {
    return hashPasswordHandler(password);
}

export async function accessGate(req, res, next) {
    return accessGateHandler(req, res, next);
}

export async function startSession(req, res, userId) {
    return startSessionHandler(req, res, userId);
}

export { identityProvider, npmGroupsFor, provisionInitialAdmin, manageUserCommand };

export { login, logout, getUser, initialSetupStatus, createInitialAdmin, googleStart, googleCallback, ticket, enter, enterDistributedApp, issueDelegatedTicket, consumeDelegatedTicket } from './adapters/authentication.js';
export { listUsers, updateUser, deleteUser, createAccount, saveOnboarding, getOnboardingByProxyToken } from './adapters/users.js';
export { routerNpmWorkspace, routerNpmCatalog, routerNpmCreateToken, routerNpmListTokens, routerNpmRevokeToken, routerNpmAuthenticate, routerNpmRegisterPackage, routerNpmDeletePackage, routerNpmAccess, routerNpmDeviceStart, routerNpmDeviceApprove, routerNpmDevicePoll, routerNotifyPairDevice, routerNotifyAuthorize } from './adapters/registry.js';
export { systemView, systemAction, routerPermissionsOverview, routerPermissionsCatalog, routerPermissionsCreateGroup, routerPermissionsUpdateGroup, routerPermissionsDeleteGroup, routerSystemTabs, routerPermissionsAddMember, routerPermissionsDeleteMember, routerPermissionsCreateGrant, routerPermissionsCreateFullPackageGrant, routerPermissionsDeleteGrant, routerPermissionsForUser, routerPermissionsAudit, routerMcpIssue, routerMcpCredentials, routerMcpRevoke } from './adapters/administration.js';
export { setupUser, credentialVerify, onResolveProxyToken, onRecordProxySpend, onGetAdminUser, createUserCommand, addUserCommand, listUsersCommand, getUserCommand, updateUserCommand, disableUserCommand, enableUserCommand } from './adapters/lifecycle.js';
