// tests/conditions.test.ts — declarative availability (@only/@never/@when).

import { describe, it, expect } from 'vitest';
import { resolveConditions } from '../src/kernel/conditions';

describe('resolveConditions', () => {
  it('is available with no conditions', async () => {
    expect(await resolveConditions()).toBe(true);
    expect(await resolveConditions({}, {})).toBe(true);
  });

  it('requires every "only" key to be truthy in context', async () => {
    expect(await resolveConditions({ only: ['a'] }, { a: true })).toBe(true);
    expect(await resolveConditions({ only: ['a', 'b'] }, { a: true, b: 1 })).toBe(true);
    expect(await resolveConditions({ only: ['a', 'b'] }, { a: true })).toBe(false);
    expect(await resolveConditions({ only: ['a'] }, {})).toBe(false);
  });

  it('treats "when" identically to "only" (v1 leftover)', async () => {
    expect(await resolveConditions({ when: ['a'] }, { a: true })).toBe(true);
    expect(await resolveConditions({ when: ['a'] }, {})).toBe(false);
  });

  it('combines only and when — both must hold', async () => {
    expect(await resolveConditions({ only: ['a'], when: ['b'] }, { a: 1, b: 1 })).toBe(true);
    expect(await resolveConditions({ only: ['a'], when: ['b'] }, { a: 1 })).toBe(false);
  });

  it('blocks when any "never" key is truthy', async () => {
    expect(await resolveConditions({ never: ['b'] }, { b: true })).toBe(false);
    expect(await resolveConditions({ never: ['b'] }, { b: false })).toBe(true);
    expect(await resolveConditions({ never: ['b'] }, {})).toBe(true);
  });

  it('applies only and never together', async () => {
    expect(await resolveConditions({ only: ['a'], never: ['b'] }, { a: 1 })).toBe(true);
    expect(await resolveConditions({ only: ['a'], never: ['b'] }, { a: 1, b: 1 })).toBe(false);
  });
});
