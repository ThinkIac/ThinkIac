import { getProxy } from 'logos';
import crypto from 'node:crypto';
import { GOOGLE_AUTH_URL, GOOGLE_TOKEN_URL, decodeIdTokenClaims, validateIdTokenClaims,
    safeNext, normalizeClient, precisaDeTicket } from '../google_oauth.js';
import { resolveGoogleUser } from '../google_user.js';
import { appDestination, distributedApp } from '../app_flow.js';
import { gatewayBaseUrl } from './registry-devices.js';
import { AUTHENTICATED_HOME, startSession } from './browser-sessions.js';
import { loginRedirect } from './login-tickets.js';

// O callback recebe políticas existentes sem importar o entrypoint.
export function createGoogleAuth({ ensureEntitlement, isRetiredLocalAccount }) {
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
    // Para client=web o callback grava o cookie; android/electron recebem ticket.

    const OAUTH_FLOW_TTL_MS = 10 * 60 * 1000;
    const LOGIN_TICKET_TTL_MS = 60 * 1000;

    function googleRedirectUri() {
        return `${gatewayBaseUrl()}/auth/google/callback`;
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

    async function googleStart(req, res) {
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

    async function googleCallback(req, res) {
        const db = getProxy('auth');

        if (req.query?.error) return res.redirect(loginRedirect('google-cancelado'));

        const { code, state } = req.query || {};
        if (!code || !state) return res.redirect(loginRedirect('google-resposta-incompleta'));

        const flow = await db.oauthflow.findOne({ state });
        if (!flow) return res.redirect(loginRedirect('google-estado-invalido'));

        // Remove antes da rede, preservando a ordem legada. A leitura e a remoção
        // não formam uma operação atômica entre processos; ver ARCHITECTURE.md.
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

        // OAuth autentica apenas contas existentes. Configurações legadas de
        // cadastro não podem reabrir criação de identidades.
        const { user } = await resolveGoogleUser(db.user, claims, {
            autolink: process.env.AUTH_ENV_GOOGLE_AUTOLINK !== '0',
        });
        if (!user) return res.redirect(loginRedirect('google-registration-disabled'));

        if (user.disabled || isRetiredLocalAccount(user)) return res.redirect(loginRedirect('conta-bloqueada'));

        // Mantém o registro de atividade usado pelos consumidores da identidade.
        user.lastActivityAt = new Date();

        if (flow.appSlug) {
            await ensureEntitlement(db, user.id, flow.appSlug);
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

    return { googleStart, googleCallback };
}
