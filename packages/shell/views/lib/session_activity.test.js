import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasSessionActivity,
  hasSessionUpdate,
  isSessionWorking,
} from './session_activity.js';

test('session activity derives work and new responses from the shared shell maps', () => {
  const loading = { working: true, idle: false };
  const unread = { answered: true, idle: false };

  assert.equal(isSessionWorking('working', loading), true);
  assert.equal(hasSessionUpdate('answered', unread), true);
  assert.equal(hasSessionActivity('working', loading, unread), true);
  assert.equal(hasSessionActivity('answered', loading, unread), true);
  assert.equal(hasSessionActivity('idle', loading, unread), false);
});
