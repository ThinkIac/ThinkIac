// Lógica pura do login com Google — sem I/O, sem banco, sem `logos`.
//
// Está separada de index.js exatamente para ser testável: index.js importa o
// framework inteiro no topo, então qualquer teste que o carregasse subiria o
// kernel junto. Aqui ficam só decisões determinísticas sobre dados.

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const ALLOWED_CLIENTS = new Set(['web', 'android', 'electron']);
export const SIGN_IN_VIEW = '/view/auth/Login';

const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

function base64UrlDecode(segment) {
    return Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

// Lê as claims do id_token SEM verificar assinatura — deliberado, e seguro no
// uso atual: este token não chega pelo navegador, chega na resposta direta do
// endpoint de token do Google, sobre TLS, numa chamada servidor-a-servidor
// autenticada com o client_secret. É o caso em que a própria documentação do
// Google dispensa a validação de assinatura.
//
// ATENÇÃO: se algum dia um id_token passar a chegar por outro caminho — o
// caso típico é o google_sign_in nativo mandando o token obtido no aparelho —
// isto aqui NÃO BASTA, e passa a ser obrigatório validar contra o JWKS.
export function decodeIdTokenClaims(idToken) {
    const parts = String(idToken || '').split('.');
    if (parts.length !== 3) return null;
    try {
        return JSON.parse(base64UrlDecode(parts[1]));
    } catch {
        return null;
    }
}

// Devolve null quando está tudo certo, ou uma string com o motivo da recusa.
export function validateIdTokenClaims(claims, { expectedNonce, expectedAudience, now = Date.now() } = {}) {
    if (!claims || typeof claims !== 'object') return 'id_token ilegível';
    if (!GOOGLE_ISSUERS.has(claims.iss)) return 'issuer inesperado';
    if (!expectedAudience || claims.aud !== expectedAudience) return 'audience inesperada';
    if (!claims.exp || now >= claims.exp * 1000) return 'id_token expirado';
    if (!expectedNonce || claims.nonce !== expectedNonce) return 'nonce não confere';
    if (!claims.sub) return 'sem sub';
    if (!claims.email) return 'sem email';
    // Sem isto, vincular conta por e-mail vira tomada de conta: bastaria criar
    // uma conta Google com o e-mail da vítima e nunca provar posse dele.
    if (claims.email_verified !== true) return 'e-mail não verificado no Google';
    return null;
}

function restartsAuthentication(candidate) {
    const path = candidate.split(/[?#]/, 1)[0];
    return path === SIGN_IN_VIEW
        || path === '/auth/google/start'
        || path === '/auth/google/callback'
        || path === '/auth/ticket';
}

// Só caminho interno. Barra dupla é rejeitada porque "//evil.com" é uma URL
// protocol-relative: o navegador a trata como host externo. Destinos do
// próprio login também são recusados para não criar loops após autenticar.
export function safeNext(candidate, fallback = '/view/desktop/Index') {
    if (typeof candidate !== 'string') return fallback;
    if (!candidate.startsWith('/')) return fallback;
    if (candidate.startsWith('//')) return fallback;
    if (candidate.includes('\\')) return fallback;
    if (restartsAuthentication(candidate)) return fallback;
    return candidate;
}

// Só preserva o destino de navegações idempotentes. Um POST que recebeu 302
// não pode reaparecer depois do login como GET, pois isso muda a operação.
export function signInRedirect(req, signInView = SIGN_IN_VIEW) {
    const method = String(req?.method || '').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return signInView;

    const requested = safeNext(req?.originalUrl || req?.url || req?.path, null);
    if (!requested) return signInView;
    return `${signInView}?next=${encodeURIComponent(requested)}`;
}

export function normalizeClient(candidate) {
    return ALLOWED_CLIENTS.has(candidate) ? candidate : 'web';
}

// O consentimento roda no mesmo cookie jar da janela que vai usar a sessão?
// Só no navegador comum. No Android ele abre em Custom Tab, e no desktop no
// navegador padrão do sistema — nos dois casos o cookie gravado no callback
// cairia no lugar errado, e a sessão precisa voltar por ticket de uso único.
//
// Cliente desconhecido cai em "web" pelo normalizeClient, o que é o padrão
// certo: cookie direto só falha visivelmente (usuário segue deslogado), ao
// passo que um deep link para um app inexistente não leva a lugar nenhum.
export function precisaDeTicket(client) {
    return normalizeClient(client) !== 'web';
}

// O atributo Secure deve refletir o protocolo visto pelo navegador. O runtime
// pode receber HTTP internamente atrás de um proxy HTTPS, por isso consideramos
// primeiro X-Forwarded-Proto e depois os sinais da conexão direta. Presumir
// HTTPS pelo hostname faria navegadores em HTTP remoto descartarem a sessão.
export function shouldUseSecureSessionCookie(req, { insecureOverride = false } = {}) {
    if (insecureOverride) return false;

    const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '')
        .split(',', 1)[0]
        .trim()
        .toLowerCase();
    if (forwardedProto) return forwardedProto === 'https';
    return req?.protocol === 'https' || req?.secure === true
        || Boolean(req?.socket?.encrypted || req?.connection?.encrypted);
}

// Cookie de sessão num lugar só. Antes a mesma string estava duplicada em
// login() e register() (e mais duas vezes no tenant-auth), sempre sem Secure.
export function sessionCookie(sessionId, durationMs, { insecure = false } = {}) {
    const maxAge = Math.floor(durationMs / 1000);
    const secure = insecure ? '' : ' Secure;';
    return `sessionId=${sessionId}; HttpOnly;${secure} Path=/; SameSite=Strict; Max-Age=${maxAge}`;
}
