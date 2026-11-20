import '../runtime/config.js';
import { routerPermissionsOverview as routerPermissionsOverviewHandler, routerPermissionsCatalog as routerPermissionsCatalogHandler, routerPermissionsCreateGroup as routerPermissionsCreateGroupHandler, routerPermissionsUpdateGroup as routerPermissionsUpdateGroupHandler, routerPermissionsDeleteGroup as routerPermissionsDeleteGroupHandler, routerSystemTabs as routerSystemTabsHandler, routerPermissionsAddMember as routerPermissionsAddMemberHandler, routerPermissionsDeleteMember as routerPermissionsDeleteMemberHandler, routerPermissionsCreateGrant as routerPermissionsCreateGrantHandler, routerPermissionsCreateFullPackageGrant as routerPermissionsCreateFullPackageGrantHandler, routerPermissionsDeleteGrant as routerPermissionsDeleteGrantHandler, routerPermissionsForUser as routerPermissionsForUserHandler, routerPermissionsAudit as routerPermissionsAuditHandler,  } from '../services/permissions.js';
import { systemView as systemViewHandler } from '../services/administration-ui.js';
import { systemAction as systemActionHandler } from '../services/administration-ui.js';
import { routerMcpIssue as routerMcpIssueHandler } from '../services/mcp-administration.js';
import { routerMcpCredentials as routerMcpCredentialsHandler } from '../services/mcp-administration.js';
import { routerMcpRevoke as routerMcpRevokeHandler } from '../services/mcp-administration.js';

export async function systemView(req) {
    /** @register_router system/view
     * @method GET */
    return systemViewHandler(req);
}

export async function systemAction(req) {
    /** @register_router system/action
     * @method POST */
    return systemActionHandler(req);
}

export async function routerPermissionsOverview(req, res) {
    /**
     * @register_router permissions
     * @method GET
     */
    return routerPermissionsOverviewHandler(req, res);
}

export async function routerPermissionsCatalog(req, res) {
    /**
     * @register_router permissions/catalog
     * @method GET
     */
    return routerPermissionsCatalogHandler(req, res);
}

export async function routerPermissionsCreateGroup(req, res) {
    /**
     * @register_router permissions/groups
     * @method POST
     */
    return routerPermissionsCreateGroupHandler(req, res);
}

export async function routerPermissionsUpdateGroup(req, res) {
    /**
     * @register_router permissions/groups/update
     * @method POST
     */
    return routerPermissionsUpdateGroupHandler(req, res);
}

export async function routerPermissionsDeleteGroup(req, res) {
    /**
     * @register_router permissions/groups/delete
     * @method POST
     */
    return routerPermissionsDeleteGroupHandler(req, res);
}

export async function routerSystemTabs(req, res) {
    /**
     * @register_router system/tabs
     * @method GET
     */
    return routerSystemTabsHandler(req, res);
}

export async function routerPermissionsAddMember(req, res) {
    /**
     * @register_router permissions/memberships
     * @method POST
     */
    return routerPermissionsAddMemberHandler(req, res);
}

export async function routerPermissionsDeleteMember(req, res) {
    /**
     * @register_router permissions/memberships/delete
     * @method POST
     */
    return routerPermissionsDeleteMemberHandler(req, res);
}

export async function routerPermissionsCreateGrant(req, res) {
    /**
     * @register_router permissions/grants
     * @method POST
     */
    return routerPermissionsCreateGrantHandler(req, res);
}

export async function routerPermissionsCreateFullPackageGrant(req, res) {
    /**
     * @register_router permissions/grants/full-package
     * @method POST
     */
    return routerPermissionsCreateFullPackageGrantHandler(req, res);
}

export async function routerPermissionsDeleteGrant(req, res) {
    /**
     * @register_router permissions/grants/delete
     * @method POST
     */
    return routerPermissionsDeleteGrantHandler(req, res);
}

export async function routerPermissionsForUser(req, res) {
    /**
     * @register_router permissions/user
     * @method GET
     */
    return routerPermissionsForUserHandler(req, res);
}

export async function routerPermissionsAudit(req, res) {
    /**
     * @register_router permissions/audit
     * @method GET
     */
    return routerPermissionsAuditHandler(req, res);
}

export async function routerMcpIssue(req, res) {
    /**
     * @register_router mcp/credentials
     * @method POST
     */
    return routerMcpIssueHandler(req, res);
}

export async function routerMcpCredentials(req, res) {
    /**
     * @register_router mcp/credentials
     * @method GET
     */
    return routerMcpCredentialsHandler(req, res);
}

export async function routerMcpRevoke(req, res) {
    /**
     * @register_router mcp/credentials/:id
     * @method DELETE
     */
    return routerMcpRevokeHandler(req, res);
}
