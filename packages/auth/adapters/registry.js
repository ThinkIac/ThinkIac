import '../runtime/config.js';
import { routerNpmWorkspace as routerNpmWorkspaceHandler, routerNpmCatalog as routerNpmCatalogHandler, routerNpmCreateToken as routerNpmCreateTokenHandler, routerNpmListTokens as routerNpmListTokensHandler, routerNpmRevokeToken as routerNpmRevokeTokenHandler, routerNpmAuthenticate as routerNpmAuthenticateHandler, routerNpmRegisterPackage as routerNpmRegisterPackageHandler, routerNpmDeletePackage as routerNpmDeletePackageHandler, routerNpmAccess as routerNpmAccessHandler, routerNpmDeviceStart as routerNpmDeviceStartHandler, routerNpmDeviceApprove as routerNpmDeviceApproveHandler, routerNpmDevicePoll as routerNpmDevicePollHandler, routerNotifyPairDevice as routerNotifyPairDeviceHandler, routerNotifyAuthorize as routerNotifyAuthorizeHandler,  } from '../services/registry-devices.js';

export async function routerNpmWorkspace(req) {
    /**
     * @register_router npm/workspace
     * @method GET
     */
    return routerNpmWorkspaceHandler(req);
}

export async function routerNpmCatalog(req) {
    /**
     * @register_router npm/catalog
     * @method GET
     * @public true
     */
    return routerNpmCatalogHandler(req);
}

export async function routerNpmCreateToken(req, res) {
    /**
     * @register_router npm/tokens
     * @method POST
     */
    return routerNpmCreateTokenHandler(req, res);
}

export async function routerNpmListTokens(req, res) {
    /**
     * @register_router npm/tokens
     * @method GET
     */
    return routerNpmListTokensHandler(req, res);
}

export async function routerNpmRevokeToken(req, res) {
    /**
     * @register_router npm/tokens/:id/revoke
     * @method POST
     */
    return routerNpmRevokeTokenHandler(req, res);
}

export async function routerNpmAuthenticate(req, res) {
    /**
     * @register_router npm/authenticate
     * @method POST
     */
    return routerNpmAuthenticateHandler(req, res);
}

export async function routerNpmRegisterPackage(req) {
    /**
     * @register_router npm/packages
     * @method POST
     * @public true
     */
    return routerNpmRegisterPackageHandler(req);
}

export async function routerNpmDeletePackage(req) {
    /**
     * @register_router npm/packages/:name
     * @method DELETE
     * @public true
     */
    return routerNpmDeletePackageHandler(req);
}

export async function routerNpmAccess(req) {
    /**
     * @register_router npm/access
     * @method POST
     * @public true
     */
    return routerNpmAccessHandler(req);
}

export async function routerNpmDeviceStart(req) {
    /**
     * @register_router npm/device
     * @method POST
     * @public true
     */
    return routerNpmDeviceStartHandler(req);
}

export async function routerNpmDeviceApprove(req) {
    /**
     * @register_router npm/device/approve
     * @method GET
     */
    return routerNpmDeviceApproveHandler(req);
}

export async function routerNpmDevicePoll(req) {
    /**
     * @register_router npm/device/poll
     * @method POST
     * @public true
     */
    return routerNpmDevicePollHandler(req);
}

export async function routerNotifyPairDevice(req, res) {
    /**
     * @register_router notify/devices
     * @method POST
     */
    return routerNotifyPairDeviceHandler(req, res);
}

export async function routerNotifyAuthorize(req, res) {
    /**
     * @register_router notify/authorize
     * @method POST
     */
    return routerNotifyAuthorizeHandler(req, res);
}
