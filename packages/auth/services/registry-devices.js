import crypto from 'node:crypto';
import { getProxy } from 'logos';
import { identityProvider } from './identity.js';
import { resolveProxyCredential } from './credentials.js';
import { issueProxyToken, credentialHasScope, parseScopes } from '../proxy_credentials.js';
import { canReadNpmPackage, normalizeNpmPackage, npmPublicCatalog, npmReadableCatalog, npmWorkspaceSummary } from '../npm_registry.js';

const NPM_TOKEN_SCOPES = Object.freeze(['npm:read', 'npm:publish', 'npm:unpublish']);

const NOTIFY_SUBSCRIBE_SCOPE = 'notify:subscribe';

function notifyDeviceScope(appId) {
    return `notify:device:${appId}`;
}

function validNotifyDeviceId(appId) {
    return /^[A-Za-z0-9_-]{12,64}$/.test(String(appId || ''));
}

function sameSecret(actual, expected) {
    if (!actual || !expected) return false;
    const received = Buffer.from(String(actual));
    const configured = Buffer.from(String(expected));
    return received.length === configured.length && crypto.timingSafeEqual(received, configured);
}

export function npmGroupsFor(user, credential) {
    const groups = new Set(['npm:read', `npm:owner:${String(user?.username || '').toLowerCase()}`]);
    for (const scope of NPM_TOKEN_SCOPES) {
        if (credentialHasScope(credential, scope)) groups.add(scope);
    }
    if (user?.role === 'admin') groups.add('npm:admin');
    return [...groups];
}

export function gatewayBaseUrl() {
    return `https://${process.env.CLOUD_ENV_THINKIAC_DOMAIN || 'thinkiac.cloud'}`;
}

async function npmSessionUser(req) {
    const resolved = await identityProvider.resolve(req);
    return resolved?.user || null;
}

export async function routerNpmWorkspace(req) {
    const user = await npmSessionUser(req);
    if (!user?.username) return { authenticated: false, workspace: null, packages: [] };
    const records = getProxy('auth').npmPackage.query({ owner: String(user.username).toLowerCase() }) || [];
    return npmWorkspaceSummary(user, records);
}

export async function routerNpmCatalog(req) {
    const identity = await npmUserForBearer(req);
    const records = getProxy('auth').npmPackage.query() || [];
    return {
        packages: identity
            ? npmReadableCatalog(records, identity.user.username)
            : npmPublicCatalog(records),
    };
}

export async function routerNpmCreateToken(req, res) {
    const user = await npmSessionUser(req);
    if (!user) return { status: 401, error: 'Faça login no ThinkIac para criar um token npm.' };
    if (!user.username) return { status: 409, error: 'Sua conta ainda não possui um nome de usuário para reservar o escopo npm.' };

    const issued = issueProxyToken();
    const record = await getProxy('auth').proxyCredential.push({
        tokenId: issued.tokenId,
        tokenHash: issued.tokenHash,
        userId: user.id,
        tenantId: null,
        scopes: JSON.stringify(NPM_TOKEN_SCOPES),
        status: 'active',
        spentMicros: 0,
        maxRequestsPerMinute: 600,
    });
    return {
        status: 201,
        token: issued.token,
        tokenId: record.id,
        username: user.username,
        scope: `@${user.username}`,
        official: user.role === 'admin',
        registry: 'https://npm.thinkiac.cloud',
        warning: 'Copie agora: este token não será exibido novamente.',
    };
}

export async function routerNpmListTokens(req, res) {
    const user = await npmSessionUser(req);
    if (!user) return { status: 401, error: 'Faça login no ThinkIac para consultar tokens npm.' };
    const records = getProxy('auth').proxyCredential.query({ userId: user.id }) || [];
    return {
        tokens: records
            .filter((record) => NPM_TOKEN_SCOPES.some((scope) => credentialHasScope(record, scope)))
            .map((record) => ({
                id: record.id,
                createdAt: record.createdAt,
                lastUsedAt: record.lastUsedAt || null,
                revokedAt: record.revokedAt || null,
                active: record.status === 'active' && !record.revokedAt,
            })),
    };
}

export async function routerNpmRevokeToken(req, res) {
    const user = await npmSessionUser(req);
    if (!user) return { status: 401, error: 'Faça login no ThinkIac para revogar um token npm.' };
    const record = getProxy('auth').proxyCredential[String(req.params?.id || '')];
    if (!record || record.userId !== user.id || !NPM_TOKEN_SCOPES.some((scope) => credentialHasScope(record, scope))) {
        return { status: 404, error: 'Token npm não encontrado.' };
    }
    record.status = 'revoked';
    record.revokedAt = new Date();
    return { ok: true };
}

export async function routerNpmAuthenticate(req, res) {
    const serviceToken = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '');
    if (!sameSecret(serviceToken, process.env.AUTH_ENV_VERDACCIO_SERVICE_TOKEN)) {
        return { status: 401, authenticated: false };
    }
    const identifier = String(req.body?.username || '').trim().toLowerCase();
    const token = String(req.body?.token || '');
    const db = getProxy('auth');
    const user = db.user.findOne({ username: identifier }) || db.user.findOne({ email: identifier });
    const credential = await resolveProxyCredential(token, 'npm:read');
    if (!user || !credential || credential.userId !== user.id || !user.username) {
        return { status: 401, authenticated: false };
    }
    return { authenticated: true, username: user.username, groups: npmGroupsFor(user, db.proxyCredential[credential.credentialId]) };
}

export async function routerNpmRegisterPackage(req) {
    const identity = await npmUserForBearer(req, 'npm:publish');
    if (!identity) return { status: 401, error: 'Token npm de publicação inválido.' };
    let record;
    try { record = normalizeNpmPackage({ ...req.body, owner: identity.user.username, official: identity.user.role === 'admin' && req.body?.official === true }); }
    catch (error) { return { status: 400, error: error.message }; }
    const db = getProxy('auth');
    const current = db.npmPackage.findOne({ name: record.name });
    if (current && current.owner !== record.owner && identity.user.role !== 'admin') return { status: 403, error: 'Este pacote pertence a outro workspace.' };
    if (current) Object.assign(current, record);
    else await db.npmPackage.push(record);
    return { ok: true, ...record };
}

export async function routerNpmDeletePackage(req) {
    const identity = await npmUserForBearer(req, 'npm:unpublish');
    if (!identity) return { status: 401, error: 'Token npm de remoção inválido.' };
    const name = String(req.params?.name || '').trim().toLowerCase();
    const db = getProxy('auth');
    const record = db.npmPackage.findOne({ name });
    if (!record) return { status: 404, error: 'Pacote não encontrado.' };
    if (record.owner !== String(identity.user.username).toLowerCase() && identity.user.role !== 'admin') return { status: 403, error: 'Este pacote pertence a outro workspace.' };
    await db.npmPackage.delete(record.id);
    return { ok: true, name };
}

export async function routerNpmAccess(req) {
    const serviceToken = npmBearer(req);
    if (!sameSecret(serviceToken, process.env.AUTH_ENV_VERDACCIO_SERVICE_TOKEN)) return { status: 401, allowed: false };
    const packageName = String(req.body?.packageName || '').toLowerCase();
    const record = getProxy('auth').npmPackage.findOne({ name: packageName });
    // Pacotes não gerenciados continuam disponíveis para o proxy npmjs. Todo
    // pacote publicado pelo fluxo ThinkIac é registrado antes do upload.
    return { allowed: !record || canReadNpmPackage(record, req.body?.username) };
}

export async function routerNpmDeviceStart(req) {
    const code = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    await getProxy('auth').npmDeviceAuthorization.push({ codeHash: deviceCodeHash(code), expiresAt });
    return { deviceCode: code, verificationUri: `${gatewayBaseUrl()}/auth/npm/device/approve?code=${encodeURIComponent(code)}`, expiresIn: 300, interval: 2 };
}

export async function routerNpmDeviceApprove(req) {
    const user = await npmSessionUser(req);
    if (!user) return { status: 401, error: 'Faça login no ThinkIac para aprovar este dispositivo.' };
    const code = String(req.query?.code || '');
    const record = getProxy('auth').npmDeviceAuthorization.findOne({ codeHash: deviceCodeHash(code) });
    if (!record || record.consumedAt || new Date(record.expiresAt).getTime() < Date.now()) return { status: 400, error: 'Código de dispositivo inválido ou expirado.' };
    record.userId = user.id;
    record.approvedAt = new Date();
    return { ok: true, message: 'Dispositivo aprovado. Você já pode voltar ao terminal.' };
}

export async function routerNpmDevicePoll(req) {
    const record = getProxy('auth').npmDeviceAuthorization.findOne({ codeHash: deviceCodeHash(req.body?.deviceCode) });
    if (!record || record.consumedAt || new Date(record.expiresAt).getTime() < Date.now()) return { status: 400, error: 'Código de dispositivo inválido ou expirado.' };
    if (!record.approvedAt || !record.userId) return { status: 202, pending: true };
    const user = getProxy('auth').user[record.userId];
    if (!user?.username) return { status: 409, error: 'A conta não possui workspace pessoal.' };
    const issued = issueProxyToken();
    await getProxy('auth').proxyCredential.push({ tokenId: issued.tokenId, tokenHash: issued.tokenHash, userId: user.id, tenantId: null, scopes: JSON.stringify(NPM_TOKEN_SCOPES), status: 'active', spentMicros: 0, maxRequestsPerMinute: 600 });
    record.consumedAt = new Date();
    return { token: issued.token, username: user.username, scope: `@${user.username}`, official: user.role === 'admin', registry: 'https://npm.thinkiac.cloud' };
}

export async function routerNotifyPairDevice(req, res) {
    const user = await npmSessionUser(req);
    const appId = String(req.body?.appId || '');
    if (!user) return { status: 401, error: 'Faça login no ThinkIac para parear este aparelho.' };
    if (!validNotifyDeviceId(appId)) return { status: 400, error: 'Identificador de aparelho inválido.' };

    const db = getProxy('auth');
    // O token só aparece nesta resposta. Reparear revoga o anterior desse
    // aparelho, o que também torna a revogação simples em caso de perda.
    for (const record of db.proxyCredential.query({ userId: user.id }) || []) {
        if (credentialHasScope(record, notifyDeviceScope(appId)) && !record.revokedAt) {
            record.status = 'revoked';
            record.revokedAt = new Date();
        }
    }
    const issued = issueProxyToken();
    await db.proxyCredential.push({
        tokenId: issued.tokenId,
        tokenHash: issued.tokenHash,
        userId: user.id,
        tenantId: null,
        scopes: JSON.stringify([NOTIFY_SUBSCRIBE_SCOPE, notifyDeviceScope(appId)]),
        status: 'active',
        spentMicros: 0,
        maxRequestsPerMinute: 60,
    });
    return {
        status: 201,
        appId,
        topic: appId,
        server: process.env.AUTH_ENV_NOTIFY_URL || 'https://notify.thinkiac.cloud',
        token: issued.token,
        warning: 'A credencial é exibida apenas durante este pareamento.',
    };
}

export async function routerNotifyAuthorize(req, res) {
    const serviceToken = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '');
    if (!sameSecret(serviceToken, process.env.AUTH_ENV_NTFY_SERVICE_TOKEN)) {
        return { status: 401, authorized: false };
    }
    const token = String(req.body?.token || '');
    const topic = String(req.body?.topic || '');
    const action = String(req.body?.action || 'subscribe');
    if (action !== 'subscribe' || !validNotifyDeviceId(topic)) return { status: 400, authorized: false };

    const credential = await resolveProxyCredential(token, NOTIFY_SUBSCRIBE_SCOPE);
    if (!credential) return { status: 401, authorized: false };
    const record = getProxy('auth').proxyCredential[credential.credentialId];
    if (!parseScopes(record?.scopes).includes(notifyDeviceScope(topic))) {
        return { status: 403, authorized: false };
    }
    return { authorized: true, topic };
}

function deviceCodeHash(code) {
    return crypto.createHash('sha256').update(String(code || '')).digest('hex');
}

function npmBearer(req) {
    return String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '');
}

async function npmUserForBearer(req, scope = 'npm:read') {
    const token = npmBearer(req);
    const credential = await resolveProxyCredential(token, scope);
    if (!credential) return null;
    const user = getProxy('auth').user[credential.userId];
    return user?.username ? { user, credential } : null;
}
