import { describe, it, expect } from 'vitest';
import {
    decodeIdTokenClaims,
    validateIdTokenClaims,
    safeNext,
    normalizeClient,
    precisaDeTicket,
    sessionCookie,
    signInRedirect,
    shouldUseSecureSessionCookie,
} from './google_oauth.js';

const AUD = 'client-id-de-teste.apps.googleusercontent.com';
const NONCE = 'nonce-esperado';
const AGORA = 1_700_000_000_000;

function claimsValidas(extra = {}) {
    return {
        iss: 'https://accounts.google.com',
        aud: AUD,
        exp: Math.floor(AGORA / 1000) + 3600,
        nonce: NONCE,
        sub: '1234567890',
        email: 'pessoa@exemplo.com',
        email_verified: true,
        ...extra,
    };
}

function idTokenCom(claims) {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${b64({ alg: 'RS256' })}.${b64(claims)}.assinatura-nao-verificada`;
}

const opcoes = { expectedNonce: NONCE, expectedAudience: AUD, now: AGORA };

describe('decodeIdTokenClaims', () => {
    it('lê o payload de um JWT bem formado', () => {
        const claims = decodeIdTokenClaims(idTokenCom(claimsValidas()));
        expect(claims.sub).toBe('1234567890');
        expect(claims.email).toBe('pessoa@exemplo.com');
    });

    it('devolve null para entradas malformadas em vez de lançar', () => {
        for (const ruim of [undefined, null, '', 'nao-e-jwt', 'a.b', 'a.b.c.d', 'a.###.c']) {
            expect(decodeIdTokenClaims(ruim)).toBeNull();
        }
    });
});

describe('validateIdTokenClaims', () => {
    it('aceita claims íntegras', () => {
        expect(validateIdTokenClaims(claimsValidas(), opcoes)).toBeNull();
    });

    it('aceita o issuer sem esquema que o Google também emite', () => {
        expect(validateIdTokenClaims(claimsValidas({ iss: 'accounts.google.com' }), opcoes)).toBeNull();
    });

    // Este é o teste que importa: sem ele, bastaria criar uma conta Google com
    // o e-mail da vítima para assumir a conta ThinkIac dela por vinculação.
    it('recusa e-mail não verificado', () => {
        expect(validateIdTokenClaims(claimsValidas({ email_verified: false }), opcoes))
            .toBe('e-mail não verificado no Google');
        expect(validateIdTokenClaims(claimsValidas({ email_verified: 'true' }), opcoes))
            .toBe('e-mail não verificado no Google');
        const { email_verified, ...semClaim } = claimsValidas();
        expect(validateIdTokenClaims(semClaim, opcoes)).toBe('e-mail não verificado no Google');
    });

    it('recusa token de outro issuer', () => {
        expect(validateIdTokenClaims(claimsValidas({ iss: 'https://evil.example' }), opcoes))
            .toBe('issuer inesperado');
    });

    it('recusa token emitido para outro client', () => {
        expect(validateIdTokenClaims(claimsValidas({ aud: 'outro-client' }), opcoes))
            .toBe('audience inesperada');
    });

    it('recusa quando não sabemos qual audience esperar', () => {
        expect(validateIdTokenClaims(claimsValidas(), { ...opcoes, expectedAudience: undefined }))
            .toBe('audience inesperada');
    });

    it('recusa token expirado', () => {
        const expirado = claimsValidas({ exp: Math.floor(AGORA / 1000) - 1 });
        expect(validateIdTokenClaims(expirado, opcoes)).toBe('id_token expirado');
    });

    it('recusa nonce divergente — é o que amarra o token a esta tentativa', () => {
        expect(validateIdTokenClaims(claimsValidas({ nonce: 'outro' }), opcoes))
            .toBe('nonce não confere');
        const { nonce, ...semNonce } = claimsValidas();
        expect(validateIdTokenClaims(semNonce, opcoes)).toBe('nonce não confere');
    });

    it('recusa entradas não-objeto', () => {
        expect(validateIdTokenClaims(null, opcoes)).toBe('id_token ilegível');
        expect(validateIdTokenClaims('texto', opcoes)).toBe('id_token ilegível');
    });
});

describe('safeNext', () => {
    it('preserva caminho interno', () => {
        expect(safeNext('/view/agent/Home')).toBe('/view/agent/Home');
        expect(safeNext('/store/app?x=1')).toBe('/store/app?x=1');
    });

    it('rejeita destino externo, inclusive protocol-relative', () => {
        const padrao = '/view/desktop/Index';
        expect(safeNext('//evil.example/phish')).toBe(padrao);
        expect(safeNext('https://evil.example')).toBe(padrao);
        expect(safeNext('/\\evil.example')).toBe(padrao);
        expect(safeNext('javascript:alert(1)')).toBe(padrao);
        expect(safeNext(undefined)).toBe(padrao);
        expect(safeNext(42)).toBe(padrao);
    });

    it('respeita o fallback informado', () => {
        expect(safeNext('https://evil.example', null)).toBeNull();
    });

    it('recusa destinos que reiniciariam o fluxo de autenticação', () => {
        const padrao = '/view/desktop/Index';
        expect(safeNext('/view/auth/Login')).toBe(padrao);
        expect(safeNext('/view/auth/Login?next=%2Fstore')).toBe(padrao);
        expect(safeNext('/auth/google/start?client=web')).toBe(padrao);
        expect(safeNext('/auth/google/callback?code=abc')).toBe(padrao);
        expect(safeNext('/auth/ticket?ticket=abc')).toBe(padrao);
    });
});

describe('signInRedirect', () => {
    it('preserva caminho e query de uma navegação GET protegida', () => {
        expect(signInRedirect({
            method: 'GET',
            path: '/view/wallet/Transactions',
            originalUrl: '/view/wallet/Transactions?account=main&kind=credit',
        })).toBe(
            '/view/auth/Login?next=%2Fview%2Fwallet%2FTransactions%3Faccount%3Dmain%26kind%3Dcredit',
        );
    });

    it('preserva o destino também em HEAD', () => {
        expect(signInRedirect({
            method: 'HEAD',
            path: '/store/private',
            originalUrl: '/store/private?tab=review',
        })).toBe('/view/auth/Login?next=%2Fstore%2Fprivate%3Ftab%3Dreview');
    });

    it('não converte POST em futura navegação GET', () => {
        expect(signInRedirect({
            method: 'POST',
            path: '/wallet/transactions',
            originalUrl: '/wallet/transactions?account=main',
        })).toBe('/view/auth/Login');
    });

    it('descarta URL externa ou protocol-relative recebida como originalUrl', () => {
        expect(signInRedirect({ method: 'GET', originalUrl: 'https://evil.example' }))
            .toBe('/view/auth/Login');
        expect(signInRedirect({ method: 'GET', originalUrl: '//evil.example' }))
            .toBe('/view/auth/Login');
    });
});

describe('normalizeClient', () => {
    it('aceita só os clientes conhecidos', () => {
        expect(normalizeClient('android')).toBe('android');
        expect(normalizeClient('electron')).toBe('electron');
        expect(normalizeClient('web')).toBe('web');
    });

    it('cai para web em qualquer outra coisa', () => {
        for (const ruim of ['ios', '', undefined, null, '__proto__']) {
            expect(normalizeClient(ruim)).toBe('web');
        }
    });
});

describe('precisaDeTicket', () => {
    it('exige ticket onde o consentimento roda em outro cookie jar', () => {
        // Custom Tab no Android, navegador do sistema no desktop.
        expect(precisaDeTicket('android')).toBe(true);
        expect(precisaDeTicket('electron')).toBe(true);
    });

    it('não exige ticket no navegador comum', () => {
        expect(precisaDeTicket('web')).toBe(false);
    });

    it('cliente desconhecido cai no caminho do cookie, não no do deep link', () => {
        for (const ruim of ['ios', '', undefined, null]) {
            expect(precisaDeTicket(ruim)).toBe(false);
        }
    });
});

describe('sessionCookie', () => {
    it('emite Secure e HttpOnly por padrão', () => {
        const cookie = sessionCookie('abc', 86400000);
        expect(cookie).toContain('sessionId=abc');
        expect(cookie).toContain('HttpOnly');
        expect(cookie).toContain('Secure');
        expect(cookie).toContain('SameSite=Strict');
        expect(cookie).toContain('Max-Age=86400');
    });

    it('só omite Secure quando explicitamente pedido (dev em http)', () => {
        expect(sessionCookie('abc', 1000, { insecure: true })).not.toContain('Secure');
    });
});

describe('shouldUseSecureSessionCookie', () => {
    it('mantém Secure em HTTPS direto e atrás de proxy', () => {
        expect(shouldUseSecureSessionCookie({ protocol: 'https', headers: { host: 'thinkiac.cloud' } })).toBe(true);
        expect(shouldUseSecureSessionCookie({ headers: { host: 'thinkiac.cloud', 'x-forwarded-proto': 'https' } })).toBe(true);
    });

    it('omite Secure quando a navegação efetiva usa HTTP', () => {
        expect(shouldUseSecureSessionCookie({ headers: { host: '127.0.0.1:5040' } })).toBe(false);
        expect(shouldUseSecureSessionCookie({ headers: { host: 'localhost:5040' } })).toBe(false);
        expect(shouldUseSecureSessionCookie({ headers: { host: '[::1]:5040' } })).toBe(false);
        expect(shouldUseSecureSessionCookie({ protocol: 'http', headers: { host: 'example.test' } })).toBe(false);
        expect(shouldUseSecureSessionCookie({ headers: { host: '192.168.1.20:5040', 'x-forwarded-proto': 'http' } })).toBe(false);
    });

    it('não presume HTTPS sem evidência e respeita o override de desenvolvimento', () => {
        expect(shouldUseSecureSessionCookie({ headers: { host: 'example.test' } })).toBe(false);
        expect(shouldUseSecureSessionCookie({ protocol: 'https' }, { insecureOverride: true })).toBe(false);
    });
});
