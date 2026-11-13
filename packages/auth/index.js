import { hashPasswordAsync, verifyPasswordAsync } from './password-async.js';
import { claimActivation, updateActivationLease, recoverActivations } from './activation.js';
import { createMcpAuth } from './mcp-auth.js';
import { dispatchEvent, getProxy, isPublicRoute, isPublicView } from 'logos';
import crypto from 'crypto';
import { credentialHasScope, DEFAULT_BILLING_SCOPES, DEFAULT_TENANT_SCOPES, issueProxyToken, parseProxyToken, parseScopes, verifyProxyToken } from './proxy_credentials.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isPublicExposure } from './runtime/public-exposure.js';
import {
    GOOGLE_AUTH_URL,
    GOOGLE_TOKEN_URL,
    SIGN_IN_VIEW,
    decodeIdTokenClaims,
    validateIdTokenClaims,
    safeNext,
    signInRedirect,
    normalizeClient,
    precisaDeTicket,
    sessionCookie as sessionCookieFor,
    shouldUseSecureSessionCookie,
} from './google_oauth.js';
import { resolveGoogleUser } from './google_user.js';
import { queueVerificationEmail } from './email_delivery.js';
import { createEmailVerification, verificationMatches, verificationTokenHash } from './email_verification.js';
import {
    appDestination,
    distributedApp,
    getDistributedApp,
    pathBelongsToApp,
    tenantPluginsFor,
} from './app_flow.js';
import permissionService from './permissions.cjs';
import permissionCatalogService from './permission_catalog.cjs';
// Caminho relativo intencional: pacotes do Runtime são carregados diretamente
// pelo host, sem exigir instalação prévia em node_modules.
import { attachPrincipal, createPrincipal } from './runtime/identity.js';
import { authorizeViewRequest } from './resource_access.js';
import { listLegacySystemTabs } from '../settings/lib/tabs.js';
import { assertSurface } from '../ui-schema/index.js';
export { authorizeRequest, requirePermission } from './authorization.js';
import { canReadNpmPackage, normalizeNpmPackage, npmPublicCatalog, npmReadableCatalog, npmWorkspaceSummary } from './npm_registry.js';

// Carrega só o .env deste pacote (BILLING_ADMIN_TOKEN) — não depende do
// ambiente do processo Agent, que outros pacotes compartilham.
try { process.loadEnvFile(new URL('./.env', import.meta.url)); } catch {}

const BILLING_ADMIN_HEADER = 'x-billing-admin-token';
const { authorize, permissionsForUser, validateGrantInput } = permissionService;
const { createPermissionCatalog, listSelectablePermissions, validateDeclaredGroupInput } = permissionCatalogService;
const permissionCatalog = createPermissionCatalog({ packagesDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..') });

// Registro público pode receber um role de produto, mas nunca uma capacidade
// que administra a própria identidade do Runtime.
function canBeDefaultRegistrationRole(role) {
    return !!role && !(role.permissions || []).some((permission) => /^auth\.(?:users|access|settings)\.(?:read|write)$/.test(permission));
}
const NPM_TOKEN_SCOPES = Object.freeze(['npm:read', 'npm:publish', 'npm:unpublish']);
const NOTIFY_SUBSCRIBE_SCOPE = 'notify:subscribe';
// A entrada autenticada é decidida pelo pacote Redirect. Ele aplica a regra
// do cargo, quando houver, e usa a tela inicial como destino padrão.
const AUTHENTICATED_HOME = '/redirect/home';
let initialAdminCreationInProgress = false;

function uniqueConflict(error, field) {
    if (error?.code !== 'SQLITE_CONSTRAINT_UNIQUE') return null;
    const suffix = field === 'username' ? 'Username is already registered.' : 'Email is already registered.';
    return { status: 409, error: suffix };
}

function notifyDeviceScope(appId) {
    return `notify:device:${appId}`;
}

function validNotifyDeviceId(appId) {
    return /^[A-Za-z0-9_-]{12,64}$/.test(String(appId || ''));
}

// --- FUNÇÕES AUXILIARES DE CRIPTOGRAFIA ---

export function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const iterations = 10000;
    const keylen = 64;
    const digest = 'sha512';

    const hash = crypto.pbkdf2Sync(password, salt, iterations, keylen, digest).toString('hex');
    return `${salt}:${iterations}:${hash}`;
}

async function verifyPassword(password, storedPasswordHash) {
    return verifyPasswordAsync(password, storedPasswordHash);
}

async function createAndSendEmailVerification(db, user) {
    const verification = createEmailVerification({ userId: user.id, email: user.email });
    const record = await db.emailverification.push(verification.record);
    const url = `${gatewayBaseUrl()}/auth/verify-email?token=${encodeURIComponent(verification.token)}`;
    try {
        await queueVerificationEmail({ email: user.email, code: verification.code, url });
    } catch (error) {
        await db.emailverification.delete(record.id).catch(() => {});
        throw error;
    }
    return record;
}

async function confirmEmailVerification(db, { token, email, code }) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const candidates = typeof token === 'string'
        ? await db.emailverification.query({ tokenHash: verificationTokenHash(token), consumed: false }, { limit: 1 })
        : normalizedEmail ? await db.emailverification.query({ email: normalizedEmail, consumed: false }, { sort: 'createdAt DESC', limit: 20 }) : [];
    const record = candidates.find((item) => !item.consumed && new Date(item.expiresAt).getTime() >= Date.now() && verificationMatches(item, { token, code }));
    if (!record) return null;
    const user = db.user[record.userId];
    if (!user || String(user.email).toLowerCase() !== record.email) return null;
    // Marca antes de iniciar infraestrutura: um segundo clique nunca pode
    // ganhar outra sessão ou disparar outro provisionamento.
    record.consumed = true;
    record.consumedAt = new Date();
    user.emailVerified = true;
    await requestWelcomeCredit(user.id);
    return user;
}

function normalizeUser(user) {
    if (!user) return null;
    const data = typeof user.toJSON === 'function' ? user.toJSON() : { ...user };
    delete data.password;
    return data;
}

// Contas do fluxo retirado não podem receber automaticamente uma instância
// comercial. Não há rota, view nem permissão local restante para elas.
function isRetiredLocalAccount(user) {
    return user?.accountType === 'local';
}

// A confirmação libera o bônus; login e sessão continuam disponíveis.
function requiresEmailVerification(user) {
    return user?.role !== 'admin' && !user?.emailVerified && !user?.googleSub;
}

async function requestWelcomeCredit(userId) {
    try {
        const result = await dispatchEvent('billing:grant-trial', { userId });
        const user = getProxy('auth').user[userId];
        if (user) {
            user.welcomeCreditStatus = result?.granted === true ? 'granted' : 'pending';
            user.welcomeCreditError = result?.granted === true ? null : (result?.reason || 'billing_unavailable');
        }
        if (result?.granted !== true && result?.reason !== 'email_unverified') {
            console.error('[auth] bônus pendente: billing não confirmou a concessão');
        }
        return result;
    } catch (error) {
        const user = getProxy('auth').user[userId];
        if (user) { user.welcomeCreditStatus = 'pending'; user.welcomeCreditError = 'billing_unavailable'; }
        console.error('[auth] bônus pendente:', error.message);
        return { granted: false, reason: 'billing_unavailable' };
    }
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

/** Traduz o schema ThinkIac para o contrato neutro consumido por hosts/apps. */
function principalFor(user, session = null) {
    const cleanUser = normalizeUser(user);
    if (!cleanUser?.id) return null;
    let capabilities = [];
    try { capabilities = JSON.parse(session?.delegatedCapabilities || '[]'); } catch {}
    return createPrincipal({
        subject: cleanUser.id,
        type: 'user',
        role: cleanUser.role,
        capabilities: Array.isArray(capabilities) ? capabilities : [],
        sessionId: session?.id ?? null,
        claims: { email: cleanUser.email, username: cleanUser.username },
    });
}

/** IdentityProvider do ThinkIac. Pode ser usado sem depender de middleware Logos. */
export const identityProvider = Object.freeze({
    async resolve(req) {
        const sessionId = parseCookies(req?.headers?.cookie)['sessionId'];
        const db = getProxy('auth');
        const session = sessionId ? db.session[sessionId] : null;
        if (!session || !Number.isFinite(new Date(session.expiresAt).getTime()) || Date.now() >= new Date(session.expiresAt).getTime()) return null;
        const user = db.user[session.userId];
        if (!user || user.disabled) return null;
        const sessionData = typeof session.toJSON === 'function' ? session.toJSON() : { id: sessionId, ...session };
        return { principal: principalFor(user, sessionData), user: normalizeUser(user), session: sessionData };
    },
});

function generateInviteCode() {
    return crypto.randomBytes(6).toString('base64url').slice(0, 10).toUpperCase();
}

// --- SSO PRO CONTAINER DO TENANT ---
//
// Token HMAC de uso único e curta validade (verificado em
// apps/runtime/packages/tenant-auth/index.js, mesmo CLOUD_ENV_SSO_SECRET
// passado como env var na criação do container) — deixa o dono cair
// autenticado na própria instância sem redigitar senha.

function signSsoToken(username, secret, next = null) {
    const payload = { username, iat: Date.now(), jti: crypto.randomBytes(9).toString('base64url') };
    if (next) payload.next = next;
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
    return `${body}.${sig}`;
}

function ssoUrlFor(tenantDomain, username, next = null) {
    const secret = process.env.CLOUD_ENV_SSO_SECRET;
    if (!secret || !tenantDomain) return null;
    return `https://${tenantDomain}/tenant-auth/sso?token=${signSsoToken(username, secret, next)}`;
}

// --- WARM-UP DA INSTÂNCIA (esquenta o build da view antes de liberar) ---
//
// O InfraKit já espera o container responder em GET / com status < 500 antes
// de devolver o tenant como criado — mas isso só esquenta a rota raiz. O
// destino real do usuário é outro: /tenant-auth/sso valida o token e
// redireciona pra /view/agent/Home, e o motor de views do logos
// (modules/views/engine.js, ensureBuilt()) compila essa rota sob demanda
// (bundle Rollup SSR+DOM) na PRIMEIRA request feita a ela — cache por
// processo, vazio num container recém-criado. Sem esquentar essa rota
// específica, é o usuário de verdade quem paga esse primeiro build ao vivo
// logo após o redirect do SSO.
//
// Por isso replicamos os dois hops do SSO manualmente aqui. fetch() do Node
// não tem cookie jar: seguir o redirect automaticamente (`redirect:'follow'`)
// perderia o Set-Cookie do primeiro hop, o accessGate do tenant mandaria pra
// "/" sem nunca tocar a view, e o request "sucederia" (200 em /) sem
// esquentar nada. Por isso os dois hops são feitos à mão, repassando o
// cookie de sessão manualmente.
const WARMUP_ROUTE = '/view/desktop/Index';
const WARMUP_INTERVAL_MS = parseInt(process.env.AUTH_ENV_WARMUP_INTERVAL_MS) || 3000;
const WARMUP_ATTEMPT_TIMEOUT_MS = parseInt(process.env.AUTH_ENV_WARMUP_ATTEMPT_TIMEOUT_MS) || 25000;
const WARMUP_MAX_ATTEMPTS = parseInt(process.env.AUTH_ENV_WARMUP_MAX_ATTEMPTS) || 3;
const activeTenantWarmups = new Set();

async function probeTenantDestination(tenantDomain, username, destination = WARMUP_ROUTE) {
    try {
        // Token novo a cada tentativa — signSsoToken/jti é de uso único.
        const ssoUrl = ssoUrlFor(tenantDomain, username, destination);
        if (!ssoUrl) return { ready: false, error: 'SSO não configurado' };

        const ssoRes = await fetch(ssoUrl, {
            method: 'GET',
            redirect: 'manual',
            signal: AbortSignal.timeout(WARMUP_ATTEMPT_TIMEOUT_MS),
        });

        const location = ssoRes.headers.get('location');
        if (!(ssoRes.status >= 300 && ssoRes.status < 400 && location?.startsWith(destination))) {
            return { ready: false, error: `sso respondeu status ${ssoRes.status} location "${location}"` };
        }

        const cookie = ssoRes.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
        const homeRes = await fetch(new URL(location, `https://${tenantDomain}`), {
            method: 'GET',
            headers: cookie ? { Cookie: cookie } : {},
            signal: AbortSignal.timeout(WARMUP_ATTEMPT_TIMEOUT_MS),
        });
        return homeRes.ok
            ? { ready: true }
            : { ready: false, error: `HTTP ${homeRes.status} em ${destination}` };
    } catch (error) {
        return { ready: false, error: String(error?.message || error) };
    }
}

async function warmUpTenantApp(tenantDomain, username, destination = WARMUP_ROUTE) {
    // Aquecimento é uma otimização best-effort, nunca um gate de acesso. Em
    // tenants free a compilação pode ser lenta; limitar as tentativas impede
    // trabalho eterno no gateway sem atrasar a navegação do usuário.
    for (let attempt = 0; attempt < WARMUP_MAX_ATTEMPTS; attempt += 1) {
        const probe = await probeTenantDestination(tenantDomain, username, destination);
        if (probe.ready) return true;
        if (attempt + 1 < WARMUP_MAX_ATTEMPTS) {
            await new Promise((r) => setTimeout(r, WARMUP_INTERVAL_MS));
        }
    }
    return false;
}

function startTenantDestinationWarmup(userId, tenantDomain, username, destination = WARMUP_ROUTE) {
    const key = String(userId);
    if (activeTenantWarmups.has(key)) return;
    activeTenantWarmups.add(key);

    warmUpTenantApp(tenantDomain, username, destination)
        .then((ready) => {
            if (!ready) console.warn(`[auth] warm-up best-effort de ${tenantDomain} encerrou sem confirmação`);
        })
        .catch((error) => {
            console.error(`[auth] warm-up do tenant ${tenantDomain} falhou: ${error.message}`);
        })
        .finally(() => activeTenantWarmups.delete(key));
}

// Username vira subdomínio (<username>.THINKIAC_DOMAIN) — precisa ser
// DNS-safe: minúsculas, alfanumérico e hífen, 3-63 caracteres.
const USERNAME_RE = /^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/;
const RESERVED_USERNAMES = new Set([
    'www', 'admin', 'api', 'root', 'mail', 'ftp',
    'portainer', 'npm', 'proxy', 'gateway', 'static', 'cdn',
    'app', 'docker', 'localhost', 'thinkiac', 'ns1', 'ns2', 'auth', 'cloud',
]);

function validateUsername(raw) {
    const username = String(raw || '').trim().toLowerCase();
    if (username.length < 3 || username.length > 63) {
        return { valid: false, reason: 'O usuário deve ter entre 3 e 63 caracteres.' };
    }
    if (!USERNAME_RE.test(username)) {
        return { valid: false, reason: 'Use apenas letras minúsculas, números e hífen (sem começar/terminar com hífen).' };
    }
    if (RESERVED_USERNAMES.has(username)) {
        return { valid: false, reason: 'Esse usuário é reservado.' };
    }
    return { valid: true, username };
}

// --- AUXILIARES DO SISTEMA ---

function parseCookies(cookieHeader) {
    const cookies = {};
    if (!cookieHeader) return cookies;

    cookieHeader.split(';').forEach(cookie => {
        const [parts] = cookie.split('=');
        const name = parts.trim();
        const value = cookie.substring(name.length + 1).trim();
        if (name) cookies[name] = decodeURIComponent(value);
    });
    return cookies;
}

// --- PORTÃO DE ACESSO GLOBAL ---
//
// Anônimo: só main-site (home) e as rotas/telas de auth.
// Usuário comum (role !== 'admin'): nunca vê os apps daqui — vai pra
// instância pessoal dele (tenantDomain) assim que estiver pronta.
// Admin: acesso total.
//
// Importado direto por index.js e passado em bootstrap({ middleware: [...] }) —
// roda ANTES de qualquer router de pacote, então cobre tudo (Agent,
// whatsapp-manager, etc), não só rotas marcadas com @auth.

const PUBLIC_PATH_PREFIXES = [
    '/auth/', '/view/main-site/', '/view/auth/', '/svelte-cache/',
    // Signed ThinkIac Edge runtime distribution. Keep this prefix narrow so
    // unrelated public/ files remain protected by the session gate.
    '/edge/',
    // Homepage playground + Store-preview routes (main-site/router/events.js) —
    // both are documented as anonymous-facing, but weren't actually reachable
    // before this fix (fetch('/main-site/packages') 302'd to Login).
    '/main-site/',
    // Chamadas de fora do gateway (container do tenant, webhook do Mercado
    // Pago) — autenticação própria dentro do handler, não sessão de cookie.
    '/billing/proxy/', '/billing/v1/', '/billing/webhook/',
    // ThinkIac Provider: OpenAI-compatible API and payment callback. Account,
    // key and top-up routes remain protected by the normal session gate.
    '/thinkiac-provider/v1/', '/thinkiac-provider/webhook/',
    '/view/thinkiac-provider/Index',
    // packages/upgrade (dentro do container do tenant) busca/recarrega
    // créditos usando o LLM_PROXY_TOKEN do próprio tenant como Bearer — sem
    // cookie de sessão do gateway central (não teria como ter um).
    '/billing/wallet/by-proxy-token', '/billing/checkout/by-proxy-token',
    '/billing/upgrade/by-proxy-token',
    // Benchmark — tool interna, sem dados sensíveis; views consomem APIs
    // via fetch direto e o auth redirect quebra o parse de JSON.
    '/benchmark/',
    // Catálogo público da Store. Mutations continuam protegidas por @auth e
    // views de publicar/admin não entram aqui.
    '/store/search', '/store/app', '/store/categories', '/store/resolve',
    '/store/download', '/store/config', '/store/install-status', '/store/verify-key',
    '/view/store/Home',
    // Ponte de sessão (aurora/routes/session_channel.js): as tools MCP
    // say_to_user/ask_user chamam daqui de dentro, a partir de um subprocesso
    // que não tem cookie de sessão do navegador — antes disso o gate redirecionava
    // pro Login e o ask_user nunca chegava a registrar a pergunta. Não é rota
    // aberta: os handlers exigem o token de processo (AURORA_SESSION_TOKEN).
    '/agent/session/', '/agent/engineer/ask',
    // API do agent de tenants (packages/tenant-systemd) numa VPS sem
    // Portainer: quem chama é o control plane de outra máquina, que não tem
    // cookie de sessão deste gateway. NÃO é rota aberta — os handlers exigem
    // Bearer com TENANT_SYSTEMD_ENV_TOKEN e recusam quando não há token
    // configurado, justamente porque elas criam e APAGAM tenants.
    '/tenant-systemd/',
    // Docker Registry v2 (packages/docker-registry). Quem chama é o daemon
    // Docker de cada VPS, que não tem cookie de sessão e só sabe falar o
    // protocolo do registry. NÃO é rota aberta: cada handler exige HTTP Basic
    // (credencial de leitura para pull, outra para push) e recusa quando
    // nenhuma está configurada. O caminho é `/v2/` porque a especificação o
    // fixa na raiz — não é escolha nossa.
    '/v2/',
    // Auto-cadastro de VPS (packages/vps/enroll.js). Quem chama é a máquina
    // recém-instalada no fim do ops/vps-bootstrap.sh, que não tem — nem pode
    // ter — sessão de navegador. NÃO é rota aberta: exige Bearer com o token
    // de enrollment e recusa (503) quando ele não está configurado. Só esta
    // rota do pacote é liberada; o resto do /vps/ continua exigindo sessão.
    '/vps/enroll',
];
const PUBLIC_EXACT_PATHS = new Set([
    '/', '/ws',
    // Links, pixel de abertura e descadastro são consumidos pelo destinatário
    // fora da sessão ThinkIac. A proteção é o identificador opaco por mensagem;
    // rotas administrativas de campanha permanecem atrás do gate.
    '/email-manager/track/open',
    '/email-manager/track/click',
    '/email-manager/unsubscribe',
    '/email-manager/unsubscribe/post',
    // Meta verifica e entrega o webhook sem sessão de navegador. A rota POST
    // valida HMAC com o App Secret e o GET exige o verify token; liberar só
    // este endpoint não abre as rotas administrativas do WhatsApp Manager.
    '/whatsapp-manager/meta/webhook',
]);
const MACHINE_AGENT_PUBLIC_PATHS = new Set([
    '/machine-registry/activations',
    '/machine-registry/activations/status',
    '/machine-registry/heartbeat',
    // Server-to-server only: each handler additionally requires the shared
    // Edge secret and uses timing-safe comparison.
    '/machine-registry/tunnel/authenticate',
    '/machine-registry/tunnel/state',
]);
// Machine-to-gateway endpoints. They do not use browser sessions; each handler
// fails closed unless the configured project-mail Bearer token matches.
const PROJECT_MAIL_GATEWAY_PUBLIC_PATHS = new Set([
    '/project-mail-gateway/v1/mailboxes/reserve',
    '/project-mail-gateway/v1/messages/send',
]);
const PUBLIC_REDIRECT_PATHS = new Set(['/redirect/home']);
const FLUTTER_STUDIO_PUBLIC_DOWNLOAD = /^\/flutter-studio\/download\/[a-z0-9][a-z0-9.-]*\/(?:[a-z0-9][a-z0-9.-]*\.apk|manifest\.json)$/;
const PUBLIC_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');
const PRIVATE_PUBLIC_DIRECTORY = path.join(PUBLIC_DIRECTORY, 'private');

function isPublicStaticFile(requestPath) {
    if (typeof requestPath !== 'string' || !requestPath.startsWith('/')) return false;

    let decodedPath;
    try { decodedPath = decodeURIComponent(requestPath); } catch { return false; }
    if (decodedPath.includes('\\') || decodedPath.split('/').some((segment) => segment === '.' || segment === '..')) return false;

    const filePath = path.resolve(PUBLIC_DIRECTORY, `.${decodedPath}`);
    if (!filePath.startsWith(`${PUBLIC_DIRECTORY}${path.sep}`)) return false;
    if (filePath === PRIVATE_PUBLIC_DIRECTORY || filePath.startsWith(`${PRIVATE_PUBLIC_DIRECTORY}${path.sep}`)) return false;

    try {
        // Não siga symlinks: um arquivo colocado no diretório público não pode
        // tornar acessível conteúdo de fora dele por acidente.
        return fs.lstatSync(filePath).isFile();
    } catch {
        return false;
    }
}

// Acessível a qualquer usuário logado (não só admin) — self-service de
// créditos/pagamento, ao contrário do resto dos apps do gateway.
const AUTHENTICATED_USER_PREFIXES = ['/billing/wallet', '/billing/checkout', '/view/billing/', '/store/', '/view/store/', '/machine-registry/', '/view/machine-registry/'];

export function isPublicPath(path, method = 'GET') {
    if (isPublicStaticFile(path)) return true;
    if (FLUTTER_STUDIO_PUBLIC_DOWNLOAD.test(path)) return true;
    if (PUBLIC_EXACT_PATHS.has(path)) return true;
    if (MACHINE_AGENT_PUBLIC_PATHS.has(path)) return true;
    if (PROJECT_MAIL_GATEWAY_PUBLIC_PATHS.has(path)) return true;
    if (PUBLIC_REDIRECT_PATHS.has(path)) return true;
    if (isPublicExposure(path)) return true;
    if (isPublicRoute(path, method)) return true;
    if (isPublicView(path)) return true;
    return PUBLIC_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function requiredDelegatedCapability(method, path) {
    const readOnly = ['GET', 'HEAD'].includes(String(method || 'GET').toUpperCase());
    if (path.startsWith('/machine-registry/') || path.startsWith('/view/machine-registry/')) {
        return readOnly ? 'machines.view' : 'machines.manage';
    }
    if (path.startsWith('/git-cloud/') || path.startsWith('/view/git-cloud/')) {
        return readOnly ? 'git.view' : (/\/deployments(?:\/|$)/.test(path) ? 'git.deploy' : 'git.write');
    }
    return null;
}

// O gate é compartilhado por navegação de páginas e pela API. Redirecionar
// uma chamada fetch/curl sem sessão para o HTML de Login faz o consumidor
// interpretar o documento como resposta da API (ou esconder o 401 original).
// Só navegações de documento devem receber o redirect; os demais clientes
// recebem um erro HTTP que podem tratar e, no browser, a própria view leva o
// usuário ao login.
export function expectsHtmlDocument(req = {}) {
    const method = String(req.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD'].includes(method)) return false;
    const accept = String(req.headers?.accept || '');
    return /(?:^|,)\s*text\/html(?:\s*;|\s*,|$)/i.test(accept);
}

function activeEntitlements(db, userId) {
    return (db.appentitlement.query({ userId, status: 'active' }) || [])
        .map((item) => item.appSlug)
        .filter((slug) => getDistributedApp(slug));
}

async function ensureEntitlement(db, userId, appSlug, source = 'public-flow') {
    const app = getDistributedApp(appSlug);
    if (!app) return null;
    const id = `${userId}:${app.slug}`;
    const existing = db.appentitlement[id] || db.appentitlement.findOne({ userId, appSlug: app.slug });
    if (existing) {
        existing.status = 'active';
        return existing;
    }
    try {
        return await db.appentitlement.push({ id, userId, appSlug: app.slug, status: 'active', source });
    } catch (error) {
        // Duas abas podem adquirir o app ao mesmo tempo. O id determinístico
        // transforma a corrida em leitura idempotente, não em dois vínculos.
        const raced = db.appentitlement[id];
        if (raced) return raced;
        throw error;
    }
}

export async function accessGate(req, res, next) {
    // Link de saída deliberadamente na raiz para poder ser usado em menus,
    // favoritos e redirecionamentos externos. A operação é idempotente: abrir
    // o link sem uma sessão também termina na tela de login.
    if (req.path === '/logout' && String(req.method || 'GET').toUpperCase() === 'GET') {
        return logout(req, res);
    }

    const retiredAccount = await identityProvider.resolve(req);
    if (retiredAccount && isRetiredLocalAccount(retiredAccount.user)) {
        return res.status(410).json({ error: 'Este tipo de conta foi descontinuado.' });
    }
    // Integrações do próprio Runtime não têm cookie de navegador. Elas usam o
    // segredo efêmero da instância, rotacionado a cada reinício. A autorização
    // de negócio (por exemplo, chat Telegram ativado) permanece no integrador.
    if (req.path.startsWith('/agent/')) {
        const token = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '');
        if (token) {
            const { isValidBridgeToken } = await import('../agent/core/session_channel.js');
            if (isValidBridgeToken(token)) return next();
        }
    }
    if (isPublicPath(req.path, req.method)) {
        // A rota continua pública, mas uma sessão válida permite ao resolvedor
        // de views escolher Index.svelte antes de Index.public.svelte.
        if (req.path === '/' || req.path === '/redirect/home' || req.path.startsWith('/view/') || req.path.startsWith('/auth/')) {
            const resolved = await identityProvider.resolve(req);
            if (resolved) attachPrincipal(req, resolved.principal, resolved.user);
        }
        return next();
    }

    const db = getProxy('auth');
    const resolved = await identityProvider.resolve(req);
    if (!resolved) {
        if (!expectsHtmlDocument(req)) {
            return res.status(401).json({
                error: 'Credencial ausente ou expirada.',
                code: 'UNAUTHENTICATED',
            });
        }
        return res.redirect(signInRedirect(req));
    }
    const { user, session } = resolved;
    // `principal` é o contexto canônico. req.user sobrevive só para os
    // consumidores que ainda não migraram.
    attachPrincipal(req, resolved.principal, user);
    const delegatedCapabilities = (() => {
        try { return JSON.parse(session.delegatedCapabilities || '[]'); } catch { return []; }
    })();
    if (session.delegatedSubject) {
        req.user.delegatedSubject = session.delegatedSubject;
        req.user.capabilities = delegatedCapabilities;
        const required = requiredDelegatedCapability(req.method, req.path);
        if (!required || (!delegatedCapabilities.includes('*') && !delegatedCapabilities.includes(required))) {
            return res.status(403).send({ error: 'A sessão delegada não permite esta operação.' });
        }
        return next();
    }

    if (user.role === 'admin') return next();

    // O catálogo do Shell nunca foi uma fronteira de segurança: uma pessoa
    // podia digitar a URL de uma view protegida. A mesma declaração
    // manifest.access.views agora é aplicada antes de o motor de Views do
    // Lógos compilar ou entregar a página.
    if (req.path.startsWith('/view/')) {
        const access = authorizeViewRequest({ requestPath: req.path, userId: user.id, database: db, catalog: permissionCatalog });
        if (!access.allowed) {
            // Uma URL de view pode vir de favorito, histórico ou de um menu
            // que acabou de perder acesso. Em vez de expor o JSON técnico ao
            // navegador, volta ao resolvedor de entrada: ele escolhe o home
            // configurado para a role/grupo atual do usuário.
            if (['GET', 'HEAD'].includes(String(req.method || 'GET').toUpperCase())) {
                return res.redirect(AUTHENTICATED_HOME);
            }
            return res.status(403).send({ error: 'Permissão insuficiente para esta view.', permission: access.permission });
        }
    }

    if (AUTHENTICATED_USER_PREFIXES.some((prefix) => req.path.startsWith(prefix))) return next();

    // CNPJ Scraper is an intentionally self-contained product role. Its
    // declared view permission also admits the package API, so an operator can
    // run searches without receiving a broad application entitlement.
    if (req.path.startsWith('/cnpj-scraper/')
        && authorize({ userId: user.id, permission: 'cnpj-scraper.read', database: db, catalog: permissionCatalog }).allowed) {
        return next();
    }

    const entitled = activeEntitlements(db, user.id)
        .some((appSlug) => pathBelongsToApp(req.path, appSlug));
    if (entitled) return next();
    if (pathBelongsToApp(req.path, 'lectio')) {
        return res.status(403).send({ error: 'Acesso ao Lectio não concedido.' });
    }

    // Contas sem um app concedido permanecem no Runtime público. Não há
    // redirecionamento para uma instância, pois o cadastro não provisiona
    // infraestrutura individual.
    return res.redirect('/');
}

const DELEGATION_APPS = Object.freeze({
    machines: { scope: 'delegate:machines', capabilities: ['machines.view', 'machines.manage'], redirectPath: '/view/machine-registry/Machines' },
    git: { scope: 'delegate:git', capabilities: ['git.view', 'git.write', 'git.deploy'], redirectPath: '/view/git-cloud/Index' },
});

export async function issueDelegatedTicket(req, res) {
    /**
     * @register_router delegation/issue
     * @method POST
     */
    const app = DELEGATION_APPS[String(req.body?.app || '')];
    if (!app) return { status: 400, error: 'App de delegação inválido.' };
    const authHeader = req.headers?.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const resolved = await resolveProxyCredential(token, app.scope);
    if (!resolved?.userId) return { status: 403, error: 'Credencial sem escopo de delegação.' };
    const requested = Array.isArray(req.body?.capabilities) ? req.body.capabilities : [];
    const capabilities = requested.filter((capability) => app.capabilities.includes(capability));
    if (!capabilities.length) return { status: 400, error: 'Nenhuma capability válida foi solicitada.' };
    const raw = crypto.randomBytes(32).toString('base64url');
    const db = getProxy('auth');
    await db.delegatedTicket.push({
        tokenHash: crypto.createHash('sha256').update(raw).digest('hex'),
        userId: resolved.userId,
        subject: String(req.body?.subject || 'tenant-user').slice(0, 120),
        capabilities: JSON.stringify(capabilities),
        redirectPath: app.redirectPath,
        expiresAt: new Date(Date.now() + 60_000),
    });
    return { status: 200, url: `/auth/delegation?ticket=${encodeURIComponent(raw)}` };
}

export async function consumeDelegatedTicket(req, res) {
    /**
     * @register_router delegation
     * @method GET
     */
    const raw = String(req.query?.ticket || '');
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const db = getProxy('auth');
    const ticket = db.delegatedTicket.findOne({ tokenHash: hash });
    if (!ticket || new Date(ticket.expiresAt).getTime() < Date.now()) return res.redirect('/auth/login');
    await db.delegatedTicket.delete(ticket.id).catch(() => {});
    const durationMs = 8 * 60 * 60 * 1000;
    const session = await db.session.push({
        userId: ticket.userId,
        expiresAt: new Date(Date.now() + durationMs),
        delegatedCapabilities: ticket.capabilities,
        delegatedSubject: ticket.subject,
    });
    res.setHeader('Set-Cookie', sessionCookie(req, session.id, durationMs));
    return res.redirect(ticket.redirectPath);
}

// --- HOOKS ---

export async function setupUser(payload, context) {
    /**
     * @register_hook boot
     */
    const db = getProxy('auth');

    // Scriba retorna '' (não undefined) pra colunas novas em registros
    // antigos que nunca tiveram esse campo — precisa checar os dois casos,
    // mas sem mexer num inviteBalance=0 já consumido de propósito.
    const isUnset = (v) => v === undefined || v === null || v === '';

    const users = db.user.all ? await db.user.all() : [];
    for (const user of users || []) {
        const rec = db.user[user.id];
        if (isUnset(user.role)) {
            rec.role = 'user';
        }
        if (isUnset(user.inviteBalance)) {
            rec.inviteBalance = 0;
        }
    }

    startDevAccountReaper();
    repairLegacyBillingCredentials().catch((error) => {
        console.error(`[auth] migração de credenciais de billing falhou: ${error.message}`);
    });
}

export async function credentialVerify(payload, ctx) {
    /**
     * @register_hook credential:verify
     * Provider de sessão ThinkIac para o guard neutro de credenciais.
     */
    const req = ctx?.req || payload?.req;
    const resolved = await identityProvider.resolve(req);
    if (!resolved) return { allowed: false, status: 401, message: 'Credencial ausente ou expirada.' };
    attachPrincipal(req, resolved.principal, resolved.user);
    return { allowed: true, principal: resolved.principal };
}

// --- ROTEADORES (CONTROLLERS) ---

export async function login(req, res) {
    /**
     * @register_router login
     * @public true
     * @method POST
     */
    const { email, password } = req.body || {};
    const db = getProxy('auth');

    const user = await db.user.findOne({ email });

    if (user && !user.disabled && !isRetiredLocalAccount(user) && await verifyPassword(password, user.password) && !user.disabled) {
        // Sinal de "acesso real" pro reaper de contas develop (ver
        // reapIdleDevAccounts) — o único ponto de login visível ao gateway
        // central, já que o container do tenant não reporta uso de volta.
        user.lastActivityAt = new Date();

        const durationMs = parseInt(process.env.AUTH_ENV_SESSION_DURATION_MS) || 86400000;
        const expiresAt = new Date(Date.now() + durationMs);

        const session = await db.session.push({
            userId: user.id,
            expiresAt: expiresAt
        });

        res.setHeader('Set-Cookie', sessionCookie(req, session.id, durationMs));

        return {
            success: true,
            role: user.role,
            accountType: user.accountType,
            redirectUrl: AUTHENTICATED_HOME,
        };
    }

    return { status: 400, error: 'Credentials not found.' };
}

/** Encerra a sessão atual e impede que o navegador a reutilize. */
async function endBrowserSession(req, res) {
    const sessionId = parseCookies(req.headers?.cookie).sessionId;
    if (sessionId) {
        await getProxy('auth').session.delete(sessionId).catch(() => {});
    }
    // Usa os mesmos atributos de escopo e segurança do cookie de login para
    // garantir que a remoção alcance a sessão, inclusive atrás de proxy HTTPS.
    res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
}

export async function logout(req, res) {
    /**
     * @register_router logout
     * @public true
     * @method GET
     */
    await endBrowserSession(req, res);
    return res.redirect(SIGN_IN_VIEW);
}

export async function getUser(req, res) {
    /**
     * @register_router get
     * @method GET
     */
    const resolved = await identityProvider.resolve(req);
    if (resolved) {
        attachPrincipal(req, resolved.principal, resolved.user);
        return { ...resolved.user, ssoUrl: null };
    }

    return {
        status: 401,
        message: 'Not Authorized.'
    }
}

async function hasUsers(db) {
    const users = db.user.all ? await db.user.all() : [];
    return (users || []).length > 0;
}

export async function initialSetupStatus(req) {
    /**
     * @register_router initial-setup
     * @public true
     * @method GET
     */
    const db = getProxy('auth');
    const settings = db.authsettings?.findOne?.({ id: 'default' });
    return {
        initialSetupRequired: !(await hasUsers(db)),
        settings: {
            registrationEnabled: settings?.registrationEnabled !== false,
            invitationsEnabled: settings?.invitationsEnabled !== false,
        },
    };
}

export async function createInitialAdmin(req, res) {
    /**
     * @register_router initial-admin
     * @public true
     * @method POST
     */
    if (initialAdminCreationInProgress) {
        return res.status(409).send({ error: 'Initial setup is already in progress.' });
    }

    initialAdminCreationInProgress = true;
    try {
        const { name, email, password, username: rawUsername } = req.body || {};
        const normalizedEmail = String(email || '').trim().toLowerCase();
        const db = getProxy('auth');

        if (await hasUsers(db)) {
            return res.status(403).send({ error: 'Initial setup is no longer available.' });
        }
        if (!String(name || '').trim() || !normalizedEmail || !password) {
            return res.status(400).send({ error: 'Name, email, username, and password are required.' });
        }
        const { valid, username, reason } = validateUsername(rawUsername);
        if (!valid) return res.status(400).send({ error: reason });

        const user = await db.user.push({
            name: String(name).trim(),
            email: normalizedEmail,
            username,
            password: await hashPasswordAsync(password),
            role: 'admin',
            inviteBalance: 0,
            emailVerified: true,
            tenantStatus: null,
        });
        await startSession(req, res, user.id);
        return { success: true, role: user.role, initialSetup: true };
    } finally {
        initialAdminCreationInProgress = false;
    }
}

export async function register(req, res) {
    /**
     * @register_router register
     * @public true
     * @method POST
     */
    const { name, email, password, username: rawUsername, invitationCode: rawInvitationCode } = req.body || {};
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const app = distributedApp(req.body || {});
    const db = getProxy('auth');

    const settings = db.authsettings?.findOne?.({ id: 'default' });
    const registrationEnabled = settings?.registrationEnabled !== false;
    const invitationsEnabled = settings?.invitationsEnabled !== false;
    const invitationCode = String(rawInvitationCode || '').trim().toUpperCase();
    const invitation = invitationCode ? db.invite?.findOne?.({ code: invitationCode }) : null;
    const validInvitation = !!(invitation && !invitation.consumed && !invitation.revoked &&
        (!invitation.expiresAt || new Date(invitation.expiresAt).getTime() > Date.now()));

    if (!registrationEnabled && (!invitationsEnabled || !validInvitation)) {
        return res.status(403).send({ error: invitationsEnabled ? 'A valid invitation code is required.' : 'Registration is currently disabled.' });
    }

    if (req.body?.flow === 'app' && !app) {
        return res.status(400).send({ error: 'Aplicativo não distribuível.' });
    }

    if (!email || !password) {
        return res.status(400).send({ error: 'E-mail e senha são obrigatórios.' });
    }

    const { valid, username, reason } = validateUsername(rawUsername);
    if (!valid) {
        return res.status(400).send({ error: reason });
    }

    const existingUser = db.user.findOne({ email: normalizedEmail });
    if (existingUser) {
        return res.status(409).send({ error: 'Email is already registered.' });
    }

    const existingUsername = db.user.findOne({ username });
    if (existingUsername) {
        return res.status(409).send({ error: 'Username is already registered.' });
    }

    let user;
    try {
        user = await db.user.push({
            name,
            email: normalizedEmail,
            username,
            password: await hashPasswordAsync(password),
            role: 'user',
            inviteBalance: 0,
            emailVerified: false,
            // Uma conta é somente uma identidade do Runtime. Infraestrutura não é
            // criada como efeito colateral do cadastro.
            tenantStatus: null
        });
    } catch (error) {
        const field = /(?:User\.)?username/i.test(String(error?.message || '')) ? 'username' : 'email';
        const conflict = uniqueConflict(error, field);
        if (conflict) return res.status(conflict.status).send({ error: conflict.error });
        throw error;
    }

    // Roles declaradas são grupos de permissões, não o campo estrutural
    // User.role. Assim, um cadastro público nunca pode se tornar admin por
    // configuração. Se o pacote que declarou o role foi removido, falhamos
    // fechado e mantemos o novo usuário sem esse acesso extra.
    const defaultGroupId = registrationEnabled ? String(settings?.defaultRoleGroupId || '') : '';
    let group = defaultGroupId ? db.permissionGroup[defaultGroupId] : null;
    if (!group && registrationEnabled) {
        const defaultRole = permissionCatalog.get(settings?.defaultRolePackage, settings?.defaultRoleGroup);
        if (canBeDefaultRegistrationRole(defaultRole)) {
            group = (db.permissionGroup.query({ declaredPackage: defaultRole.packageName, declaredGroup: defaultRole.id }) || [])[0]
                || await db.permissionGroup.push({ name: defaultRole.label, declaredPackage: defaultRole.packageName, declaredGroup: defaultRole.id });
        }
    }
    if (group && canBeDefaultRoleGroup(db, group)) {
        const membership = (db.permissionMembership.query({ userId: user.id, groupId: group.id }) || [])[0];
        if (!membership) await db.permissionMembership.push({ userId: user.id, groupId: group.id });
    }

    if (validInvitation) {
        invitation.consumed = true;
        invitation.consumedByUserId = user.id;
        invitation.consumedAt = new Date().toISOString();
    }

    if (app) {
        await ensureEntitlement(db, user.id, app.slug);
    }
    await startSession(req, res, user.id);
    // Entrega de e-mail não atrasa o acesso nem invalida o cadastro concluído.
    createAndSendEmailVerification(db, user).catch((error) => console.error('[auth] confirmação pendente:', error.message));
    return { success: true, role: user.role, provisioning: false, requiresEmailVerification: false, emailVerificationPending: true, email: user.email };

}

export async function resendVerification(req) {
    /**
     * @register_router resend-verification
     * @method POST
     * @requireCredential
     */
    if (!req.user?.id) return { status: 401, error: 'Sessão necessária.' };
    const db = getProxy('auth');
    const user = db.user[req.user.id];
    if (!user) return { status: 401, error: 'Sessão inválida.' };
    if (user.emailVerified) return { success: true, alreadyVerified: true };
    const recent = db.emailverification.query({ userId: user.id }, { sort: 'createdAt DESC', limit: 1 }) || [];
    if (recent[0] && Date.now() - new Date(recent[0].createdAt).getTime() < 60_000) return { status: 429, error: 'Aguarde um minuto antes de reenviar.' };
    await createAndSendEmailVerification(db, user);
    return { success: true };
}

export async function confirmEmail(req, res) {
    /**
     * @register_router confirm-email
     * @public true
     * @method POST
     */
    const db = getProxy('auth');
    const user = await confirmEmailVerification(db, req.body || {});
    if (!user) return { status: 400, error: 'Código ou link de confirmação inválido ou expirado.' };
    await startSession(req, res, user.id);
    return { success: true, role: user.role, provisioning: false, redirectUrl: AUTHENTICATED_HOME };
}

export async function verifyEmail(req, res) {
    /**
     * @register_router verify-email
     * @public true
     * @method GET
     */
    const db = getProxy('auth');
    const user = await confirmEmailVerification(db, { token: req.query?.token });
    if (!user) return res.redirect('/view/auth/Login?email-verification=invalid');
    await startSession(req, res, user.id);
    return res.redirect('/view/auth/Login?email-verification=confirmed');
}

// --- LOGIN COM GOOGLE (OAUTH 2.0 + PKCE) ---
//
// Por que o fluxo é tão indireto: o Google recusa OAuth dentro de WebView
// embutida (403 disallowed_useragent), e o app mobile (apps/mobile) é
// exatamente uma WebView. Então o consentimento precisa abrir FORA dela, num
// Chrome Custom Tab — que tem cookie jar próprio, separado do da WebView.
// Daí o LoginTicket: o callback não consegue gravar o cookie de sessão na
// WebView, então devolve um ticket de uso único por deep link
// (thinkiac://open/auth?ticket=…), e a WebView o troca por cookie numa
// navegação top-level normal. Nenhum token de sessão passa por JavaScript.
//
// Para client=web/electron o ticket não existe: o callback já grava o cookie.

const OAUTH_FLOW_TTL_MS = 10 * 60 * 1000;
const LOGIN_TICKET_TTL_MS = 60 * 1000;

function gatewayBaseUrl() {
    return `https://${process.env.CLOUD_ENV_THINKIAC_DOMAIN || 'thinkiac.cloud'}`;
}

function googleRedirectUri() {
    return `${gatewayBaseUrl()}/auth/google/callback`;
}

function sessionCookie(req, sessionId, durationMs) {
    return sessionCookieFor(sessionId, durationMs, {
        insecure: !shouldUseSecureSessionCookie(req, {
            insecureOverride: process.env.AUTH_ENV_INSECURE_COOKIES === '1',
        }),
    });
}

export async function startSession(req, res, userId) {
    const db = getProxy('auth');
    const durationMs = parseInt(process.env.AUTH_ENV_SESSION_DURATION_MS) || 86400000;
    const session = await db.session.push({
        userId,
        expiresAt: new Date(Date.now() + durationMs),
    });
    res.setHeader('Set-Cookie', sessionCookie(req, session.id, durationMs));
    return session;
}

function loginRedirect(reason) {
    return `/view/auth/Login?erro=${encodeURIComponent(reason)}`;
}

// Varre estado expirado. O jti em memória do tenant-auth cresce sem limite e
// zera no restart; aqui as linhas são persistidas e limpas por tempo.
async function sweepOauthState() {
    const db = getProxy('auth');
    const agora = new Date();
    for (const tabela of ['oauthflow', 'loginticket']) {
        // query() do scriba já filtra deletedAt IS NULL, então linhas
        // queimadas (delete() é soft) não reaparecem aqui.
        const vencidas = db[tabela].query({ expiresAt: { $lt: agora } }) || [];
        for (const linha of vencidas) await db[tabela].delete(linha.id).catch(() => {});
    }
}

export async function googleStart(req, res) {
    /**
     * @register_router google/start
     * @method GET
     */
    const clientId = process.env.AUTH_ENV_GOOGLE_CLIENT_ID;
    if (!clientId) return res.redirect(loginRedirect('google-nao-configurado'));

    const client = normalizeClient(req.query?.client);
    const app = distributedApp(req.query || {});
    if (req.query?.flow === 'app' && !app) {
        return res.redirect(loginRedirect('app-invalido'));
    }

    // Só caminho relativo — impede open redirect via ?next=https://malicioso.
    // safeNext devolve o fallback quando o destino não presta; guardamos null
    // nesse caso para o callback usar o default dele.
    const next = app ? appDestination(app.slug) : safeNext(req.query?.next, null);

    const state = crypto.randomBytes(32).toString('base64url');
    const nonce = crypto.randomBytes(16).toString('base64url');
    const codeVerifier = crypto.randomBytes(64).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    const db = getProxy('auth');
    await db.oauthflow.push({
        state,
        codeVerifier,
        nonce,
        client,
        next,
        appSlug: app?.slug || null,
        expiresAt: new Date(Date.now() + OAUTH_FLOW_TTL_MS),
    });
    sweepOauthState().catch(() => {});

    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: googleRedirectUri(),
        response_type: 'code',
        scope: 'openid email profile',
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        // Evita reaproveitar silenciosamente a sessão do navegador quando o
        // usuário quer trocar de conta.
        prompt: 'select_account',
    });

    return res.redirect(`${GOOGLE_AUTH_URL}?${params}`);
}

export async function googleCallback(req, res) {
    /**
     * @register_router google/callback
     * @method GET
     */
    const db = getProxy('auth');

    if (req.query?.error) return res.redirect(loginRedirect('google-cancelado'));

    const { code, state } = req.query || {};
    if (!code || !state) return res.redirect(loginRedirect('google-resposta-incompleta'));

    const flow = await db.oauthflow.findOne({ state });
    if (!flow) return res.redirect(loginRedirect('google-estado-invalido'));

    // Uso único: some antes de qualquer await de rede, para que o mesmo code
    // não possa ser processado duas vezes em paralelo.
    await db.oauthflow.delete(flow.id).catch(() => {});

    if (new Date(flow.expiresAt).getTime() < Date.now()) {
        return res.redirect(loginRedirect('google-estado-expirado'));
    }

    let tokenPayload;
    try {
        const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: process.env.AUTH_ENV_GOOGLE_CLIENT_ID || '',
                client_secret: process.env.AUTH_ENV_GOOGLE_CLIENT_SECRET || '',
                redirect_uri: googleRedirectUri(),
                grant_type: 'authorization_code',
                code_verifier: flow.codeVerifier,
            }),
            signal: AbortSignal.timeout(15000),
        });
        if (!tokenRes.ok) return res.redirect(loginRedirect('google-troca-falhou'));
        tokenPayload = await tokenRes.json();
    } catch {
        return res.redirect(loginRedirect('google-indisponivel'));
    }

    const claims = decodeIdTokenClaims(tokenPayload?.id_token);
    const problema = validateIdTokenClaims(claims, {
        expectedNonce: flow.nonce,
        expectedAudience: process.env.AUTH_ENV_GOOGLE_CLIENT_ID,
    });
    if (problema) {
        console.warn('[auth] id_token do Google recusado:', problema);
        return res.redirect(loginRedirect('google-token-invalido'));
    }

    // Google é também uma forma de cadastro. Só permite criar uma identidade
    // nova quando o registro público está aberto e o Runtime não exige convite.
    // Contas já existentes continuam podendo entrar normalmente.
    const settings = db.authsettings?.findOne?.({ id: 'default' });
    const registrationEnabled = settings?.registrationEnabled !== false;
    const invitationsEnabled = registrationEnabled && settings?.invitationsEnabled === true;
    const autolink = process.env.AUTH_ENV_GOOGLE_AUTOLINK !== '0';
    const normalizedGoogleEmail = String(claims.email || '').trim().toLowerCase();
    const existingGoogleUser = await db.user.findOne({ googleSub: claims.sub });
    const existingEmailUser = autolink ? await db.user.findOne({ email: normalizedGoogleEmail }) : null;
    if (!existingGoogleUser && !existingEmailUser && (!registrationEnabled || invitationsEnabled)) {
        return res.redirect(loginRedirect('google-registration-disabled'));
    }

    const { user, created } = await resolveGoogleUser(db.user, claims, {
        // Lazily evaluated: logins de contas existentes não pagam PBKDF2 nem
        // criam material secreto descartável.
        passwordHash: () => hashPasswordAsync(crypto.randomBytes(48).toString('base64url')),
        autolink,
    });

    if (user.disabled || isRetiredLocalAccount(user)) return res.redirect(loginRedirect('conta-bloqueada'));

    // Mesmo sinal de "acesso real" que login() carimba, para o reaper de
    // contas develop não varrer quem só entra por Google.
    user.lastActivityAt = new Date();
    await requestWelcomeCredit(user.id);

    if (flow.appSlug) {
        await ensureEntitlement(db, user.id, flow.appSlug);
        if (created) user.tenantStatus = null;
    }

    // A autenticação não provisiona infraestrutura. O destino padrão passa
    // pelo Redirect, que decide a página conforme o cargo da pessoa.
    const destino = safeNext(flow.next, AUTHENTICATED_HOME);

    // android: Custom Tab; electron: navegador padrão do sistema. Nos dois o
    // consentimento roda num cookie jar que não é o da janela do app, então
    // gravar o cookie aqui não serviria de nada — devolve ticket por deep link.
    // Só o navegador comum (client=web) recebe cookie direto, porque aí quem
    // consentiu e quem vai usar a sessão são a mesma janela.
    if (precisaDeTicket(flow.client)) {
        const token = crypto.randomBytes(32).toString('base64url');
        await db.loginticket.push({
            token,
            userId: user.id,
            consumed: false,
            expiresAt: new Date(Date.now() + LOGIN_TICKET_TTL_MS),
        });
        const params = new URLSearchParams({ ticket: token, next: destino });
        return res.redirect(`thinkiac://open/auth?${params}`);
    }

    await startSession(req, res, user.id);
    return res.redirect(destino);
}

export async function ticket(req, res) {
    /**
     * @register_router ticket
     * @method GET
     */
    const db = getProxy('auth');
    const token = req.query?.ticket;
    if (!token) return res.redirect(loginRedirect('ticket-ausente'));

    const found = await db.loginticket.findOne({ token });
    if (!found) return res.redirect(loginRedirect('ticket-invalido'));

    // Queima primeiro, valida depois — uma corrida entre duas requisições não
    // pode resultar em duas sessões.
    await db.loginticket.delete(found.id).catch(() => {});

    if (found.consumed) return res.redirect(loginRedirect('ticket-reusado'));
    if (new Date(found.expiresAt).getTime() < Date.now()) return res.redirect(loginRedirect('ticket-expirado'));

    const user = db.user[found.userId];
    if (!user) return res.redirect(loginRedirect('ticket-orfao'));

    await startSession(req, res, user.id);
    return res.redirect(safeNext(req.query?.next, AUTHENTICATED_HOME));
}

// dispatchEvent() é um pipeline (packages/logos/dist/src/kernel/bus.js): sem
// nenhum listener pro evento, ele devolve o payload original inalterado — não
// um Error. Por isso "sucesso" precisa ser checado positivamente (domain +
// tenantId reais vindos do handler), não só "não é Error", senão um pacote
// `cloud` desativado/sem hook registrado vira um falso "ready" silencioso.
function tenantCreateSucceeded(result, expectedPlanId = null) {
    return !!result && typeof result === 'object' && !(result instanceof Error)
        && typeof result.domain === 'string' && result.domain.length > 0
        && typeof result.tenantId === 'string' && result.tenantId.length > 0
        && (!expectedPlanId || result.planId === expectedPlanId);
}

async function issueTenantCredentialPair(db, userId) {
    const create = async (scopes) => {
        const issued = issueProxyToken();
        const record = await db.proxyCredential.push({
            tokenId: issued.tokenId, tokenHash: issued.tokenHash, userId, tenantId: null,
            scopes: JSON.stringify(scopes), status: 'pending', spentMicros: 0, maxRequestsPerMinute: 60,
        });
        return { issued, record };
    };
    const llm = await create(DEFAULT_TENANT_SCOPES);
    const billing = await create(DEFAULT_BILLING_SCOPES);
    return {
        env: { LLM_PROXY_TOKEN: llm.issued.token, BILLING_PROXY_TOKEN: billing.issued.token },
        credentialIds: [llm.record.id, billing.record.id],
        records: [llm.record, billing.record],
    };
}

async function activateTenantCredentialPair(db, userId, credentialIds, tenantId) {
    const current = new Set(credentialIds || []);
    for (const id of current) {
        const record = db.proxyCredential[id];
        if (!record || record.userId !== userId) continue;
        record.tenantId = tenantId;
        record.status = 'active';
    }
    for (const older of db.proxyCredential.query({ userId, tenantId }) || []) {
        if (current.has(older.id) || older.revokedAt) continue;
        older.status = 'revoked';
        older.revokedAt = new Date();
    }
}

export function activeCredentialWithScope(records, scope) {
    return (records || []).find((record) => record.status === 'active'
        && !record.revokedAt && credentialHasScope(record, scope)) || null;
}

async function repairLegacyBillingCredentials() {
    const billingUrl = (process.env.CLOUD_ENV_BILLING_URL || '').replace(/\/$/, '');
    const adminToken = process.env.BILLING_ADMIN_TOKEN || '';
    if (!billingUrl || !adminToken) return;

    const db = getProxy('auth');
    const users = db.user.all ? await db.user.all() : [];
    for (const user of users || []) {
        if (!user.tenantId || user.tenantStatus !== 'ready') continue;
        const records = db.proxyCredential.query({ userId: user.id, tenantId: user.tenantId }) || [];
        if (activeCredentialWithScope(records, 'billing:read')) continue;

        const issued = issueProxyToken();
        const record = await db.proxyCredential.push({
            tokenId: issued.tokenId,
            tokenHash: issued.tokenHash,
            userId: user.id,
            tenantId: user.tenantId,
            scopes: JSON.stringify(DEFAULT_BILLING_SCOPES),
            status: 'pending',
            spentMicros: 0,
            maxRequestsPerMinute: 60,
        });

        try {
            const customerResponse = await fetch(`${billingUrl}/admin/customers/${encodeURIComponent(user.tenantId)}`, {
                headers: { [BILLING_ADMIN_HEADER]: adminToken },
            });
            const customer = await customerResponse.json().catch(() => null);
            if (!customerResponse.ok || !customer?.image || !customer?.plan) {
                throw new Error(`estado desejado indisponível (HTTP ${customerResponse.status})`);
            }
            const response = await fetch(`${billingUrl}/admin/customers/${encodeURIComponent(user.tenantId)}/plan`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', [BILLING_ADMIN_HEADER]: adminToken },
                body: JSON.stringify({
                    plan: customer.plan,
                    addons: customer.addons || {},
                    image: customer.image,
                    expose: customer.expose,
                    env: { ...(customer.env || {}), BILLING_PROXY_TOKEN: issued.token },
                }),
            });
            const result = await response.json().catch(() => null);
            if (!response.ok || result?.reconcile?.error || result?.reconcile?.dryRun) {
                throw new Error(result?.reconcile?.error || result?.error || `reconcile HTTP ${response.status}`);
            }
            record.status = 'active';
            for (const older of records) {
                if (older.id === record.id || !credentialHasScope(older, 'billing:read')) continue;
                older.status = 'revoked';
                older.revokedAt = new Date();
            }
            console.log(`[auth] credencial de billing separada aplicada ao tenant ${user.tenantId}.`);
        } catch (error) {
            record.status = 'revoked';
            record.revokedAt = new Date();
            console.error(`[auth] tenant ${user.tenantId} manteve credenciais atuais: ${error.message}`);
        }
    }
}

export async function onIssueTenantCredentials(payload) {
    /**
     * @register_hook auth:issue-tenant-credentials
     */
    if (!payload?.userId) return null;
    const pair = await issueTenantCredentialPair(getProxy('auth'), payload.userId);
    return { env: pair.env, credentialIds: pair.credentialIds };
}

export async function onActivateTenantCredentials(payload) {
    /**
     * @register_hook auth:activate-tenant-credentials
     */
    if (!payload?.userId || !payload?.tenantId || !Array.isArray(payload?.credentialIds)) return null;
    await activateTenantCredentialPair(getProxy('auth'), payload.userId, payload.credentialIds, payload.tenantId);
    return { success: true };
}

export async function onRevokeTenantCredentials(payload) {
    /**
     * @register_hook auth:revoke-tenant-credentials
     */
    const db = getProxy('auth');
    const ids = Array.isArray(payload?.credentialIds) ? payload.credentialIds : [];
    for (const id of ids) {
        const record = db.proxyCredential[id];
        if (!record || (payload?.userId && record.userId !== payload.userId)) continue;
        record.status = 'revoked';
        record.revokedAt = new Date();
    }
    return { success: true };
}

let activationRecoveryTimer;
let activationRecoveryRunning = false;
export function startActivationRecovery() {
    /** @register_hook runtime:ready */
    const recover = async () => {
        if (activationRecoveryRunning) return;
        activationRecoveryRunning = true;
        // Recupera somente créditos pendentes. Provisionamento de tenant não é
        // uma consequência de autenticação ou de um registro antigo.
        try { await recoverActivations(getProxy('auth'), { grant: requestWelcomeCredit }); }
        catch (error) { console.error('[auth] recuperação de ativação:', error.message); }
        finally { activationRecoveryRunning = false; }
    };
    clearInterval(activationRecoveryTimer);
    activationRecoveryTimer = setInterval(recover, 60_000);
    activationRecoveryTimer.unref?.();
    recover();
}

const provisioningUsers = new Map();
function provisionTenant(userId, username, options = {}) {
    if (provisioningUsers.has(userId)) return provisioningUsers.get(userId);
    const db = getProxy('auth');
    const lease = claimActivation(db, userId);
    if (!lease) return Promise.resolve();
    const renewal = setInterval(() => updateActivationLease(db, userId, lease.leaseId, Date.now() + 300_000), 30_000);
    renewal.unref?.();
    const pending = provisionTenantOnce(userId, username, { ...options, requestId: lease.requestId })
        .catch(error => {
            const rec = db.user[userId];
            if (rec) { rec.tenantStatus = 'failed'; rec.failureReason = 'Preparação interrompida. Tentaremos novamente.'; }
            console.error('[auth] ativação interrompida:', error.message);
        }).finally(() => {
            clearInterval(renewal);
            updateActivationLease(db, userId, lease.leaseId, Date.now() + 60_000);
            provisioningUsers.delete(userId);
        });
    provisioningUsers.set(userId, pending);
    return pending;
}

async function provisionTenantOnce(userId, username, { plan, requestId } = {}) {
    const db = getProxy('auth');

    // Credencial nova por provisionamento. O segredo entra somente no env do
    // tenant; o gateway persiste o hash. A credencial anterior só é revogada
    // depois que a nova instância responde, preservando rollback/falha segura.
    const credentialPair = await issueTenantCredentialPair(db, userId);

    const tenantEnv = {
        SSO_SECRET: process.env.CLOUD_ENV_SSO_SECRET || '',
        ...credentialPair.env,
        // A credencial emitida para esta conta e o provider configurado no
        // primeiro boot precisam ser a mesma coisa. Desliga o auto-provision
        // genérico do pacote, que criaria uma segunda identidade de instalação.
        THINKIAC_API_KEY: credentialPair.env.LLM_PROXY_TOKEN,
        THINKIAC_PROVIDER_AUTO_PROVISION: '0',
        // Origem do gateway central — packages/upgrade usa isso + o
        // LLM_PROXY_TOKEN acima pra buscar/recarregar os créditos de IA
        // (apps/thinkiac/packages/billing) de dentro do container, sem
        // precisar de sessão de cookie nem pedir e-mail pra identidade.
        GATEWAY_URL: process.env.CLOUD_ENV_GATEWAY_URL
            || `https://${process.env.CLOUD_ENV_THINKIAC_DOMAIN || 'thinkiac.cloud'}`,
    };
    const appSlugs = activeEntitlements(db, userId);
    const packages = tenantPluginsFor(appSlugs);

    // Tenta reivindicar um tenant já pronto do estoque (instantâneo) antes de
    // cair pro provisionamento do zero (dezenas de segundos). Quando o pool
    // está vazio ou o pacote cloud não tem esse hook registrado, o pipeline
    // devolve o payload original (sem domain/tenantId) — tenantCreateSucceeded
    // detecta isso e o fallback abaixo roda normalmente, como sempre rodou.
    const planId = plan || 'free';
    let result = planId === 'free'
        ? await dispatchEvent('thinkiac:tenant:claim', { userId, username, planId, env: tenantEnv, packages })
        : null;

    if (result?.pending) throw new Error('Claim em recuperação; preservando o tenant reservado.');
    if (!tenantCreateSucceeded(result)) {
        result = await dispatchEvent('thinkiac:tenant:create', {
            userId,
            image: process.env.CLOUD_ENV_TENANT_IMAGE,
            subdomain: username,
            requestedTenantId: `${userId}-${requestId}`,
            planId,
            env: tenantEnv,
            packages,
        });
    }

    // Claims legados só existem no tier free. Criações novas precisam ecoar o
    // plano aplicado; sem essa confirmação o Auth não pode liberar o SSO.
    const succeeded = tenantCreateSucceeded(result, planId === 'free' && result?.planId == null ? null : planId);

    if (!succeeded) {
        for (const record of credentialPair.records) {
            record.status = 'revoked';
            record.revokedAt = new Date();
        }
        const rec = db.user[userId];
        rec.tenantStatus = 'failed';
        rec.tenantDomain = null;
        rec.tenantId = null;
        rec.failureReason = result instanceof Error
            ? String(result.message || result)
            : 'Provisionamento não respondeu (nenhum handler para "thinkiac:tenant:create" — pacote "cloud" desativado ou hook não registrado).';
        return;
    }

    // O controlador só responde depois de readiness, domínio e limites do
    // plano final terem sido validados. Só então as credenciais são ativadas
    // e o login pode receber a URL SSO.
    let rec = db.user[userId];
    await activateTenantCredentialPair(db, userId, credentialPair.credentialIds, result.tenantId);
    const providerRegistration = await dispatchEvent('thinkiac-provider:register-tenant-installation', {
        token: credentialPair.env.LLM_PROXY_TOKEN,
    });
    if (providerRegistration?.registered !== true) {
        throw new Error('A chave ThinkIac do tenant não recebeu o crédito inicial.');
    }
    rec.tenantDomain = result.domain;
    rec.tenantId = result.tenantId;
    rec.tenantStatus = 'ready';
    rec.failureReason = null;

    await requestWelcomeCredit(userId);

    const destination = getDistributedApp(appSlugs[0])?.tenantView || WARMUP_ROUTE;
    startTenantDestinationWarmup(userId, result.domain, username, destination);

}

export async function status(req, res) {
    /**
     * @register_router status
     * @method GET
     * @requireCredential
     */
    const db = getProxy('auth');
    const user = db.user[req.user.id];
    if (!user) return { status: 404, message: 'Usuário não encontrado.' };

    return {
        status: 200,
        emailVerified: user.emailVerified === true,
        welcomeCreditStatus: user.welcomeCreditStatus || 'pending',
        tenantStatus: user.tenantStatus,
        tenantDomain: user.tenantDomain,
        ssoUrl: user.tenantStatus === 'ready' ? ssoUrlFor(user.tenantDomain, user.username) : null,
        failureReason: user.failureReason,
    };
}

export async function destinationReady(req, res) {
    /**
     * @register_router destination-ready
     * @method GET
     * @requireCredential
     *
     * Sonda a rota final dentro do gateway. O browser não pode ler o status
     * da URL SSO cross-origin sem CORS, então esta rota preserva a request que
     * aquece o cache e devolve somente seu resultado seguro (200 ou 503).
     */
    const db = getProxy('auth');
    const user = db.user[req.user.id];
    if (!user) return { status: 404, message: 'Usuário não encontrado.' };
    if (user.tenantStatus !== 'ready' || !user.tenantDomain) {
        return { status: 503, ready: false, message: 'Workspace ainda está sendo preparado.' };
    }

    const probe = await probeTenantDestination(user.tenantDomain, user.username);
    return probe.ready
        ? { status: 200, ready: true }
        : { status: 503, ready: false };
}

export async function enter(req, res) {
    /**
     * @register_router enter
     * @method GET
     * @requireCredential
     *
     * Compatibilidade para links antigos. Entrar não cria nem acorda tenant:
     * a escolha de destino pertence ao Redirect e às regras de cargo.
     */
    const db = getProxy('auth');
    const user = db.user[req.user.id];
    if (!user) return res.redirect(SIGN_IN_VIEW);
    if (isRetiredLocalAccount(user)) return res.status(410).send('Este tipo de conta foi descontinuado.');

    return res.redirect(AUTHENTICATED_HOME);
}

export async function enterDistributedApp(req, res) {
    /**
     * @register_router apps/:app/enter
     * @method GET
     * @requireCredential
     *
     * Aquisição pública e entrada canônica do app. A mesma URL funciona antes
     * e depois de existir Tenant, portanto links distribuídos nunca precisam
     * conhecer a topologia da conta.
     */
    const app = getDistributedApp(req.params?.app);
    if (!app) return { status: 404, message: 'Aplicativo não distribuível.' };

    const db = getProxy('auth');
    const user = db.user[req.user.id];
    if (!user) return res.redirect(SIGN_IN_VIEW);
    await ensureEntitlement(db, user.id, app.slug);

    if (user.tenantStatus === 'ready' && user.tenantDomain && user.tenantId) {
        await dispatchEvent('thinkiac:tenant:wake', {
            tenantId: user.tenantId,
            domain: user.tenantDomain,
        }).catch(() => {});
        const installed = await ensureTenantPackages(user.tenantId, app.tenantPackages);
        if (!installed.success) return { status: 502, message: installed.message };
        return res.redirect(ssoUrlFor(user.tenantDomain, user.username, app.tenantView));
    }

    return res.redirect(app.sharedView);
}

export async function retryProvisioning(req, res) {
    /**
     * @register_router retry-provisioning
     * @method POST
     * @requireCredential
     */
    const db = getProxy('auth');
    const me = db.user[req.user.id];
    if (!me) return { status: 404, message: 'Usuário não encontrado.' };

    // Admin pode reprovisionar a instância de qualquer usuário (painel de
    // gerenciamento); usuário comum só a própria.
    const targetUserId = (me.role === 'admin' && req.body?.userId) ? req.body.userId : me.id;
    const user = db.user[targetUserId];
    if (!user) return { status: 404, message: 'Usuário não encontrado.' };

    return {
        status: 410,
        message: 'Tenant provisioning is no longer started from authentication.',
    };
}

export async function createInvite(req, res) {
    /**
     * @register_router invite
     * @method POST
     * @requireCredential
     */
    const db = getProxy('auth');
    const user = db.user[req.user?.id];
    if (!canManageAuth(db, user, 'auth.settings.write')) {
        return { status: 403, message: 'Apenas administradores podem gerar convites.' };
    }

    const settings = db.authsettings?.findOne?.({ id: 'default' });
    if (settings && (!settings.registrationEnabled || !settings.invitationsEnabled)) {
        return { status: 403, message: 'Invitations are currently disabled.' };
    }

    // Quem tem a permissão de configurações controla a admissão. O saldo
    // legado nunca foi um limite útil para esse fluxo administrativo.
    const code = generateInviteCode();
    await db.invite.push({ code, userId: user.id, consumed: false });

    return { status: 200, code };
}

export async function listUsers(req, res) {
    /**
     * @register_router users
     * @method GET
     * @requireCredential
     */
    const db = getProxy('auth');
    const me = db.user[req.user?.id];
    if (!canManageAuth(db, me, 'auth.users.read')) {
        return { status: 403, message: 'Apenas administradores podem ver esta página.' };
    }

    const users = (db.user.all ? db.user.all() : []) || [];
    const invites = db.invite.query({ userId: me.id });
    const settings = db.authsettings?.findOne?.({ id: 'default' });

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
        invites: invites.map((i) => ({
            code: i.code,
            consumed: !!i.consumed,
            consumedByUserId: i.consumedByUserId || null,
            expiresAt: i.expiresAt || null,
            revoked: !!i.revoked,
            revokedAt: i.revokedAt || null,
        })),
        settings: {
            registrationEnabled: settings?.registrationEnabled !== false,
            invitationsEnabled: settings?.invitationsEnabled !== false,
            defaultRolePackage: settings?.defaultRolePackage || null,
            defaultRoleGroup: settings?.defaultRoleGroup || null,
            defaultRoleGroupId: settings?.defaultRoleGroupId || null,
            defaultRoleSelection: settings?.defaultRoleGroupId ? `group:${settings.defaultRoleGroupId}` : '',
        },
        // Registration defaults intentionally exclude administrative roles.
        // User management, however, must list every declared role an admin
        // can assign, including package-specific operator roles.
        availableRoles: permissionCatalog.list().filter(canBeDefaultRegistrationRole),
        assignableRoles: permissionCatalog.list(),
    };
}

export async function updateSettings(req) {
    /**
     * @register_router settings
     * @method POST
     * @requireCredential
     */
    const db = getProxy('auth');
    const me = db.user[req.user?.id];
    if (!canManageAuth(db, me, 'auth.settings.write')) {
        return { status: 403, message: 'Only administrators can change settings.' };
    }

    const registrationEnabled = req.body?.registrationEnabled !== false;
    // Convites só existem como um modo de cadastro. Fechar o cadastro também
    // os desliga, evitando um estado sem controle correspondente na interface.
    const invitationsEnabled = registrationEnabled && req.body?.invitationsEnabled === true;
    const defaultRoleSelection = String(req.body?.defaultRoleSelection || '').trim();
    const resolvedDefaultRole = await resolveRoleSelection(db, defaultRoleSelection);
    if (defaultRoleSelection && (!resolvedDefaultRole.group || !canBeDefaultRoleGroup(db, resolvedDefaultRole.group))) {
        return { status: 400, message: 'The selected default role is unavailable or administrative.' };
    }
    if (resolvedDefaultRole.error) return { status: 400, message: resolvedDefaultRole.error };
    const current = db.authsettings?.findOne?.({ id: 'default' });
    if (current) {
        current.registrationEnabled = registrationEnabled;
        current.invitationsEnabled = invitationsEnabled;
        current.defaultRoleGroupId = resolvedDefaultRole.group?.id || null;
        current.defaultRolePackage = null;
        current.defaultRoleGroup = null;
    } else {
        await db.authsettings.push({
            id: 'default', registrationEnabled, invitationsEnabled,
            defaultRoleGroupId: resolvedDefaultRole.group?.id || null,
            defaultRolePackage: null, defaultRoleGroup: null,
        });
    }
    return { status: 200, settings: {
        registrationEnabled, invitationsEnabled,
        defaultRoleSelection: resolvedDefaultRole.group ? `group:${resolvedDefaultRole.group.id}` : '',
        defaultRoleGroupId: resolvedDefaultRole.group?.id || null,
    } };
}

export async function updateUser(req, res) {
    /**
     * @register_router update-user
     * @method POST
     * @requireCredential
     */
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

export async function revokeInvite(req, res) {
    /**
     * @register_router revoke-invite
     * @method POST
     * @auth
     */
    const db = getProxy('auth');
    const me = db.user[req.user?.id];
    if (!canManageAuth(db, me, 'auth.settings.write')) {
        return { status: 403, message: 'Apenas administradores podem gerenciar convites.' };
    }

    const { code } = req.body || {};
    const invite = code ? db.invite.findOne({ code }) : null;
    if (!invite) return { status: 404, message: 'Convite não encontrado.' };
    if (invite.consumed) {
        return { status: 400, message: 'Convite já utilizado — não é possível revogar.' };
    }

    invite.revoked = true;
    invite.revokedAt = new Date().toISOString();

    return { status: 200, success: true };
}

export async function tenantDiagnostics(req, res) {
    /**
     * @register_router tenant-diagnostics
     * @method GET
     * @auth
     */
    const db = getProxy('auth');
    const me = db.user[req.user.id];
    if (!me || me.role !== 'admin') {
        return { status: 403, message: 'Apenas administradores podem ver diagnósticos.' };
    }

    const { userId } = req.query || {};
    const target = userId ? db.user[userId] : null;
    if (!target) return { status: 404, message: 'Usuário não encontrado.' };

    return {
        status: 200,
        diagnostics: {
            userId: target.id,
            username: target.username,
            tenantStatus: target.tenantStatus,
            tenantDomain: target.tenantDomain,
            tenantId: target.tenantId,
            failureReason: target.failureReason,
        },
    };
}

export async function tenantResources(req, res) {
    /**
     * @register_router tenant-resources
     * @method GET
     * @auth
     */
    const db = getProxy('auth');
    const me = db.user[req.user.id];
    if (!me || me.role !== 'admin') {
        return { status: 403, message: 'Apenas administradores podem ver recursos.' };
    }

    const { userId } = req.query || {};
    const target = userId ? db.user[userId] : null;
    if (!target) return { status: 404, message: 'Usuário não encontrado.' };
    if (!target.tenantId) return { status: 200, registered: false, plan: null, live: null };

    const billingUrl = process.env.CLOUD_ENV_BILLING_URL;
    let plan = null;
    if (billingUrl) {
        try {
            const r = await fetch(`${billingUrl}/admin/customers/${encodeURIComponent(target.tenantId)}`, {
                headers: { [BILLING_ADMIN_HEADER]: process.env.BILLING_ADMIN_TOKEN || '' },
            });
            if (r.ok) plan = await r.json();
        } catch {
            // serviço de billing fora do ar — degrada mostrando só o uso ao vivo
        }
    }

    let live = null;
    try {
        const { default: Docker } = await import('dockerode');
        const docker = new Docker({ socketPath: '/var/run/docker.sock' });
        const stats = await docker.getContainer(`app_${target.tenantId}`).stats({ stream: false });
        const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
        const sysDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
        const onlineCpus = stats.cpu_stats.online_cpus || (stats.cpu_stats.cpu_usage.percpu_usage || []).length || 1;
        live = {
            cpuPercent: sysDelta > 0 ? Math.round((cpuDelta / sysDelta) * onlineCpus * 10000) / 100 : 0,
            memoryUsageMb: Math.round((stats.memory_stats.usage - (stats.memory_stats.stats?.cache || 0)) / 1024 / 1024),
            memoryLimitMb: Math.round(stats.memory_stats.limit / 1024 / 1024),
            pids: stats.pids_stats?.current ?? null,
        };
    } catch {
        live = { error: 'Não foi possível ler métricas do container (offline ou nunca provisionado).' };
    }

    return { status: 200, registered: !!plan, plan, live };
}

// Grava o plano/add-ons de um tenant no billing (adminSetPlan) e força a
// reconciliação do container. Compartilhado entre a rota update-tenant-resources
// (admin ajustando à mão) e provisionTenant (upgrade automático na criação de
// uma conta já num tier pago). Marca status=active no billing, então o tier
// pago realmente vale — sem isso targetResources cai de volta pro 'free'.
async function applyTenantPlan(target, plan, addons) {
    if (!target || !target.tenantId) return { status: 404, message: 'Tenant não encontrado.' };
    if (!plan) return { status: 400, message: 'Plano é obrigatório.' };

    const billingUrl = process.env.CLOUD_ENV_BILLING_URL;
    if (!billingUrl) return { status: 500, message: 'Serviço de billing não configurado.' };

    try {
        const r = await fetch(`${billingUrl}/admin/customers/${encodeURIComponent(target.tenantId)}/plan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', [BILLING_ADMIN_HEADER]: process.env.BILLING_ADMIN_TOKEN || '' },
            body: JSON.stringify({
                plan,
                addons,
                image: process.env.CLOUD_ENV_TENANT_IMAGE,
                expose: { domain: target.tenantDomain, ssl: true },
            }),
        });
        const data = await r.json().catch(() => null);
        if (!r.ok) return { status: r.status, message: data?.error || 'Falha ao atualizar plano.' };

        // O billing sempre devolve 200 ao gravar o plano no banco, mas isso NÃO
        // garante que o container foi reconciliado. Sem inspecionar o resultado
        // do reconcile a tela mostrava "aplicado" mesmo quando nada mudou
        // (dry-run sem Portainer, ou falha no resize) — o falso positivo.
        const rec = data?.reconcile;
        if (rec?.error) {
            return { status: 502, message: `Plano gravado, mas a reconciliação do container falhou: ${rec.error}`, reconcile: rec };
        }
        if (rec?.dryRun) {
            return { status: 503, message: 'Billing em dry-run (sem credenciais Portainer) — o plano NÃO foi aplicado no container.', reconcile: rec };
        }
        return { status: 200, customer: data.customer, reconcile: rec };
    } catch (e) {
        return { status: 502, message: `Falha ao contatar o serviço de billing: ${e.message}` };
    }
}

export async function updateTenantResources(req, res) {
    /**
     * @register_router update-tenant-resources
     * @method POST
     * @auth
     */
    const db = getProxy('auth');
    const me = db.user[req.user.id];
    if (!me || me.role !== 'admin') {
        return { status: 403, message: 'Apenas administradores podem alterar recursos.' };
    }

    const { userId, plan, addons } = req.body || {};
    const target = userId ? db.user[userId] : null;
    return applyTenantPlan(target, plan, addons);
}

export async function tenantCredits(req, res) {
    /**
     * @register_router tenant-credits
     * @method GET
     * @auth
     */
    const db = getProxy('auth');
    const me = db.user[req.user.id];
    if (!me || me.role !== 'admin') {
        return { status: 403, message: 'Apenas administradores podem ver créditos.' };
    }

    const { userId } = req.query || {};
    const target = userId ? db.user[userId] : null;
    if (!target) return { status: 404, message: 'Usuário não encontrado.' };

    const billingDb = getProxy('billing');
    const wallet = billingDb.wallet.findOne({ userId: target.id });
    const usage = billingDb.usageLog.query({ userId: target.id }) || [];

    return {
        status: 200,
        balanceMicros: wallet?.balanceMicros ?? 0,
        usage: usage
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 50)
            .map((u) => ({
                model: u.model,
                promptTokens: u.promptTokens,
                completionTokens: u.completionTokens,
                costMicros: u.costMicros,
                createdAt: u.createdAt,
            })),
    };
}

const PACKAGE_NAME_RE = /^[a-zA-Z0-9_-]+$/;

function catalogDir() {
    return new URL('../../plugin-catalog/', import.meta.url);
}

function listCatalogPackagesSync() {
    try {
        return fs
            .readdirSync(catalogDir(), { withFileTypes: true })
            .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
            .map((e) => e.name)
            .sort();
    } catch {
        return [];
    }
}

function catalogPackageReleaseSync(name) {
    if (!PACKAGE_NAME_RE.test(name)) return null;
    const root = new URL(`${name}/`, catalogDir());
    if (!fs.existsSync(root)) return null;
    const files = [];
    const walk = (dir, prefix = '') => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (relative.split('/').some((part) => part === 'node_modules' || part.startsWith('.database'))
                || /(^|\/)(test|data|uploads)(\/|$)/.test(relative)
                || /(^|\/)\.env(?:\.|$)/.test(relative)) continue;
            const target = new URL(`${relative}${entry.isDirectory() ? '/' : ''}`, root);
            if (entry.isDirectory()) walk(target, relative);
            else files.push({ relative, content: fs.readFileSync(target) });
        }
    };
    walk(root);
    const hash = crypto.createHash('sha256');
    for (const file of files) hash.update(file.relative).update('\0').update(file.content).update('\0');
    let version = '0.0.0';
    try { version = String(JSON.parse(fs.readFileSync(new URL('package.json', root), 'utf8')).version || version); } catch {}
    return { name, version, hash: hash.digest('hex') };
}

function listCatalogPackageReleasesSync(names = listCatalogPackagesSync()) {
    return names.map(catalogPackageReleaseSync).filter(Boolean);
}

async function billingCustomer(tenantId) {
    const billingUrl = process.env.CLOUD_ENV_BILLING_URL;
    if (!billingUrl) return null;
    const response = await fetch(`${billingUrl}/admin/customers/${encodeURIComponent(tenantId)}`, {
        headers: { [BILLING_ADMIN_HEADER]: process.env.BILLING_ADMIN_TOKEN || '' },
    });
    return response.ok ? response.json() : null;
}

async function reconcileTenantPackages(target, desiredPackages) {
    const billingUrl = process.env.CLOUD_ENV_BILLING_URL;
    if (!billingUrl) return { status: 503, message: 'Serviço de releases não configurado.' };
    try {
        const response = await fetch(`${billingUrl}/admin/customers/${encodeURIComponent(target.tenantId)}/packages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', [BILLING_ADMIN_HEADER]: process.env.BILLING_ADMIN_TOKEN || '' },
            body: JSON.stringify({ packages: listCatalogPackageReleasesSync([...new Set(desiredPackages)].sort()) }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) return { status: response.status, message: data?.error || 'Falha ao salvar estado desejado.' };
        if (data?.reconcile?.error) return { status: 502, message: data.reconcile.error, release: data.customer };
        if (data?.reconcile?.dryRun) return { status: 503, message: 'Release salva, mas o reconciliador está em dry-run.', release: data.customer };
        return { status: 200, success: true, release: data?.customer, reconcile: data?.reconcile };
    } catch (error) {
        return { status: 502, message: `Falha ao reconciliar packages: ${error.message}` };
    }
}

export async function catalogPackages(req, res) {
    /**
     * @register_router catalog-packages
     * @method GET
     * @auth
     */
    const db = getProxy('auth');
    const me = db.user[req.user.id];
    if (!me || me.role !== 'admin') {
        return { status: 403, message: 'Apenas administradores podem ver o catálogo.' };
    }

    let defaults = [];
    try {
        const raw = JSON.parse(fs.readFileSync(new URL('.defaults.json', catalogDir()), 'utf-8'));
        defaults = Array.isArray(raw) ? raw : [];
    } catch {
        // sem .defaults.json ainda — nenhum pacote é padrão
    }

    const catalog = listCatalogPackagesSync();
    return { status: 200, catalog, catalogDetails: listCatalogPackageReleasesSync(catalog), defaults };
}

export async function updateDefaultPackages(req, res) {
    /**
     * @register_router update-default-packages
     * @method POST
     * @auth
     */
    const db = getProxy('auth');
    const me = db.user[req.user.id];
    if (!me || me.role !== 'admin') {
        return { status: 403, message: 'Apenas administradores podem alterar os padrões.' };
    }

    const { packages } = req.body || {};
    if (!Array.isArray(packages)) return { status: 400, message: 'packages deve ser uma lista.' };

    const catalog = new Set(listCatalogPackagesSync());
    const valid = [...new Set(packages.filter((p) => catalog.has(p)))];

    fs.mkdirSync(catalogDir(), { recursive: true });
    fs.writeFileSync(new URL('.defaults.json', catalogDir()), JSON.stringify(valid, null, 2));

    return { status: 200, defaults: valid };
}

/** Executa um comando dentro do container do tenant e devolve stdout (trim). */
async function execInTenantContainer(tenantId, cmd) {
    const { default: Docker } = await import('dockerode');
    const docker = new Docker({ socketPath: '/var/run/docker.sock' });
    const container = docker.getContainer(`app_${tenantId}`);

    const exec = await container.exec({
        Cmd: ['sh', '-c', cmd],
        AttachStdout: true,
        AttachStderr: true,
    });
    const stream = await exec.start({ hijack: true, stdin: false });

    return new Promise((resolve, reject) => {
        const chunks = [];
        docker.modem.demuxStream(
            stream,
            { write: (c) => chunks.push(c) },
            { write: () => {} }
        );
        stream.on('end', async () => {
            try {
                const info = await exec.inspect();
                resolve({ output: Buffer.concat(chunks).toString('utf-8').trim(), exitCode: info.ExitCode });
            } catch (e) {
                reject(e);
            }
        });
        stream.on('error', reject);
    });
}

async function ensureTenantPackages(tenantId, packages = []) {
    const allowed = new Set(tenantPluginsFor(['lectio']));
    const requested = [...new Set(packages)].filter((pkg) => allowed.has(pkg));
    if (!requested.length) return { success: true };

    try {
        const { output } = await execInTenantContainer(tenantId, 'ls -1 packages');
        const installed = new Set(output.split('\n').map((item) => item.trim()).filter(Boolean));
        const missing = requested.filter((pkg) => !installed.has(pkg));
        if (!missing.length) return { success: true };

        const { default: Docker } = await import('dockerode');
        const { default: tarfs } = await import('tar-fs');
        const docker = new Docker({ socketPath: '/var/run/docker.sock' });
        const container = docker.getContainer(`app_${tenantId}`);

        for (const pkg of missing) {
            const source = new URL(`../${pkg}/`, import.meta.url);
            if (!fs.existsSync(source)) return { success: false, message: `Pacote ${pkg} não existe no catálogo local.` };
            const tarStream = tarfs.pack(new URL('../', source).pathname, {
                entries: [pkg],
                ignore: (name) => /(?:^|\/)(?:\.database[^/]*|data|test)(?:\/|$)/.test(String(name).replaceAll('\\', '/')),
            });
            await container.putArchive(tarStream, { path: '/app/packages' });
        }
        return { success: true, installed: missing };
    } catch (error) {
        return { success: false, message: `Falha ao instalar o Lectio no Tenant: ${error.message}` };
    }
}

export async function tenantPackages(req, res) {
    /**
     * @register_router tenant-packages
     * @method GET
     * @auth
     */
    const db = getProxy('auth');
    const me = db.user[req.user.id];
    if (!me || me.role !== 'admin') {
        return { status: 403, message: 'Apenas administradores podem ver pacotes.' };
    }

    const { userId } = req.query || {};
    const target = userId ? db.user[userId] : null;
    if (!target || !target.tenantId) return { status: 404, message: 'Tenant não encontrado.' };

    const catalog = listCatalogPackagesSync();
    const release = await billingCustomer(target.tenantId).catch(() => null);
    const pendingRemovals = (target.pendingPackageRemovals || '').split(',').map((s) => s.trim()).filter(Boolean);
    try {
        const { output, exitCode } = await execInTenantContainer(target.tenantId, 'ls -1 packages');
        if (exitCode !== 0) {
            return { status: 200, installed: [], catalog, pendingRemovals, error: 'Não foi possível listar pacotes (container offline?).' };
        }
        const installed = output.split('\n').map((s) => s.trim()).filter(Boolean);
        return { status: 200, installed, catalog, pendingRemovals, desired: release?.desiredPackages || [], release };
    } catch (e) {
        return { status: 200, installed: [], catalog, pendingRemovals, error: 'Não foi possível conectar ao container do tenant.' };
    }
}

export async function addTenantPackage(req, res) {
    /**
     * @register_router add-tenant-package
     * @method POST
     * @auth
     */
    const db = getProxy('auth');
    const me = db.user[req.user.id];
    if (!me || me.role !== 'admin') {
        return { status: 403, message: 'Apenas administradores podem adicionar pacotes.' };
    }

    const { userId, package: pkg } = req.body || {};
    const target = userId ? db.user[userId] : null;
    if (!target || !target.tenantId) return { status: 404, message: 'Tenant não encontrado.' };
    if (!pkg || !PACKAGE_NAME_RE.test(pkg) || !listCatalogPackagesSync().includes(pkg)) {
        return { status: 400, message: 'Pacote inválido ou fora do catálogo.' };
    }

    const release = await billingCustomer(target.tenantId).catch(() => null);
    const desired = [...(release?.desiredPackages || []), pkg];
    const result = await reconcileTenantPackages(target, desired);
    if (result.status === 200) target.pendingPackageRemovals = '';
    return result;
}

export async function removeTenantPackage(req, res) {
    /**
     * @register_router remove-tenant-package
     * @method POST
     * @auth
     */
    const db = getProxy('auth');
    const me = db.user[req.user.id];
    if (!me || me.role !== 'admin') {
        return { status: 403, message: 'Apenas administradores podem remover pacotes.' };
    }

    const { userId, package: pkg } = req.body || {};
    const target = userId ? db.user[userId] : null;
    if (!target || !target.tenantId) return { status: 404, message: 'Tenant não encontrado.' };
    if (!pkg || !PACKAGE_NAME_RE.test(pkg)) {
        return { status: 400, message: 'Nome de pacote inválido.' };
    }

    const release = await billingCustomer(target.tenantId).catch(() => null);
    const desired = (release?.desiredPackages || []).filter((name) => name !== pkg);
    const result = await reconcileTenantPackages(target, desired);
    target.pendingPackageRemovals = result.status === 200 ? '' : pkg;
    return result;
}

export async function undoTenantPackageRemoval(req, res) {
    /**
     * @register_router undo-tenant-package-removal
     * @method POST
     * @auth
     */
    const db = getProxy('auth');
    const me = db.user[req.user.id];
    if (!me || me.role !== 'admin') {
        return { status: 403, message: 'Apenas administradores podem alterar remoções pendentes.' };
    }

    const { userId, package: pkg } = req.body || {};
    const target = userId ? db.user[userId] : null;
    if (!target) return { status: 404, message: 'Usuário não encontrado.' };

    const release = await billingCustomer(target.tenantId).catch(() => null);
    const result = await reconcileTenantPackages(target, [...(release?.desiredPackages || []), pkg]);
    if (result.status === 200) target.pendingPackageRemovals = '';
    return result;
}

async function packageTargetFromBearer(req, scope = 'delegate:packages') {
    const authHeader = req.headers?.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const resolved = await resolveProxyCredential(token, scope);
    if (!resolved?.userId) return null;
    return getProxy('auth').user[resolved.userId] || null;
}

export async function tenantPackageStateByProxyToken(req, res) {
    /**
     * @register_router tenant-packages/by-proxy-token
     * @method GET
     */
    const target = await packageTargetFromBearer(req);
    if (!target?.tenantId) return { status: 403, error: 'Credencial sem tenant ativo.' };
    const catalog = listCatalogPackagesSync();
    const release = await billingCustomer(target.tenantId).catch(() => null);
    return {
        status: 200,
        tenantId: target.tenantId,
        catalog: listCatalogPackageReleasesSync(catalog),
        desired: release?.packageReleases || [],
        release: release ? {
            releaseVersion: release.releaseVersion,
            appliedFingerprint: release.appliedFingerprint,
            lastReconcileAt: release.lastReconcileAt,
            lastReconcileError: release.lastReconcileError,
        } : null,
    };
}

export async function updateTenantPackagesByProxyToken(req, res) {
    /**
     * @register_router tenant-packages/by-proxy-token
     * @method POST
     */
    const target = await packageTargetFromBearer(req);
    if (!target?.tenantId) return { status: 403, error: 'Credencial sem tenant ativo.' };
    const requested = Array.isArray(req.body?.packages) ? req.body.packages.map(String) : null;
    if (!requested) return { status: 400, error: 'packages deve ser uma lista.' };
    const catalog = new Set(listCatalogPackagesSync());
    if (requested.some((name) => !catalog.has(name))) return { status: 400, error: 'Package inválido ou fora do catálogo.' };
    return reconcileTenantPackages(target, requested);
}

// Derruba o container/proxy host e apaga o registro do usuário por completo.
// Compartilhado entre deleteUser (admin, via rota) e reapIdleDevAccounts
// (automático, via timer) — mesma sequência: tenant primeiro, sessões
// depois, user por último. `force` deixa seguir mesmo com a instância
// travada (container preso, proxy órfão etc.); o reaper nunca usa force —
// prefere tentar de novo no próximo tick a apagar o user com container vivo
// pra trás.
async function destroyTenantAndUser(userId, { force = false } = {}) {
    const db = getProxy('auth');
    const target = db.user[userId];
    if (!target) return { status: 404, message: 'Usuário não encontrado.' };

    if (target.tenantId) {
        const result = await dispatchEvent('thinkiac:tenant:delete', { tenantId: target.tenantId });
        const alreadyGone = result instanceof Error && result.constructor.name === 'TenantNotFoundError';
        if (result instanceof Error && !alreadyGone && !force) {
            return {
                status: 500,
                message: `Falha ao remover a instância: ${result.message || result}`,
                canForce: true,
            };
        }
    }

    const sessions = db.session.query({ userId }) || [];
    for (const s of sessions) {
        await db.session.delete(s.id).catch(() => {});
    }

    await db.user.delete(userId);

    return { status: 200, success: true };
}

export async function deleteUser(req, res) {
    /**
     * @register_router delete-user
     * @method POST
     * @auth
     */
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

// --- CRIAÇÃO DIRETA DE CONTAS (admin, sem convite) ---
// Uma conta pode ser "normal" (permanente) ou "develop" (teste, com ociosidade
// real — some por completo pelo reaper). Nos dois casos o admin define o plano
// do tenant na criação. develop é só um flag em cima do mesmo fluxo.

const DEV_IDLE_DEFAULT_MINUTES = parseInt(process.env.AUTH_ENV_DEV_IDLE_TIMEOUT_MINUTES) || 24 * 60;
const DEV_REAPER_INTERVAL_MS = parseInt(process.env.AUTH_ENV_DEV_REAPER_INTERVAL_MS) || 15 * 60 * 1000;

export async function createAccount(req, res) {
    /**
     * @register_router create-account
     * @method POST
     * @auth
     *
     * Cria uma conta local do Runtime, sem provisionamento de infraestrutura.
     */
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

export async function accountStatus(req, res) {
    /**
     * @register_router account-status
     * @method GET
     * @auth
     *
     * Status de provisionamento de uma conta recém-criada + ssoUrl pra entrar
     * já logado assim que o tenant fica 'ready'. O painel admin faz polling
     * aqui depois de criar a conta e então redireciona o admin direto pro
     * tenant via SSO do gateway — sem passar pela tela de login do tenant, que
     * por design não tem senha pra conta owner (passwordHash nulo, ver
     * tenant-auth/index.js sso()). Auth é 100% via gateway central: nada de
     * senha duplicada no container. Serve contas normais e develop.
     */
    const db = getProxy('auth');
    const me = db.user[req.user.id];
    if (!me || me.role !== 'admin') {
        return { status: 403, message: 'Apenas administradores podem consultar contas.' };
    }

    const { userId } = req.query || {};
    const user = userId ? db.user[userId] : null;
    if (!user) {
        return { status: 404, message: 'Conta não encontrada.' };
    }

    const ready = user.tenantStatus === 'ready';
    return {
        status: 200,
        tenantStatus: user.tenantStatus,
        tenantDomain: user.tenantDomain || null,
        failureReason: user.failureReason || null,
        ssoUrl: ready ? ssoUrlFor(user.tenantDomain, user.username) : null,
    };
}

export async function devAccountStatus(req, res) {
    /**
     * @register_router dev-account-status
     * @method GET
     * @auth
     *
     * Status de provisionamento de uma conta develop + ssoUrl pra entrar já
     * logado assim que o tenant fica 'ready'. O painel admin faz polling aqui
     * depois de criar a conta e então redireciona o admin direto pro tenant
     * via SSO do gateway — sem passar pela tela de login do tenant, que por
     * design não tem senha pra conta owner (passwordHash nulo, ver
     * tenant-auth/index.js sso()). Auth é 100% via gateway central: nada de
     * senha duplicada no container.
     */
    const db = getProxy('auth');
    const me = db.user[req.user.id];
    if (!me || me.role !== 'admin') {
        return { status: 403, message: 'Apenas administradores podem consultar contas develop.' };
    }

    const { userId } = req.query || {};
    const user = userId ? db.user[userId] : null;
    if (!user || user.accountType !== 'develop') {
        return { status: 404, message: 'Conta develop não encontrada.' };
    }

    const ready = user.tenantStatus === 'ready';
    return {
        status: 200,
        tenantStatus: user.tenantStatus,
        tenantDomain: user.tenantDomain || null,
        failureReason: user.failureReason || null,
        ssoUrl: ready ? ssoUrlFor(user.tenantDomain, user.username) : null,
    };
}

async function reapIdleDevAccounts() {
    const db = getProxy('auth');
    const users = (db.user.all ? await db.user.all() : []) || [];
    const now = Date.now();

    for (const user of users) {
        if (user.accountType !== 'develop' || !user.lastActivityAt) continue;

        const timeoutMinutes = user.idleTimeoutMinutes ?? DEV_IDLE_DEFAULT_MINUTES;
        const idleMs = now - new Date(user.lastActivityAt).getTime();
        if (idleMs < timeoutMinutes * 60 * 1000) continue;

        const result = await destroyTenantAndUser(user.id, { force: false });
        if (result.status === 200) {
            console.log(`[auth] conta develop ${user.id} (${user.username}) apagada por ociosidade (${timeoutMinutes}min).`);
        } else {
            // Não força: melhor tentar de novo no próximo tick do que apagar
            // o registro do user com um container/proxy órfão pra trás.
            console.error(`[auth] reaper: falha ao apagar conta develop ${user.id}: ${result.message}`);
        }
    }
}

let devReaperStarted = false;
function startDevAccountReaper() {
    // Boot hooks podem rodar mais de uma vez em cenários de reload — a
    // guarda evita empilhar múltiplos setInterval fazendo a mesma varredura.
    if (devReaperStarted) return;
    devReaperStarted = true;
    setInterval(() => {
        reapIdleDevAccounts().catch((err) => console.error('[auth] reaper de contas develop falhou:', err));
    }, DEV_REAPER_INTERVAL_MS);
}

// Mesmo padrão de resolveUserIdFromBearer() em packages/billing/index.js —
// aqui inline porque a resolução (db.user.findOne por llmProxyToken) já mora
// neste arquivo, sem precisar do dispatchEvent('auth:resolve-proxy-token').
async function resolveUserIdFromBearer(req, scope = null) {
    const authHeader = req.headers?.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return null;

    const resolved = await resolveProxyCredential(token, scope);
    return resolved?.userId || null;
}

const credentialRateWindows = new Map();

function withinCredentialRateLimit(record) {
    const now = Date.now();
    const current = credentialRateWindows.get(record.tokenId);
    const window = !current || now - current.startedAt >= 60_000
        ? { startedAt: now, count: 0 }
        : current;
    window.count += 1;
    credentialRateWindows.set(record.tokenId, window);
    return window.count <= Math.max(1, Number(record.maxRequestsPerMinute) || 60);
}

async function resolveProxyCredential(token, scope = null) {
    const db = getProxy('auth');
    const parsed = parseProxyToken(token);
    if (parsed) {
        const record = db.proxyCredential.findOne({ tokenId: parsed.tokenId });
        // Installation credentials are least-privilege service principals. They
        // intentionally do not create interactive User rows, but still use the
        // same hashed credential, revocation, scope and rate-limit checks.
        const principalExists = Boolean(db.user[record.userId]) || String(record.userId || '').startsWith('installation:');
        if (!verifyProxyToken(token, record) || record.status !== 'active' || !principalExists) return null;
        if (scope && !credentialHasScope(record, scope)) return null;
        if (!withinCredentialRateLimit(record)) return null;
        record.lastUsedAt = new Date();
        return {
            userId: record.userId,
            tenantId: record.tenantId || null,
            credentialId: record.id,
            scopes: JSON.parse(record.scopes || '[]'),
            spendLimitMicros: record.spendLimitMicros ?? null,
            spentMicros: record.spentMicros || 0,
        };
    }

    // Janela de migração explicitamente opt-in. Em produção o default é negar:
    // um token legado em texto não pode recuperar implicitamente todos os
    // escopos de billing e administração.
    if (process.env.AUTH_ENV_ALLOW_LEGACY_PROXY_TOKEN !== '1') return null;
    const legacyUser = db.user.findOne({ llmProxyToken: token });
    if (!legacyUser || (scope && scope !== 'llm:invoke')) return null;
    return { userId: legacyUser.id, legacy: true, scopes: ['llm:invoke'] };
}

export async function onResolveProxyToken(payload) {
    /**
     * @register_hook auth:resolve-proxy-token
     */
    const { token, scope = null } = payload || {};
    if (!token) return null;
    return resolveProxyCredential(token, scope);
}

export async function onRecordProxySpend(payload) {
    /**
     * @register_hook auth:record-proxy-spend
     */
    const credentialId = String(payload?.credentialId || '');
    const amountMicros = Math.max(0, Math.trunc(Number(payload?.amountMicros) || 0));
    if (!credentialId || !amountMicros) return null;
    const db = getProxy('auth');
    const credential = db.proxyCredential[credentialId];
    if (!credential || credential.revokedAt) return null;
    credential.spentMicros = (credential.spentMicros || 0) + amountMicros;
    return { credentialId, spentMicros: credential.spentMicros };
}

async function npmSessionUser(req) {
    const resolved = await identityProvider.resolve(req);
    return resolved?.user || null;
}

export async function routerNpmWorkspace(req) {
    /**
     * @register_router npm/workspace
     * @method GET
     */
    const user = await npmSessionUser(req);
    if (!user?.username) return { authenticated: false, workspace: null, packages: [] };
    const records = getProxy('auth').npmPackage.query({ owner: String(user.username).toLowerCase() }) || [];
    return npmWorkspaceSummary(user, records);
}

export async function routerNpmCatalog(req) {
    /**
     * @register_router npm/catalog
     * @method GET
     * @public true
     */
    const identity = await npmUserForBearer(req);
    const records = getProxy('auth').npmPackage.query() || [];
    return {
        packages: identity
            ? npmReadableCatalog(records, identity.user.username)
            : npmPublicCatalog(records),
    };
}

export async function routerNpmCreateToken(req, res) {
    /**
     * @register_router npm/tokens
     * @method POST
     */
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
    /**
     * @register_router npm/tokens
     * @method GET
     */
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
    /**
     * @register_router npm/tokens/:id/revoke
     * @method POST
     */
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
    /**
     * @register_router npm/authenticate
     * @method POST
     */
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

export async function routerNpmRegisterPackage(req) {
    /**
     * @register_router npm/packages
     * @method POST
     * @public true
     */
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
    /**
     * @register_router npm/packages/:name
     * @method DELETE
     * @public true
     */
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
    /**
     * @register_router npm/access
     * @method POST
     * @public true
     */
    const serviceToken = npmBearer(req);
    if (!sameSecret(serviceToken, process.env.AUTH_ENV_VERDACCIO_SERVICE_TOKEN)) return { status: 401, allowed: false };
    const packageName = String(req.body?.packageName || '').toLowerCase();
    const record = getProxy('auth').npmPackage.findOne({ name: packageName });
    // Pacotes não gerenciados continuam disponíveis para o proxy npmjs. Todo
    // pacote publicado pelo fluxo ThinkIac é registrado antes do upload.
    return { allowed: !record || canReadNpmPackage(record, req.body?.username) };
}

export async function routerNpmDeviceStart(req) {
    /**
     * @register_router npm/device
     * @method POST
     * @public true
     */
    const code = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    await getProxy('auth').npmDeviceAuthorization.push({ codeHash: deviceCodeHash(code), expiresAt });
    return { deviceCode: code, verificationUri: `${gatewayBaseUrl()}/auth/npm/device/approve?code=${encodeURIComponent(code)}`, expiresIn: 300, interval: 2 };
}

export async function routerNpmDeviceApprove(req) {
    /**
     * @register_router npm/device/approve
     * @method GET
     */
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
    /**
     * @register_router npm/device/poll
     * @method POST
     * @public true
     */
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

/** Emite uma credencial de leitura estritamente vinculada a uma instalação. */
export async function routerNotifyPairDevice(req, res) {
    /**
     * @register_router notify/devices
     * @method POST
     */
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

/** Endpoint servidor-servidor usado pelo gateway. Nunca recebe sessão web. */
export async function routerNotifyAuthorize(req, res) {
    /**
     * @register_router notify/authorize
     * @method POST
     */
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

export async function onGetAdminUser() {
    /**
     * @register_hook auth:get-admin-user
     *
     * Usado por billing (onAgentTokenUsage) pra atribuir uso de LLM sem
     * Tenant/token resolvido (ex.: esta própria instância, que usa chaves/CLI
     * pessoais do operador) a um usuário real com role "admin" — em vez de um
     * bucket sintético sem carteira/identidade, permitindo que o admin veja
     * esse consumo na própria tela de billing.
     */
    const db = getProxy('auth');
    const admin = db.user.findOne({ role: 'admin' });
    return admin ? { userId: admin.id } : null;
}

// Campos aceitos na Parte 1 do onboarding (preenchida na tela de espera do
// provisionamento — ver Login.svelte). Allowlist explícita: o body vem direto
// do cliente, sem passar por schema de validação em outro lugar.
const ONBOARDING_FIELDS = ['assistantName', 'context', 'role', 'purpose', 'briefContext', 'audience'];

export async function saveOnboarding(req, res) {
    /**
     * @register_router onboarding
     * @method POST
     * @auth
     *
     * Salva (merge, não substitui) as respostas da Parte 1. Chamado
     * incrementalmente conforme o usuário avança os passos na tela de espera
     * — pode ficar incompleto se ele fechar a aba antes de terminar; a Parte 2
     * (dentro do tenant) não depende de nenhum campo específico estar presente.
     */
    const db = getProxy('auth');
    const user = db.user[req.user.id];
    if (!user) return { status: 404, error: 'Usuário não encontrado.' };

    const patch = {};
    for (const field of ONBOARDING_FIELDS) {
        const value = req.body?.[field];
        if (typeof value === 'string' && value.trim()) patch[field] = value.trim().slice(0, 500);
    }

    user.onboarding = { ...(user.onboarding || {}), ...patch, part1UpdatedAt: new Date().toISOString() };

    return { status: 200, onboarding: user.onboarding };
}

export async function getOnboardingByProxyToken(req, res) {
    /**
     * @register_router onboarding/by-proxy-token
     * @method GET
     *
     * Mesmo padrão de wallet/by-proxy-token (packages/billing): autenticado
     * pelo LLM_PROXY_TOKEN do tenant (Bearer) em vez de sessão de cookie — é
     * o que tenant-auth usa, de dentro do container, no primeiro SSO, pra
     * puxar as respostas da Parte 1 e semear o AGENT.md/mensagem de boas-vindas
     * do Agent (ver hooks/onboarding.js no pacote agent).
     */
    const userId = await resolveUserIdFromBearer(req);
    if (!userId) return { status: 401, error: 'Token inválido.' };

    const db = getProxy('auth');
    const user = db.user[userId];
    if (!user) return { status: 404, error: 'Usuário não encontrado.' };

    return { status: 200, onboarding: user.onboarding || null };

    return { userId: user.id };
}

// --- AUTORIZAÇÃO GLOBAL -------------------------------------------------------
// Estas rotas não conhecem pacotes consumidores: administram sujeitos,
// permissões e escopos de forma genérica para todo o ThinkIac.

function canManageAuth(db, user, permission) {
    return !!user && authorize({
        userId: user.id,
        permission,
        database: db,
        catalog: permissionCatalog,
    }).allowed;
}

function requireGlobalPermissionAdmin(req, permission) {
    const db = getProxy('auth');
    const actor = db.user[req.user?.id];
    if (!canManageAuth(db, actor, permission)) {
        const error = new Error('Only system administrators can manage global permissions.');
        error.status = 403;
        throw error;
    }
    return { db, actor };
}

function canBeDefaultRoleGroup(db, group) {
    if (!group) return false;
    if (group.declaredPackage) return canBeDefaultRegistrationRole(permissionCatalog.get(group.declaredPackage, group.declaredGroup));
    return !(db.permissionGrant.query({ subjectType: 'group', subjectId: group.id }) || [])
        .some((grant) => /^auth\.(?:users|access|settings)\.(?:read|write)$/.test(grant.permission));
}

async function resolveRoleSelection(db, value) {
    const selection = String(value || '').trim();
    if (!selection) return { group: null };
    let group = null;
    if (selection.startsWith('group:')) {
        group = db.permissionGroup[selection.slice('group:'.length)];
    } else if (selection.startsWith('declared:')) {
        const [, packageName, declaredGroup] = selection.split(':');
        const definition = permissionCatalog.get(packageName, declaredGroup);
        if (!definition) return { error: 'The selected role is unavailable.' };
        group = (db.permissionGroup.query({ declaredPackage: packageName, declaredGroup }) || [])[0];
        if (!group) group = await db.permissionGroup.push({ name: definition.label, declaredPackage: packageName, declaredGroup });
    } else {
        return { error: 'The selected role is invalid.' };
    }
    return group ? { group } : { error: 'The selected role is unavailable.' };
}

// A user can belong to any number of roles. Direct grants are intentionally
// untouched, so a role change never removes a user-specific exception.
async function assignRoleSelections(db, userId, values) {
    const selections = [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean))];
    const groups = [];
    for (const selection of selections) {
        const resolved = await resolveRoleSelection(db, selection);
        if (resolved.error) return resolved;
        if (resolved.group) groups.push(resolved.group);
    }
    for (const membership of db.permissionMembership.query({ userId }) || []) await db.permissionMembership.delete(membership.id);
    for (const group of groups) await db.permissionMembership.push({ userId, groupId: group.id });
    return { groups };
}

async function auditPermissionChange(db, actorId, action, details = {}) {
    return db.permissionAudit.push({ actorId, action, ...details });
}

// Protocolo mínimo para contribuições da tela System. Um pacote instalado pode
// declarar `manifest.systemTab` (ou uma lista): { id, label, view, order }.
// `renderer: "schema"` troca o iframe por uma surface declarativa nativa.
// O manifesto é a fonte de verdade, como já ocorre com `manifest.menu` no
// Shell; não há um registry em memória que se perca em reload.
function registeredSystemTabs() {
    return listLegacySystemTabs();
}

const AUTH_TABS = new Set(['auth-users', 'auth-roles', 'auth-registration', 'auth-invitations']);
const AUTH_SURFACE = Object.freeze({
    version: 1,
    kind: 'auth-administration',
    actions: {
        'auth.create-user': { intent: 'write' }, 'auth.update-user': { intent: 'write' }, 'auth.delete-user': { intent: 'destructive' },
        'auth.save-registration': { intent: 'write' }, 'auth.create-invite': { intent: 'write' }, 'auth.revoke-invite': { intent: 'destructive' },
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

function authActionResult(result, req, tab, notice) {
    if (result?.status >= 400) return { status: result.status, error: result.error || result.message || 'Ação não concluída.' };
    return Promise.resolve(authSystemState(req, tab)).then((state) => ({ status: state.status >= 400 ? state.status : 200, state, notice }));
}

export async function systemView(req) {
    /** @register_router system/view
     * @method GET */
    const tab = authTab(req);
    const state = await authSystemState(req, tab);
    if (state.status >= 400) return state;
    return { status: 200, surface: assertSurface({ ...AUTH_SURFACE, tab }), state };
}

export async function systemAction(req) {
    /** @register_router system/action
     * @method POST */
    const action = String(req.body?.action || '');
    const values = req.body?.values && typeof req.body.values === 'object' ? req.body.values : {};
    const tab = authTab({ ...req, body: { ...req.body, values } });
    const routed = (handler, body, notice) => authActionResult(handler({ ...req, body }), req, tab, notice);
    if (action === 'auth.create-user') return routed(createAccount, values, 'Usuário criado.');
    if (action === 'auth.update-user') return routed(updateUser, values, 'Usuário atualizado.');
    if (action === 'auth.delete-user') return routed(deleteUser, values, 'Usuário removido.');
    if (action === 'auth.save-registration') return routed(updateSettings, values, 'Configurações atualizadas.');
    if (action === 'auth.create-invite') return routed(createInvite, values, 'Convite criado.');
    if (action === 'auth.revoke-invite') return routed(revokeInvite, values, 'Convite revogado.');
    if (action === 'auth.create-role') return routed(routerPermissionsCreateGroup, values, 'Papel criado.');
    if (action === 'auth.update-role') return routed(routerPermissionsUpdateGroup, values, 'Papel atualizado.');
    if (action === 'auth.delete-role') return routed(routerPermissionsDeleteGroup, values, 'Papel removido.');
    if (action === 'auth.add-member') return routed(routerPermissionsAddMember, values, 'Membro incluído.');
    if (action === 'auth.remove-member') return routed(routerPermissionsDeleteMember, values, 'Membro removido.');
    if (action === 'auth.add-grant') return routed(routerPermissionsCreateGrant, values, 'Permissão incluída.');
    if (action === 'auth.remove-grant') return routed(routerPermissionsDeleteGrant, values, 'Permissão removida.');
    return { status: 404, error: 'Ação de Access não permitida.' };
}

export async function routerPermissionsOverview(req, res) {
    /**
     * @register_router permissions
     * @method GET
     */
    const { db } = requireGlobalPermissionAdmin(req, 'auth.access.read');
    const grants = db.permissionGrant.query({}) || [];
    return {
        groups: db.permissionGroup.query({}) || [],
        memberships: db.permissionMembership.query({}) || [],
        grants,
        declaredGroups: permissionCatalog.list(),
        selectablePermissions: listSelectablePermissions({ catalog: permissionCatalog, grants }),
    };
}

export async function routerPermissionsCatalog(req, res) {
    /**
     * @register_router permissions/catalog
     * @method GET
     */
    requireGlobalPermissionAdmin(req, 'auth.access.read');
    return { groups: permissionCatalog.list() };
}

export async function routerPermissionsCreateGroup(req, res) {
    /**
     * @register_router permissions/groups
     * @method POST
     */
    const { db, actor } = requireGlobalPermissionAdmin(req, 'auth.access.write');
    const declared = validateDeclaredGroupInput(req.body, permissionCatalog);
    const definition = declared.declaredPackage ? permissionCatalog.get(declared.declaredPackage, declared.declaredGroup) : null;
    const name = String(req.body?.name || definition?.label || '').trim();
    if (!name) return { status: 400, error: 'Group name is required.' };
    const group = await db.permissionGroup.push({ name, ...declared });
    await auditPermissionChange(db, actor.id, 'group.create', { subjectType: 'group', subjectId: group.id });
    return group;
}

export async function routerPermissionsUpdateGroup(req, res) {
    /**
     * @register_router permissions/groups/update
     * @method POST
     */
    const { db, actor } = requireGlobalPermissionAdmin(req, 'auth.access.write');
    const group = db.permissionGroup[String(req.body?.id || '')];
    if (!group) return { status: 404, error: 'Group not found.' };
    if (group.declaredPackage) return { status: 400, error: 'Declared roles cannot be renamed.' };
    const name = String(req.body?.name || '').trim();
    if (!name) return { status: 400, error: 'Group name is required.' };
    group.name = name;
    await auditPermissionChange(db, actor.id, 'group.update', { subjectType: 'group', subjectId: group.id });
    return group;
}

export async function routerPermissionsDeleteGroup(req, res) {
    /**
     * @register_router permissions/groups/delete
     * @method POST
     */
    const { db, actor } = requireGlobalPermissionAdmin(req, 'auth.access.write');
    const group = db.permissionGroup[String(req.body?.id || '')];
    if (!group) return { status: 404, error: 'Group not found.' };
    if (group.declaredPackage) return { status: 400, error: 'Declared roles cannot be deleted.' };
    for (const membership of db.permissionMembership.query({ groupId: group.id }) || []) await db.permissionMembership.delete(membership.id);
    for (const grant of db.permissionGrant.query({ subjectType: 'group', subjectId: group.id }) || []) await db.permissionGrant.delete(grant.id);
    await db.permissionGroup.delete(group.id);
    await auditPermissionChange(db, actor.id, 'group.delete', { subjectType: 'group', subjectId: group.id });
    return { success: true };
}

export async function routerSystemTabs(req, res) {
    /**
     * @register_router system/tabs
     * @method GET
     */
    requireGlobalPermissionAdmin(req, 'auth.users.read');
    return { tabs: registeredSystemTabs() };
}

export async function routerPermissionsAddMember(req, res) {
    /**
     * @register_router permissions/memberships
     * @method POST
     */
    const { db, actor } = requireGlobalPermissionAdmin(req, 'auth.access.write');
    const userId = String(req.body?.userId || '');
    const groupId = String(req.body?.groupId || '');
    if (!db.user[userId] || !db.permissionGroup[groupId]) return { status: 404, error: 'User or group not found.' };
    const existing = (db.permissionMembership.query({ userId, groupId }) || [])[0];
    if (existing) return existing;
    const membership = await db.permissionMembership.push({ userId, groupId });
    await auditPermissionChange(db, actor.id, 'membership.create', { subjectType: 'user', subjectId: userId, resourceId: groupId });
    return membership;
}

export async function routerPermissionsDeleteMember(req, res) {
    /**
     * @register_router permissions/memberships/delete
     * @method POST
     */
    const { db, actor } = requireGlobalPermissionAdmin(req, 'auth.access.write');
    const id = String(req.body?.id || '');
    const membership = db.permissionMembership[id];
    if (!membership) return { status: 404, error: 'Group membership not found.' };
    await db.permissionMembership.delete(membership.id);
    await auditPermissionChange(db, actor.id, 'membership.delete', {
        subjectType: 'user', subjectId: membership.userId, resourceId: membership.groupId,
    });
    return { success: true };
}

export async function routerPermissionsCreateGrant(req, res) {
    /**
     * @register_router permissions/grants
     * @method POST
     */
    const { db, actor } = requireGlobalPermissionAdmin(req, 'auth.access.write');
    const grantInput = validateGrantInput(req.body);
    const subjectExists = grantInput.subjectType === 'user'
        ? db.user[grantInput.subjectId]
        : db.permissionGroup[grantInput.subjectId];
    if (!subjectExists) return { status: 404, error: 'Permission subject not found.' };
    const grant = await db.permissionGrant.push({ ...grantInput, createdById: actor.id });
    await auditPermissionChange(db, actor.id, 'grant.create', grantInput);
    return grant;
}

export async function routerPermissionsCreateFullPackageGrant(req, res) {
    /**
     * @register_router permissions/grants/full-package
     * @method POST
     */
    const { db, actor } = requireGlobalPermissionAdmin(req, 'auth.access.write');
    const subjectType = String(req.body?.subjectType || '');
    const subjectId = String(req.body?.subjectId || '').trim();
    const packageName = String(req.body?.packageName || '').trim();
    const effect = String(req.body?.effect || 'allow');
    if (!['user', 'group'].includes(subjectType) || !subjectId || !['allow', 'deny'].includes(effect)) {
        return { status: 400, error: 'Invalid full package access request.' };
    }
    const subjectExists = subjectType === 'user' ? db.user[subjectId] : db.permissionGroup[subjectId];
    if (!subjectExists) return { status: 404, error: 'Permission subject not found.' };
    const permissions = [...new Set(permissionCatalog.list()
        .filter((definition) => definition.packageName === packageName)
        .flatMap((definition) => definition.permissions || []))];
    if (!permissions.length) return { status: 400, error: 'This package has no declared permissions.' };
    const existing = db.permissionGrant.query({ subjectType, subjectId }) || [];
    const existingKeys = new Set(existing.map((grant) => `${grant.permission}:${grant.resourceId || ''}:${grant.effect}`));
    const created = [];
    for (const permission of permissions) {
        if (existingKeys.has(`${permission}::${effect}`)) continue;
        created.push(await db.permissionGrant.push({ subjectType, subjectId, permission, resourceId: null, effect, createdById: actor.id }));
    }
    await auditPermissionChange(db, actor.id, 'grant.full-package', { subjectType, subjectId, packageName, effect });
    return { created: created.length, permissions };
}

export async function routerPermissionsDeleteGrant(req, res) {
    /**
     * @register_router permissions/grants/delete
     * @method POST
     */
    const { db, actor } = requireGlobalPermissionAdmin(req, 'auth.access.write');
    const id = String(req.body?.id || '');
    const grant = db.permissionGrant[id];
    if (!grant) return { status: 404, error: 'Permission not found.' };
    await db.permissionGrant.delete(id);
    await auditPermissionChange(db, actor.id, 'grant.delete', {
        subjectType: grant.subjectType, subjectId: grant.subjectId, permission: grant.permission, resourceId: grant.resourceId,
    });
    return { success: true };
}

export async function routerPermissionsForUser(req, res) {
    /**
     * @register_router permissions/user
     * @method GET
     */
    const { db } = requireGlobalPermissionAdmin(req, 'auth.access.read');
    const userId = String(req.query?.userId || '');
    if (!db.user[userId]) return { status: 404, error: 'User not found.' };
    return permissionsForUser({ userId, database: db, catalog: permissionCatalog });
}

export async function routerPermissionsAudit(req, res) {
    /**
     * @register_router permissions/audit
     * @method GET
     */
    const { db } = requireGlobalPermissionAdmin(req, 'auth.access.read');
    const limit = Math.min(Math.max(Number(req.query?.limit) || 30, 1), 100);
    return { entries: db.permissionAudit.query({}, { sort: 'createdAt DESC', limit }) || [] };
}

// MCP uses the same canonical users, verification and entitlement decisions as
// accessGate, with a dedicated credential instead of a browser cookie.
export const mcpAuth = createMcpAuth({
    directory: fileURLToPath(new URL('../../.private/auth-mcp/', import.meta.url)),
    resolveUser: async (id) => normalizeUser(getProxy('auth').user[id]),
    canAccess: async (user, pkg) => !user.disabled && (user.role === 'admin' || activeEntitlements(getProxy('auth'), user.id)
        .some((slug) => pathBelongsToApp(`/${pkg}/`, slug))),
});

async function mcpAdministrator(req, res) {
    const resolved = await identityProvider.resolve(req);
    if (!resolved) { res.status(401).json({ error: 'Login necessário.' }); return null; }
    if (resolved.user.role !== 'admin' || resolved.session.delegatedSubject) {
        res.status(403).json({ error: 'Administração MCP exige administrador sem delegação.' }); return null;
    }
    return resolved.user;
}

export async function routerMcpIssue(req, res) {
    /**
     * @register_router mcp/credentials
     * @method POST
     */
    const admin = await mcpAdministrator(req, res);
    if (!admin) return;
    const user = getProxy('auth').user[String(req.body?.userId || admin.id)];
    if (!user || requiresEmailVerification(user)) return res.status(400).json({ error: 'Usuário inválido.' });
    try {
        const issued = mcpAuth.issue({ userId: user.id, tenantId: user.tenantId ?? null,
            scopes: req.body?.scopes, ttlMs: req.body?.ttlMs ?? 86400000,
            maxRequestsPerMinute: req.body?.maxRequestsPerMinute ?? 120 });
        mcpAuth.audit({ timestamp: new Date().toISOString(), operation: 'credential:issued', principal: admin.id, credentialId: issued.credentialId });
        res.set('Cache-Control', 'no-store');
        return res.status(201).json(issued);
    } catch (error) { return res.status(400).json({ error: error.message }); }
}

export async function routerMcpCredentials(req, res) {
    /**
     * @register_router mcp/credentials
     * @method GET
     */
    if (!await mcpAdministrator(req, res)) return;
    res.set('Cache-Control', 'no-store');
    return { credentials: mcpAuth.list() };
}

export async function routerMcpRevoke(req, res) {
    /**
     * @register_router mcp/credentials/:id
     * @method DELETE
     */
    const admin = await mcpAdministrator(req, res);
    if (!admin) return;
    const credentialId = String(req.params?.id || '');
    const revoked = mcpAuth.revoke(credentialId);
    mcpAuth.audit({ timestamp: new Date().toISOString(), operation: 'credential:revoked', principal: admin.id, credentialId, revoked });
    return { revoked };
}
