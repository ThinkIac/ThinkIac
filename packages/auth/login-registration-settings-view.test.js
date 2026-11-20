import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
test('login offers existing account authentication only', () => {
 const view = readFileSync(new URL('./views/Login.svelte', import.meta.url), 'utf8');
 assert.doesNotMatch(view, /auth\/(register|confirm-email|resend-verification|status|destination-ready)|invitationCode|tenantStatus/);
 assert.match(view, /google-registration-disabled/);
 assert.match(view, /\/auth\/login/);
});
