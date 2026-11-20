import { getProxy } from 'logos';
import { normalizeUser } from './identity.js';
import { validateUsername } from './local-users.js';
import { hashPasswordAsync } from '../password-async.js';
import { canManageAuth, assignRoleSelections, permissionCatalog } from './permissions.js';
export async function listUsers(req, res) {
    const db = getProxy('auth');
    const me = db.user[req.user?.id];
    if (!canManageAuth(db, me, 'auth.users.read')) {
        return { status: 403, message: 'Apenas administradores podem ver esta página.' };
    }

    const users = (db.user.all ? db.user.all() : []) || [];

    return {
        status: 200,
        users: users.map((u) => ({
            id: u.id,
            name: u.name,
            email: u.email,
            username: u.username,
            role: u.role,
            disabled: !!u.disabled,
        })),
        assignableRoles: permissionCatalog.list(),
    };
}

export async function updateUser(req, res) {
    const db = getProxy('auth');
    const me = db.user[req.user?.id];
    if (!canManageAuth(db, me, 'auth.users.write')) {
        return { status: 403, message: 'Apenas administradores podem editar usuários.' };
    }

    const { userId, name, email, role, roleSelections, roleSelection, username: rawUsername } = req.body || {};
    const target = userId ? db.user[userId] : null;
    if (!target) return { status: 404, message: 'Usuário não encontrado.' };

    if (role && role !== target.role) {
        if (!['admin', 'user'].includes(role)) {
            return { status: 400, message: 'Role inválida.' };
        }
        // Impede rebaixar o último admin — sem isso um admin distraído
        // pode se auto-rebaixar (ou rebaixar o único outro admin) e travar
        // o acesso ao próprio painel, já que só admin chega até aqui.
        if (target.role === 'admin' && role !== 'admin') {
            const admins = (db.user.all ? db.user.all() : []).filter((u) => u.role === 'admin');
            if (admins.length <= 1) {
                return { status: 400, message: 'Não é possível rebaixar o último administrador.' };
            }
        }
        target.role = role;
    }

    if (typeof name === 'string') target.name = name.trim() || null;
    if (typeof email === 'string' && email.trim()) {
        const normalizedEmail = email.trim().toLowerCase();
        const existing = db.user.findOne({ email: normalizedEmail });
        if (existing && existing.id !== target.id) {
            return { status: 400, message: 'E-mail já cadastrado.' };
        }
        target.email = normalizedEmail;
    }
    if (typeof rawUsername === 'string') {
        const username = rawUsername.trim().toLowerCase();
        // `admin` já é uma conta especial criada pelo boot. A transferência
        // desse identificador entre administradores continua possível, mas os
        // demais nomes reservados nunca podem ser atribuídos por esta rota.
        const validation = username === 'admin'
            ? { valid: true, username }
            : validateUsername(username);
        if (!validation.valid) return { status: 400, message: validation.reason };
        const existing = db.user.findOne({ username: validation.username });
        if (existing && existing.id !== target.id) {
            return { status: 400, message: 'Usuário já cadastrado.' };
        }
        target.username = validation.username;
    }

    if (roleSelections != null || roleSelection != null) {
        const assignment = await assignRoleSelections(db, target.id, roleSelections ?? [roleSelection]);
        if (assignment.error) return { status: 400, message: assignment.error };
    }

    return {
        status: 200,
        user: {
            id: target.id,
            name: target.name,
            email: target.email,
            username: target.username,
            role: target.role,
        },
    };
}

export async function deleteUser(req, res) {
    const db = getProxy('auth');
    const me = db.user[req.user?.id];
    if (!canManageAuth(db, me, 'auth.users.write')) {
        return { status: 403, message: 'Apenas administradores podem excluir usuários.' };
    }

    const { userId } = req.body || {};
    const target = userId ? db.user[userId] : null;
    if (!target) return { status: 404, message: 'Usuário não encontrado.' };
    if (target.role === 'admin') {
        return { status: 400, message: 'Não é possível excluir uma conta de administrador.' };
    }

    const sessions = db.session.query({ userId: target.id }) || [];
    for (const session of sessions) await db.session.delete(session.id).catch(() => {});
    const memberships = db.permissionMembership.query({ userId: target.id }) || [];
    for (const membership of memberships) await db.permissionMembership.delete(membership.id).catch(() => {});
    const grants = db.permissionGrant.query({ subjectType: 'user', subjectId: target.id }) || [];
    for (const grant of grants) await db.permissionGrant.delete(grant.id).catch(() => {});
    await db.user.delete(target.id);
    return { status: 200, success: true };
}

export async function createAccount(req, res) {
    const db = getProxy('auth');
    const me = db.user[req.user?.id];
    if (!canManageAuth(db, me, 'auth.users.write')) {
        return { status: 403, message: 'Apenas administradores podem criar contas.' };
    }

    const { name, email, password, username: rawUsername, roleSelections = [], roleSelection = '' } = req.body || {};
    const normalizedEmail = String(email || '').trim().toLowerCase();

    if (!normalizedEmail || !password) {
        return { status: 400, message: 'E-mail e senha são obrigatórios.' };
    }

    const { valid, username, reason } = validateUsername(rawUsername);
    if (!valid) return { status: 400, message: reason };

    if (db.user.findOne({ email: normalizedEmail })) return { status: 409, message: 'Email is already registered.' };
    if (db.user.findOne({ username })) return { status: 409, message: 'Username is already registered.' };

    const user = await db.user.push({
        name,
        email: normalizedEmail,
        username,
        password: await hashPasswordAsync(password),
        role: 'user',
        emailVerified: true,
    });

    const assignment = await assignRoleSelections(db, user.id, roleSelections.length ? roleSelections : (roleSelection ? [roleSelection] : []));
    if (assignment.error) {
        await db.user.delete(user.id).catch(() => {});
        return { status: 400, message: assignment.error };
    }

    return { status: 200, success: true, userId: user.id, user: normalizeUser(user) };
}
