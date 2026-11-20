import { identityProvider } from './services/identity.js';
import { authorizeRequest } from './authorization.js';

// Event consumers resolve identity through the same authority as HTTP. Never
// accept a caller-supplied user/principal as proof of authentication.
export async function resolvePrincipal(payload, context) {
    /** @register_hook auth:resolve-principal */
    const identity = await identityProvider.resolve(context?.req || payload?.req);
    return identity?.principal || null;
}

export async function checkPermission(payload, context) {
    /** @register_hook auth:check-permission */
    const identity = await identityProvider.resolve(context?.req || payload?.req);
    if (!identity) return { allowed: false, status: 401, reason: 'unauthenticated' };
    // Delegated browser sessions carry a route capability boundary. A generic
    // permission query cannot widen it to the underlying user's privileges.
    if (identity.session.delegatedSubject) return { allowed: false, status: 403, reason: 'delegated_session' };
    if (typeof payload?.permission !== 'string' || !payload.permission.trim()) {
        return { allowed: false, status: 403, reason: 'invalid_permission' };
    }
    return authorizeRequest({ principal: identity.principal }, payload.permission, payload.resourceId ?? null);
}
