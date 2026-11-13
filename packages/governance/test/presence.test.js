import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAction, resolveConfirmation, consumeApproval, approvedContinuation, setGovernanceStoreForTest, setGovernanceEventDispatcherForTest } from '../service.js';

const rows = [];
setGovernanceEventDispatcherForTest(async () => {});
setGovernanceStoreForTest({ governanceDecision: {
  push: async row => { const saved = { ...row, id: `presence-${rows.length}` }; rows.push(saved); return saved; },
  findOne: filter => rows.find(row => Object.entries(filter).every(([k,v]) => row[k] === v)),
  query: (filter, { limit } = {}) => rows.filter(row => Object.entries(filter).every(([k,v]) => row[k] === v)).slice(0, limit),
} });
test('Presence exige aprovação mesmo com default auto e conserva limites na retomada', async () => {
  const sessionId = 'presence:personal';
  const options = { origin: 'presence', toolAllowlist: ['write_file'], maxActions: 1 };
  const decision = await evaluateAction({ sessionId, tool: 'write_file', input: { path: 'proposal.txt', content: 'draft' } }, { requireReview: true, reviewSource: 'presence', continuation: options });
  assert.equal(decision.allowed, false); assert.equal(decision.classification, 'needs_confirmation');
  await resolveConfirmation({ sessionId, decisionId: decision.decisionId, approved: true });
  assert.deepEqual(approvedContinuation({ sessionId }), options);
  assert.equal((await consumeApproval({ sessionId, decisionId: decision.decisionId, tool: 'write_file', input: { path: 'proposal.txt', content: 'draft' } })).allowed, true);
});
test('negação da ação é respeitada e confirmação não pode mudar argumentos', async () => {
  const sessionId = 'presence-denial';
  const decision = await evaluateAction({ sessionId, tool: 'write_file', input: { path: 'a.txt' } }, { requireReview: true, reviewSource: 'presence' });
  await resolveConfirmation({ sessionId, decisionId: decision.decisionId, approved: false });
  await assert.rejects(consumeApproval({ sessionId, decisionId: decision.decisionId, tool: 'write_file', input: { path: 'a.txt' } }), /não foi aprovada/);
});
