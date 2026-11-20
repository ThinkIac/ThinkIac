// System contributions use manifest.systemTab; no consumer-specific registry is stored here.
import { assertSurface } from '../../ui-schema/index.js';
import { listUsers, createAccount, updateUser, deleteUser } from './user-administration.js';
import { routerPermissionsOverview, routerPermissionsAudit, routerPermissionsCreateGroup, routerPermissionsUpdateGroup, routerPermissionsDeleteGroup, routerPermissionsAddMember, routerPermissionsDeleteMember, routerPermissionsCreateGrant, routerPermissionsDeleteGrant } from './permissions.js';
const AUTH_TABS = new Set(['auth-users', 'auth-roles']);
const AUTH_SURFACE = Object.freeze({
    version: 1,
    kind: 'auth-administration',
    actions: {
        'auth.create-user': { intent: 'write' }, 'auth.update-user': { intent: 'write' }, 'auth.delete-user': { intent: 'destructive' },
        'auth.create-role': { intent: 'write' }, 'auth.update-role': { intent: 'write' }, 'auth.delete-role': { intent: 'destructive' },
        'auth.add-member': { intent: 'write' }, 'auth.remove-member': { intent: 'destructive' },
        'auth.add-grant': { intent: 'write' }, 'auth.remove-grant': { intent: 'destructive' },
    },
});

function authTab(req, fallback = 'auth-users') {
    const tab = String(req?.query?.tab || req?.body?.values?.tab || fallback);
    return AUTH_TABS.has(tab) ? tab : fallback;
}

async function authSystemState(req, tab = authTab(req)) {
    const users = await listUsers(req);
    if (users.status >= 400) return users;
    if (tab === 'auth-roles' || tab === 'auth-users') {
        const permissions = await routerPermissionsOverview(req);
        if (permissions.status >= 400) return permissions;
        return { tab, ...users, permissions, audit: tab === 'auth-roles' ? (await routerPermissionsAudit({ ...req, query: { ...req.query, limit: 30 } })).entries : [] };
    }
    return { tab, ...users };
}

async function authActionResult(result, req, tab, notice) {
    result = await result;
    if (result?.status >= 400) return { status: result.status, error: result.error || result.message || 'Ação não concluída.' };
    return Promise.resolve(authSystemState(req, tab)).then((state) => ({ status: state.status >= 400 ? state.status : 200, state, notice }));
}

export async function systemView(req) {
    const tab = authTab(req);
    const state = await authSystemState(req, tab);
    if (state.status >= 400) return state;
    return { status: 200, surface: assertSurface({ ...AUTH_SURFACE, tab }), state };
}

export async function systemAction(req) {
    const action = String(req.body?.action || '');
    const values = req.body?.values && typeof req.body.values === 'object' ? req.body.values : {};
    const tab = authTab({ ...req, body: { ...req.body, values } });
    const routed = (handler, body, notice) => authActionResult(handler({ ...req, body }), req, tab, notice);
    if (action === 'auth.create-user') return routed(createAccount, values, 'Usuário criado.');
    if (action === 'auth.update-user') return routed(updateUser, values, 'Usuário atualizado.');
    if (action === 'auth.delete-user') return routed(deleteUser, values, 'Usuário removido.');
    if (action === 'auth.create-role') return routed(routerPermissionsCreateGroup, values, 'Papel criado.');
    if (action === 'auth.update-role') return routed(routerPermissionsUpdateGroup, values, 'Papel atualizado.');
    if (action === 'auth.delete-role') return routed(routerPermissionsDeleteGroup, values, 'Papel removido.');
    if (action === 'auth.add-member') return routed(routerPermissionsAddMember, values, 'Membro incluído.');
    if (action === 'auth.remove-member') return routed(routerPermissionsDeleteMember, values, 'Membro removido.');
    if (action === 'auth.add-grant') return routed(routerPermissionsCreateGrant, values, 'Permissão incluída.');
    if (action === 'auth.remove-grant') return routed(routerPermissionsDeleteGrant, values, 'Permissão removida.');
    return { status: 404, error: 'Ação de Access não permitida.' };
}
