import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { compile } from 'svelte/compiler';

const loginView = new URL('./views/Login.svelte', import.meta.url);
const authEntry = new URL('./index.js', import.meta.url);

test('Login waits for session validation before rendering credentials', async () => {
    const source = await readFile(loginView, 'utf8');

    assert.match(source, /let sessionCheck = "checking";/);
    assert.match(source, /\{#if sessionCheck === "checking"\}/);
    assert.match(source, /\{:else if sessionCheck === "failed"\}/);
    assert.match(source, /\{:else if sessionCheck === "authenticated"\}/);
    assert.match(source, /checkExistingSession\(\);/);
    assert.match(source, /response\.status !== 401/);
    assert.match(source, /on:click=\{checkExistingSession\}/);

    assert.doesNotThrow(() => compile(source, { generate: 'ssr' }));
});

test('Login preserves any safe internal destination across every login path', async () => {
    const source = await readFile(loginView, 'utf8');

    assert.match(source, /function continueTarget\(\)/);
    assert.doesNotMatch(source, /activationContinueTarget/);
    assert.match(source, /continueTo = continueTarget\(\);/);
    assert.match(source, /if \(continueTo\) \{\s*window\.location\.href = continueTo;/);
    assert.match(source, /params\.set\("next", continueTo\)/);

    assert.doesNotThrow(() => compile(source, { generate: 'ssr' }));
});

test('Login sends authenticated users through Redirect instead of a fixed Shell view', async () => {
    const source = await readFile(loginView, 'utf8');

    assert.match(source, /window\.location\.href = result\.redirectUrl \|\| "\/redirect\/home";/);
    assert.doesNotMatch(source, /window\.location\.href = "\/view\/aurora\/Home";/);

    assert.doesNotThrow(() => compile(source, { generate: 'ssr' }));
});

test('Lectio public flow is preserved across password, session and Google paths', async () => {
    const source = await readFile(loginView, 'utf8');

    assert.match(source, /query\.get\("flow"\) === "app" && query\.get\("app"\) === "lectio"/);
    assert.match(source, /return "\/auth\/apps\/lectio\/enter"/);
    assert.match(source, /params\.set\("flow", "app"\)/);

    assert.doesNotThrow(() => compile(source, { generate: 'ssr' }));
});

test('Login keeps long onboarding steps reachable on small viewports', async () => {
    const source = await readFile(loginView, 'utf8');

    assert.match(source, /min-height: 100dvh;/);
    assert.match(source, /overflow-y: auto;/);
    assert.match(source, /\.auth-shell \{[\s\S]*margin: auto;/);

    assert.doesNotThrow(() => compile(source, { generate: 'ssr' }));
});

test('Login submits the values present in the DOM, including password-manager autofill', async () => {
    const source = await readFile(loginView, 'utf8');

    assert.match(source, /async function handleAuthSubmit\(event\)/);
    assert.match(source, /const formData = new FormData\(event\.currentTarget\);/);
    assert.match(source, /name="email"/);
    assert.match(source, /name="password"/);
    assert.match(source, /<form class="card" novalidate on:submit\|preventDefault=\{handleAuthSubmit\}>/);
    assert.match(source, /type="submit" class="submit"/);

    assert.doesNotThrow(() => compile(source, { generate: 'ssr' }));
});

test('every browser session uses the protocol-aware cookie builder', async () => {
    const source = await readFile(authEntry, 'utf8') + '\n' + await readFile(new URL('./services/browser-sessions.js', import.meta.url), 'utf8');

    assert.match(source, /function sessionCookie\(req, sessionId, durationMs\)/);
    assert.match(source, /res\.setHeader\('Set-Cookie', sessionCookie\(req, session\.id, durationMs\)\);/);
    assert.doesNotMatch(source, /`sessionId=\$\{session\.id\}; HttpOnly;/);
});
