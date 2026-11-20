import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const authEntry = new URL('./index.js', import.meta.url);

test('the root logout link revokes the session, clears its cookie and returns to login', async () => {
    const source = (await Promise.all(['./index.js', './adapters/authentication.js', './services/access-gate.js', './services/password-login.js'].map(file => readFile(new URL(file, import.meta.url), 'utf8')))).join('\n') + '\n' + await readFile(new URL('./services/browser-sessions.js', import.meta.url), 'utf8');

    assert.match(source, /req\.path === '\/logout'.*?\.toUpperCase\(\) === 'GET'/s);
    assert.match(source, /await getProxy\('auth'\)\.session\.delete\(sessionId\)/);
    assert.match(source, /res\.setHeader\('Set-Cookie', sessionCookie\(req, '', 0\)\)/);
    assert.match(source, /@register_router logout[\s\S]*?@public true[\s\S]*?@method GET/);
    assert.match(source, /return res\.redirect\(SIGN_IN_VIEW\);/);
});
