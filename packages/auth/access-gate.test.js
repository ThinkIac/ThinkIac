import assert from 'node:assert/strict';
import test from 'node:test';
import { accessGate, expectsHtmlDocument, identityProvider, isPublicPath, requiredDelegatedCapability } from './index.js';
import { getBridgeToken } from '../agent/core/session_channel.js';
import { authorizeViewRequest } from './resource_access.js';
import path from 'node:path';

test('machine agent can pair and heartbeat without a browser session', () => {
    assert.equal(isPublicPath('/machine-registry/activations'), true);
    assert.equal(isPublicPath('/machine-registry/activations/status'), true);
    assert.equal(isPublicPath('/machine-registry/heartbeat'), true);
    assert.equal(isPublicPath('/machine-registry/tunnel/authenticate'), true);
    assert.equal(isPublicPath('/machine-registry/tunnel/state'), true);
});

test('Meta webhook is public while WhatsApp Manager administration stays gated', () => {
    assert.equal(isPublicPath('/whatsapp-manager/meta/webhook'), true);
    assert.equal(isPublicPath('/whatsapp-manager/meta/instances'), false);
    assert.equal(isPublicPath('/whatsapp-manager/meta/test'), false);
});

test('a landing pública desta casa pode ser vista sem sessão, sem abrir o pacote inteiro', () => {
    // Views públicas são descobertas ao montar o runtime pelo sufixo .public;
    // sem runtime montado, o gate local não presume que uma view exista.
    assert.equal(isPublicPath('/view/desta-casa/Index'), false);
    assert.equal(isPublicPath('/view/desta-casa/Home'), false);
    // As APIs são liberadas pelo registro vivo de @public, não por allowlist
    // central. Sem um runtime montado esta função continua fechada.
    assert.equal(isPublicPath('/desta-casa/public'), false);
    assert.equal(isPublicPath('/desta-casa/resolve/289'), false);
    assert.equal(isPublicPath('/desta-casa/chat', 'POST'), false);
    assert.equal(isPublicPath('/desta-casa/admin/catalog'), false);
    assert.equal(isPublicPath('/desta-casa/private-data'), false);
});

test('campaign tracking, click redirect, and unsubscribe endpoints are public', () => {
    assert.equal(isPublicPath('/email-manager/track/open'), true);
    assert.equal(isPublicPath('/email-manager/track/click'), true);
    assert.equal(isPublicPath('/email-manager/unsubscribe'), true);
    assert.equal(isPublicPath('/email-manager/unsubscribe/post'), true);
    assert.equal(isPublicPath('/email-manager/campaigns'), false);
});

test('machine ownership operations remain behind the session gate', () => {
    assert.equal(isPublicPath('/machine-registry/activations/approve'), false);
    assert.equal(isPublicPath('/machine-registry/activations/preview'), false);
    assert.equal(isPublicPath('/machine-registry/machines'), false);
    assert.equal(isPublicPath('/machine-registry/machines/revoke'), false);
    assert.equal(isPublicPath('/machine-registry/environments'), false);
});

test('only authenticated project-mail machine endpoints bypass browser sessions', () => {
    assert.equal(isPublicPath('/project-mail-gateway/v1/mailboxes/reserve'), true);
    assert.equal(isPublicPath('/project-mail-gateway/v1/messages/send'), true);
    assert.equal(isPublicPath('/project-mail-gateway/health'), false);
    assert.equal(isPublicPath('/project-mail/api/messages'), false);
});

test('Agent routes remain private at the public-path layer', () => {
    assert.equal(isPublicPath('/agent/internal/chat/stream', 'POST'), false);
    assert.equal(isPublicPath('/agent/chat/stream', 'POST'), false);
    assert.equal(isPublicPath('/agent/internal/chat/cancel', 'POST'), false);
});

test('Agent accepts the ephemeral Runtime credential without a browser session', async () => {
    let continued = false;
    await accessGate({
        path: '/agent/chat/stream',
        method: 'POST',
        headers: { authorization: `Bearer ${getBridgeToken()}` },
    }, {}, () => { continued = true; });
    assert.equal(continued, true);
});

test('every regular asset outside public/private is accessible without a login session', () => {
    assert.equal(isPublicPath('/thinkiac.exe'), true);
    // The old root APK alias was removed. Missing files fail closed.
    assert.equal(isPublicPath('/thinkiac.apk'), false);
    assert.equal(isPublicPath('/thinkiac-app.png'), true);
    assert.equal(isPublicPath('/android/thinkiac/thinkiac.apk'), true);
    assert.equal(isPublicPath('/android/thinkiac/manifest.json'), true);
    assert.equal(isPublicPath('/edge/runtime/thinkiac-base-0.1.0.tar.gz'), true);
    assert.equal(isPublicPath('/flutter-studio/download/thinkiac-edge/thinkiac-edge.apk'), true);
});

test('only published Flutter Studio downloads bypass the session gate', () => {
    assert.equal(isPublicPath('/flutter-studio/download/thinkiac-edge/manifest.json'), true);
    assert.equal(isPublicPath('/flutter-studio/projects'), false);
    assert.equal(isPublicPath('/flutter-studio/publish'), false);
    assert.equal(isPublicPath('/flutter-studio/download/thinkiac-edge/notes.txt'), false);
});

test('private, missing, directory, and traversal paths remain behind the session gate', () => {
    assert.equal(isPublicPath('/private/run.sh'), false);
    assert.equal(isPublicPath('/private/cnpj-scraper/2026-07-08T04-54-57-196Z.csv'), false);
    assert.equal(isPublicPath('/private/thinkiac.apk.bak-20260724'), false);
    assert.equal(isPublicPath('/android/'), false);
    assert.equal(isPublicPath('/missing.apk'), false);
    assert.equal(isPublicPath('/edge-llm/models/../../secrets/model.gguf'), false);
    assert.equal(isPublicPath('/%2e%2e/packages/auth/index.js'), false);
});

test('delegated control-plane sessions are narrowed by method and app', () => {
    assert.equal(requiredDelegatedCapability('GET', '/machine-registry/environments'), 'machines.view');
    assert.equal(requiredDelegatedCapability('POST', '/machine-registry/environments/revoke'), 'machines.manage');
    assert.equal(requiredDelegatedCapability('GET', '/git-cloud/api/overview'), 'git.view');
    assert.equal(requiredDelegatedCapability('POST', '/git-cloud/api/deployments/1/promote'), 'git.deploy');
    assert.equal(requiredDelegatedCapability('GET', '/billing/wallet'), null);
});

test('Auth expõe um IdentityProvider neutro', () => {
    assert.equal(typeof identityProvider.resolve, 'function');
});

test('o gate devolve 401 JSON para endpoints sem sessão', async () => {
    const received = {};
    const res = {
        status(code) { received.status = code; return this; },
        json(body) { received.body = body; return this; },
        redirect(url) { received.redirect = url; return this; },
    };
    await accessGate({ path: '/agent/health', method: 'GET', headers: { accept: 'application/json' } }, res, () => {
        throw new Error('uma chamada anônima não deve passar pelo gate');
    });
    assert.equal(received.status, 401);
    assert.deepEqual(received.body, { error: 'Credencial ausente ou expirada.', code: 'UNAUTHENTICATED' });
    assert.equal(received.redirect, undefined);
});

test('o gate preserva o redirect de uma navegação HTML sem sessão', async () => {
    const received = {};
    const res = {
        status(code) { received.status = code; return this; },
        json(body) { received.body = body; return this; },
        redirect(url) { received.redirect = url; return this; },
    };
    await accessGate({ path: '/view/shell/Index', method: 'GET', headers: { accept: 'text/html,application/xhtml+xml' } }, res, () => {
        throw new Error('uma navegação anônima não deve passar pelo gate');
    });
    assert.equal(received.status, undefined);
    assert.match(received.redirect, /^\/view\/auth\/Login\?next=/);
});

test('somente navegação GET/HEAD com Accept HTML recebe redirect', () => {
    assert.equal(expectsHtmlDocument({ method: 'GET', headers: { accept: 'text/html,application/xhtml+xml' } }), true);
    assert.equal(expectsHtmlDocument({ method: 'GET', headers: { accept: '*/*' } }), false);
    assert.equal(expectsHtmlDocument({ method: 'POST', headers: { accept: 'text/html' } }), false);
});

test('uma view declarada exige a mesma permission mesmo por URL direta', () => {
    const root = path.join(process.cwd(), 'packages');
    const database = {
        user: { ana: { id: 'ana', role: 'user' } },
        permissionMembership: { query: () => [] },
        permissionGrant: { query: () => [] },
        permissionGroup: { query: () => [] },
    };
    // Auth declara Index como auth.users.read.
    const denied = authorizeViewRequest({ requestPath: '/view/auth/Index', userId: 'ana', database, root });
    assert.equal(denied.allowed, false);
    assert.equal(denied.permission, 'auth.users.read');
});

test('CNPJ Scraper operator pode abrir sua Home declarada', () => {
    const root = path.join(process.cwd(), 'packages');
    const rows = (values) => ({ query: (where = {}) => values.filter((row) => Object.entries(where).every(([key, value]) => row[key] === value)) });
    const database = {
        user: { trial: { id: 'trial', role: 'user' } },
        permissionMembership: rows([{ userId: 'trial', groupId: 'cnpj-operator' }]),
        permissionGroup: rows([{ id: 'cnpj-operator', declaredPackage: 'cnpj-scraper', declaredGroup: 'operator' }]),
        permissionGrant: rows([]),
    };
    const access = authorizeViewRequest({ requestPath: '/view/cnpj-scraper/Home', userId: 'trial', database, root });
    assert.equal(access.allowed, true);
    assert.equal(access.permission, 'cnpj-scraper.read');
});

test('view negada volta ao resolvedor de homepage da role', async () => {
    // O gate entrega a navegação ao Redirect. Ele aplica as regras de role e
    // evita mostrar o JSON técnico de autorização para quem está no browser.
    const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('./index.js', import.meta.url), 'utf8'));
    assert.match(source, /if \(\['GET', 'HEAD'\]\.includes\(String\(req\.method \|\| 'GET'\)\.toUpperCase\(\)\)\) \{\s*return res\.redirect\(AUTHENTICATED_HOME\);/s);
});

test('uma view sem declaração de acesso fica exclusiva ao administrador', () => {
    const root = path.join(process.cwd(), 'packages');
    const database = {
        user: { ana: { id: 'ana', role: 'user' }, admin: { id: 'admin', role: 'admin' } },
        permissionMembership: { query: () => [] }, permissionGrant: { query: () => [] }, permissionGroup: { query: () => [] },
    };
    assert.equal(authorizeViewRequest({ requestPath: '/view/redirect/Index', userId: 'ana', database, root }).allowed, false);
    assert.equal(authorizeViewRequest({ requestPath: '/view/redirect/Index', userId: 'admin', database, root }).allowed, true);
});
