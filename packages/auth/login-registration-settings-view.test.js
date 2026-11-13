import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('.', import.meta.url);
const view = readFileSync(new URL('./views/Login.svelte', root), 'utf8');

test('login reads registration settings before showing account creation', () => {
    assert.match(view, /fetch\("\/auth\/initial-setup"\)/);
    assert.match(view, /registrationEnabled = setup\.settings\?\.registrationEnabled !== false/);
    assert.match(view, /!initialSetupRequired && \(registrationEnabled \|\| invitationsEnabled\)/);
});

test('invitation-enabled registration has an invitation code field', () => {
    assert.match(view, /name="invitationCode"/);
    assert.match(view, /required=\{!registrationEnabled\}/);
    assert.match(view, /!initialSetupRequired && invitationsEnabled/);
});

test('Google registration restriction is shown to the user', () => {
    assert.match(view, /google-registration-disabled/);
});
