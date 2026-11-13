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
    assert.match(source, /\{:else if tenantStatus && !provisioningFailed\}/);
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
    assert.match(source, /flow: "app", app: appFlow/);
    assert.match(source, /params\.set\("flow", "app"\)/);

    assert.doesNotThrow(() => compile(source, { generate: 'ssr' }));
});

test('legacy tenant warm-up stays isolated from the normal login destination', async () => {
    const source = await readFile(loginView, 'utf8');

    assert.match(source, /async function pollDestinationUntilReady\(\)/);
    assert.match(source, /await fetch\("\/auth\/destination-ready"\)/);
    assert.match(source, /if \(!response\.ok \|\| !result\.ready\)/);
    assert.match(source, /window\.location\.assign\("\/auth\/enter"\)/);
    assert.match(source, /const DESTINATION_WARMUP_BUDGET_MS = 6000;/);
    assert.match(source, /Date\.now\(\) < deadline/);
    assert.match(source, /if \(isMounted\) window\.location\.assign\("\/auth\/enter"\)/);
    assert.match(source, /if \(onboardingDone\) pollDestinationUntilReady\(\)/);
    assert.match(source, /tenantStatus === "ready" && onboardingDone/);
    assert.match(source, /class="redirect-progress"/);
    assert.doesNotMatch(source, /Go to my workspace/);
    assert.match(source, /window\.location\.href = result\.redirectUrl \|\| "\/redirect\/home";/);

    assert.doesNotThrow(() => compile(source, { generate: 'ssr' }));
});

test('Login keeps onboarding visible when provisioning completes before its answers', async () => {
    const source = await readFile(loginView, 'utf8');

    const waitingBranch = source.indexOf('{:else if tenantStatus && !provisioningFailed}');
    const onboarding = source.indexOf('{#if !onboardingDone}');
    assert.ok(waitingBranch >= 0 && onboarding > waitingBranch);
    assert.match(source, /if \(patch\) await saveOnboarding\(patch\);/);
    assert.doesNotMatch(source, /\{:else if tenantStatus === "ready"\}/);
    assert.doesNotThrow(() => compile(source, { generate: 'ssr' }));
});

test('Login collects an optional three-part brief that is accepted by Auth and delivered to the tenant', async () => {
    const [login, auth, tenantAuth, onboarding] = await Promise.all([
        readFile(loginView, 'utf8'),
        readFile(authEntry, 'utf8'),
        readFile(new URL('../../tenant-packages/tenant-auth/index.js', import.meta.url), 'utf8'),
        readFile(new URL('../agent/hooks/onboarding.js', import.meta.url), 'utf8'),
    ]);

    assert.match(login, /Brief rápido e opcional/);
    assert.match(login, /Qual resultado você quer alcançar primeiro\?/);
    assert.match(login, /Qual é o contexto desse começo\?/);
    assert.match(login, /Para quem você quer criar isso\?/);
    assert.match(login, /Pular brief/);
    assert.match(login, /async function skipOnboarding\(\) \{\s*await finishOnboarding\(\);/);
    assert.doesNotMatch(login, /disabled=\{!context\}/);
    assert.match(auth, /'briefContext'/);
    assert.match(tenantAuth, /auth\/onboarding\/by-proxy-token/);
    assert.match(tenantAuth, /dispatchEvent\('tenant:onboarding-received', \{ onboarding \}\)/);
    assert.match(onboarding, /onboarding\.briefContext/);
    assert.match(onboarding, /upsertSection\(next, 'Contexto', onboarding\.briefContext\)/);
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

test('the destination probe is server-side so cross-origin SSO status is observable', async () => {
    const source = await readFile(authEntry, 'utf8');

    assert.match(source, /async function probeTenantDestination\(/);
    assert.match(source, /export async function destinationReady\(req, res\)/);
    assert.match(source, /@register_router destination-ready/);
    assert.match(source, /const probe = await probeTenantDestination\(user\.tenantDomain, user\.username\)/);
    assert.match(source, /\{ status: 503, ready: false \}/);
});

test('provisioning readiness does not depend on destination cache warm-up', async () => {
    const source = await readFile(authEntry, 'utf8');

    assert.match(source, /const activeTenantWarmups = new Set\(\);/);
    assert.match(source, /const WARMUP_MAX_ATTEMPTS =/);
    assert.match(source, /attempt < WARMUP_MAX_ATTEMPTS/);
    assert.match(source, /startTenantDestinationWarmup\(userId, result\.domain, username, destination\);/);
    assert.match(source, /rec\.tenantStatus = 'ready';/);
    assert.doesNotMatch(source, /while \(true\) \{[\s\S]*await probeTenantDestination/);
});

test('every browser session uses the protocol-aware cookie builder', async () => {
    const source = await readFile(authEntry, 'utf8');

    assert.match(source, /function sessionCookie\(req, sessionId, durationMs\)/);
    assert.match(source, /res\.setHeader\('Set-Cookie', sessionCookie\(req, session\.id, durationMs\)\);/);
    assert.doesNotMatch(source, /`sessionId=\$\{session\.id\}; HttpOnly;/);
});
