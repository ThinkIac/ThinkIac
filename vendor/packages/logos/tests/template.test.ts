// tests/template.test.ts — {{dot.path}} interpolation for data-driven steps.

import { describe, it, expect } from 'vitest';
import { resolveTemplate } from '../src/kernel/template';

describe('resolveTemplate', () => {
  it('substitutes a shallow key', () => {
    expect(resolveTemplate('hi {{name}}', { name: 'Ana' })).toBe('hi Ana');
  });

  it('resolves dotted paths', () => {
    expect(resolveTemplate('{{user.profile.city}}', { user: { profile: { city: 'SP' } } })).toBe('SP');
  });

  it('tolerates surrounding whitespace in the braces', () => {
    expect(resolveTemplate('{{  a  }}', { a: 'x' })).toBe('x');
  });

  it('renders missing / null / undefined paths as empty strings', () => {
    expect(resolveTemplate('[{{missing}}]', {})).toBe('[]');
    expect(resolveTemplate('[{{a.b.c}}]', { a: {} })).toBe('[]');
    expect(resolveTemplate('[{{v}}]', { v: null })).toBe('[]');
  });

  it('JSON-stringifies non-string values', () => {
    expect(resolveTemplate('{{obj}}', { obj: { a: 1 } })).toBe('{"a":1}');
    expect(resolveTemplate('{{n}}', { n: 42 })).toBe('42');
    expect(resolveTemplate('{{arr}}', { arr: [1, 2] })).toBe('[1,2]');
  });

  it('replaces multiple occurrences', () => {
    expect(resolveTemplate('{{a}}-{{a}}-{{b}}', { a: '1', b: '2' })).toBe('1-1-2');
  });

  it('returns non-string input untouched', () => {
    expect(resolveTemplate(42 as any, {})).toBe(42);
  });

  it('leaves malformed placeholders alone', () => {
    expect(resolveTemplate('{{ not a path! }}', { x: 1 })).toBe('{{ not a path! }}');
  });
});
