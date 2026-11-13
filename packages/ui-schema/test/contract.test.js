import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSurface } from '../index.js';

test('accepts a versioned surface with a closed action contract', () => {
  assert.deepEqual(validateSurface({ version: 1, kind: 'example', actions: { 'example.save': { intent: 'write' } } }), { valid: true });
});

test('rejects executable or undeclared action shapes', () => {
  assert.equal(validateSurface({ version: 1, kind: 'example', actions: { 'bad action': { intent: 'write' } } }).valid, false);
  assert.equal(validateSurface({ version: 1, kind: 'example', actions: { 'example.run': { intent: 'execute' } } }).valid, false);
});

