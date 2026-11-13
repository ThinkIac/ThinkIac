import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attachPrincipal,
  createIdentityMiddleware,
  createPrincipal,
  hasCapability,
} from './identity.js';

test('principal é imutável e não expõe detalhes do provider', () => {
  const principal = createPrincipal({ id: 'u1', role: 'admin', capabilities: ['notes.read'] });

  assert.equal(principal.subject, 'u1');
  assert.deepEqual(principal.roles, ['admin']);
  assert.equal(hasCapability(principal, 'notes.read'), true);
});

test('middleware injeta principal e conserva req.user durante a migração', async () => {
  const req = {};
  let nexted = false;
  const middleware = createIdentityMiddleware({
    provider: {
      resolve: async () => ({
        principal: createPrincipal({ id: 'u1' }),
        user: { id: 'u1' },
      }),
    },
  });

  await middleware(req, {}, () => { nexted = true; });

  assert.equal(nexted, true);
  assert.equal(req.principal.subject, 'u1');
  assert.equal(req.user.id, 'u1');
  assert.equal(attachPrincipal({}, createPrincipal({ id: 'u2' })).subject, 'u2');
});
