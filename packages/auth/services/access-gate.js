import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getProxy, isPublicRoute, isPublicView } from 'logos';
import { isPublicExposure } from '../runtime/public-exposure.js';
import { identityProvider } from './identity.js';
import { attachPrincipal } from '../runtime/identity.js';
import { signInRedirect } from '../google_oauth.js';
import { AUTHENTICATED_HOME } from './browser-sessions.js';
import { logout } from './password-login.js';
import { activeEntitlements, isRetiredLocalAccount } from './account-policy.js';
import { pathBelongsToApp } from '../app_flow.js';
import { authorizeViewRequest } from '../resource_access.js';
import { authorize } from '../permissions.cjs';
import { permissionCatalog } from './permissions.js';
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
const PUBLIC_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../public');
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
            const { isValidBridgeToken } = await import('../../agent/core/session_channel.js');
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
