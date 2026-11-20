import { AUTHENTICATED_HOME, sessionCookie, startSession as startSessionHandler, endBrowserSession } from './services/browser-sessions.js';
import { createGoogleAuth } from './services/google-auth.js';
import { ticket as ticketHandler } from './services/login-tickets.js';
import { normalizeUser, identityProvider } from './services/identity.js';
import { validateUsername, provisionInitialAdmin, manageUserCommand } from './services/local-users.js';
import { allowLoginAttempt } from './services/login-throttle.js';
import { resolveUserIdFromBearer, resolveProxyCredential, onResolveProxyToken as onResolveProxyTokenHandler, onRecordProxySpend as onRecordProxySpendHandler } from './services/credentials.js';
import {
    npmGroupsFor,
    routerNpmWorkspace as routerNpmWorkspaceHandler,
    routerNpmCatalog as routerNpmCatalogHandler,
    routerNpmCreateToken as routerNpmCreateTokenHandler,
    routerNpmListTokens as routerNpmListTokensHandler,
    routerNpmRevokeToken as routerNpmRevokeTokenHandler,
    routerNpmAuthenticate as routerNpmAuthenticateHandler,
    routerNpmRegisterPackage as routerNpmRegisterPackageHandler,
    routerNpmDeletePackage as routerNpmDeletePackageHandler,
    routerNpmAccess as routerNpmAccessHandler,
    routerNpmDeviceStart as routerNpmDeviceStartHandler,
    routerNpmDeviceApprove as routerNpmDeviceApproveHandler,
    routerNpmDevicePoll as routerNpmDevicePollHandler,
    routerNotifyPairDevice as routerNotifyPairDeviceHandler,
    routerNotifyAuthorize as routerNotifyAuthorizeHandler,
} from './services/registry-devices.js';
import {
    permissionCatalog,
    canManageAuth,
    assignRoleSelections,
    routerPermissionsOverview as routerPermissionsOverviewHandler,
    routerPermissionsCatalog as routerPermissionsCatalogHandler,
    routerPermissionsCreateGroup as routerPermissionsCreateGroupHandler,
    routerPermissionsUpdateGroup as routerPermissionsUpdateGroupHandler,
    routerPermissionsDeleteGroup as routerPermissionsDeleteGroupHandler,
    routerSystemTabs as routerSystemTabsHandler,
    routerPermissionsAddMember as routerPermissionsAddMemberHandler,
    routerPermissionsDeleteMember as routerPermissionsDeleteMemberHandler,
    routerPermissionsCreateGrant as routerPermissionsCreateGrantHandler,
    routerPermissionsCreateFullPackageGrant as routerPermissionsCreateFullPackageGrantHandler,
    routerPermissionsDeleteGrant as routerPermissionsDeleteGrantHandler,
    routerPermissionsForUser as routerPermissionsForUserHandler,
    routerPermissionsAudit as routerPermissionsAuditHandler,
} from './services/permissions.js';
import { loginAttemptStore } from './login-attempts.js';
import { hashPasswordAsync, verifyPasswordAsync } from './password-async.js';
import { createMcpAuth } from './mcp-auth.js';
import { dispatchEvent, getProxy, isPublicRoute, isPublicView, scriba } from 'logos';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isPublicExposure } from './runtime/public-exposure.js';
import { SIGN_IN_VIEW, signInRedirect } from './google_oauth.js';
import { distributedApp, getDistributedApp, pathBelongsToApp } from './app_flow.js';
// Caminho relativo intencional: pacotes do Runtime são carregados diretamente
// pelo host, sem exigir instalação prévia em node_modules.
import { attachPrincipal } from './runtime/identity.js';
import { authorizeViewRequest } from './resource_access.js';
import { assertSurface } from '../ui-schema/index.js';
export { authorizeRequest, requirePermission } from './authorization.js';

// Mantém a configuração local do Auth usada por login, OAuth e sessões.
try { process.loadEnvFile(new URL('./.env', import.meta.url)); } catch {}

// --- FUNÇÕES AUXILIARES DE CRIPTOGRAFIA ---

export function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const iterations = 210000;
    const keylen = 64;
    const digest = 'sha512';

    const hash = crypto.pbkdf2Sync(password, salt, iterations, keylen, digest).toString('hex');
    return `${salt}:${iterations}:${hash}`;
}

async function verifyPassword(password, storedPasswordHash) {
    return verifyPasswordAsync(password, storedPasswordHash);
}

// Contas do fluxo retirado não podem receber automaticamente uma instância
// comercial. Não há rota, view nem permissão local restante para elas.
function isRetiredLocalAccount(user) {
    return user?.accountType === 'local';
}

/** Traduz o schema ThinkIac para o contrato neutro consumido por hosts/apps. */

/** IdentityProvider do ThinkIac. Pode ser usado sem depender de middleware Logos. */

// --- PORTÃO DE ACESSO GLOBAL ---
//
// Anônimo: só main-site (home) e as rotas/telas de auth.
// Usuário comum: acesso condicionado às permissões dos pacotes.
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

    // Contas sem um app concedido permanecem no Runtime público.
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
    await provisionInitialAdmin(db, process.env);

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

// Per-process protection applies to both direct and proxied login requests.

export async function login(req, res) {
    /**
     * @register_router login
     * @public true
     * @method POST
     */
    const { email, password } = req.body || {};
    if (!allowLoginAttempt(req)) {
        res.setHeader('Retry-After', '900');
        return res.status(429).send({ error: 'Too many login attempts. Try again later.' });
    }
    const db = getProxy('auth');

    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    let accountAttempts;
    let reservation;
    if (normalizedEmail) {
        try {
            accountAttempts = loginAttemptStore(scriba.instance._tenants.auth.db);
            reservation = accountAttempts.reserve(normalizedEmail);
        } catch {
            return res.status(503).send({ error: 'Login temporarily unavailable. Try again later.' });
        }
        if (reservation.retryAfter) {
            res.setHeader('Retry-After', String(reservation.retryAfter));
            return res.status(429).send({ error: 'Too many login attempts. Try again later.' });
        }
    }
    const user = normalizedEmail ? await db.user.findOne({ email: normalizedEmail }) : null;

    if (user && !user.disabled && !isRetiredLocalAccount(user) && await verifyPassword(password, user.password) && !user.disabled) {
        try {
            accountAttempts.refund(reservation);
        } catch {
            return res.status(503).send({ error: 'Login temporarily unavailable. Try again later.' });
        }
        // Mantém o registro de atividade da identidade.
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

    return res.status(400).send({ error: 'Credentials not found.' });
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

// Provisioning is local to the operator: credentials never enter an HTTP request.

export async function createUserCommand() {
    /**
     * @register_command create-user
     * @description Provisiona um administrador inicial usando variáveis de ambiente, sem passar senha em argumentos.
     * @cli_runtime full
     */
    return provisionInitialAdmin(getProxy('auth'), process.env);
}

// These commands are a local administrative capability: access to the host and
// database is the authorization boundary, not a remotely callable endpoint.

export async function addUserCommand() {
    /** @register_command add-user
     * @description Cria uma conta local usando variáveis AUTH_USER_.
     * @cli_runtime full
     */
    return manageUserCommand(getProxy('auth'), 'create');
}
export async function listUsersCommand() {
    /** @register_command list-users
     * @description Lista contas locais.
     * @cli_runtime full
     */
    return manageUserCommand(getProxy('auth'), 'list');
}
export async function getUserCommand() {
    /** @register_command get-user
     * @description Consulta uma conta por AUTH_USER_ID.
     * @cli_runtime full
     */
    return manageUserCommand(getProxy('auth'), 'get');
}
export async function updateUserCommand() {
    /** @register_command update-user
     * @description Atualiza uma conta por AUTH_USER_ID.
     * @cli_runtime full
     */
    return manageUserCommand(getProxy('auth'), 'update');
}
export async function disableUserCommand() {
    /** @register_command disable-user
     * @description Desativa uma conta por AUTH_USER_ID.
     * @cli_runtime full
     */
    return manageUserCommand(getProxy('auth'), 'disable');
}
export async function enableUserCommand() {
    /** @register_command enable-user
     * @description Reativa uma conta por AUTH_USER_ID.
     * @cli_runtime full
     */
    return manageUserCommand(getProxy('auth'), 'enable');
}

export async function initialSetupStatus(req) {
    /**
     * @register_router initial-setup
     * @public true
     * @method GET
     */
    return { initialSetupRequired: false, settings: { registrationEnabled: false, invitationsEnabled: false } };
}

export async function createInitialAdmin(req, res) {
    /**
     * @register_router initial-admin
     * @public true
     * @method POST
     */
    return res.status(403).send({ error: 'Initial setup is no longer available. Provision an administrator locally.' });
}

const googleAuth = createGoogleAuth({ ensureEntitlement, isRetiredLocalAccount });

export async function startSession(req, res, userId) {
    return startSessionHandler(req, res, userId);
}

export async function googleStart(req, res) {
    /**
     * @register_router google/start
     * @method GET
     */
    return googleAuth.googleStart(req, res);
}

export async function googleCallback(req, res) {
    /**
     * @register_router google/callback
     * @method GET
     */
    return googleAuth.googleCallback(req, res);
}

export async function ticket(req, res) {
    /**
     * @register_router ticket
     * @method GET
     */
    return ticketHandler(req, res);
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

    return res.redirect(app.sharedView);
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

// Mesmo padrão de resolveUserIdFromBearer() em packages/billing/index.js —
// aqui inline porque a resolução (db.user.findOne por llmProxyToken) já mora
// neste arquivo, sem precisar do dispatchEvent('auth:resolve-proxy-token').

export async function onResolveProxyToken(payload) {
    /**
     * @register_hook auth:resolve-proxy-token
     */
    return onResolveProxyTokenHandler(payload);
}

export async function onRecordProxySpend(payload) {
    /**
     * @register_hook auth:record-proxy-spend
     */
    return onRecordProxySpendHandler(payload);
}

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

/** Emite uma credencial de leitura estritamente vinculada a uma instalação. */
export async function routerNotifyPairDevice(req, res) {
    /**
     * @register_router notify/devices
     * @method POST
     */
    return routerNotifyPairDeviceHandler(req, res);
}

/** Endpoint servidor-servidor usado pelo gateway. Nunca recebe sessão web. */
export async function routerNotifyAuthorize(req, res) {
    /**
     * @register_router notify/authorize
     * @method POST
     */
    return routerNotifyAuthorizeHandler(req, res);
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

// A user can belong to any number of roles. Direct grants are intentionally
// untouched, so a role change never removes a user-specific exception.

// Protocolo mínimo para contribuições da tela System. Um pacote instalado pode
// declarar `manifest.systemTab` (ou uma lista): { id, label, view, order }.
// `renderer: "schema"` troca o iframe por uma surface declarativa nativa.
// O manifesto é a fonte de verdade, como já ocorre com `manifest.menu` no
// Shell; não há um registry em memória que se perca em reload.

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
    if (!user || user.disabled) return res.status(400).json({ error: 'Usuário inválido.' });
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

// Compatibility exports for hosts and direct package consumers.
export { identityProvider, npmGroupsFor, provisionInitialAdmin, manageUserCommand };
