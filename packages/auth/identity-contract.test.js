import assert from 'node:assert/strict';
import test from 'node:test';
import { attachPrincipal, createPrincipal, hasCapability } from './identity-contract.js';
import { landingDestination, normalizeLandingPath } from './landing.js';
import { clearPublicRouteResolversForTest, isRegisteredPublicPath, registerPublicRouteResolver } from './public-routes.js';
test('contrato de identidade cria principal imutável e preserva compatibilidade', () => { const principal = createPrincipal({ subject: 'u1', role: 'admin', capabilities: ['apps.read'] }); const request = {}; attachPrincipal(request, principal, { id: 'u1' }); assert.equal(request.principal, principal); assert.equal(request.user.id, 'u1'); assert.equal(hasCapability(principal, 'apps.read'), true); });
test('registro opcional decide exposição e falha fechado', () => { clearPublicRouteResolversForTest(); registerPublicRouteResolver('router', path => path === '/publico'); registerPublicRouteResolver('quebrado', () => { throw new Error('offline'); }); assert.equal(isRegisteredPublicPath('/publico'), true); assert.equal(isRegisteredPublicPath('/privado'), false); clearPublicRouteResolversForTest(); });
test('landing por usuário aceita somente rotas internas permitidas', () => { assert.equal(normalizeLandingPath('/view/shell/Index?tab=chat'), '/view/shell/Index?tab=chat'); assert.equal(normalizeLandingPath('https://example.com'), null); assert.equal(normalizeLandingPath('/auth/enter'), null); assert.equal(landingDestination({ landingPath: '/view/tasks/Home' }, '/view/desktop/Index'), '/view/tasks/Home'); });
