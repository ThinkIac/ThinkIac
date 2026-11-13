import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
test('email confirmation gates bonus, not login, sessions or SSO', async () => {
 const source = await readFile(new URL('./index.js', import.meta.url), 'utf8');
 assert.doesNotMatch(source, /if \(requiresEmailVerification\(user\)\) return null;/);
 assert.doesNotMatch(source, /if \(requiresEmailVerification\(user\)\) return res\.redirect/);
 const register = source.slice(source.indexOf('export async function register('), source.indexOf('export async function confirmEmail('));
 assert.match(register, /await startSession\(req, res, user.id\)/);
 assert.doesNotMatch(register, /provisionTenant\(user.id/);
 assert.match(register, /tenantStatus:\s*null/);
 assert.match(register, /requiresEmailVerification: false/);
 assert.match(source, /await requestWelcomeCredit\(user.id\)/);
});
