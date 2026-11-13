// tests/jsdoc.test.ts — JSDoc extraction: both "above" (v2) and "inside" (v1)
// positions, plus the small tag-reading helpers.

import { describe, it, expect } from 'vitest';
import {
  buildAboveDocMap, docInside, resolveDoc, docLines,
  tagValues, hasTag, parseConditions, parseReach,
} from '../src/kernel/jsdoc';

describe('buildAboveDocMap', () => {
  it('maps a doc above a function declaration', () => {
    const src = `/**\n * @register_tool sum\n */\nfunction sum(a, b) { return a + b; }`;
    expect(buildAboveDocMap(src).sum).toContain('@register_tool sum');
  });

  it('maps docs above const / exports / module.exports / export function', () => {
    const src = [
      '/**\n * @a const\n */\nconst viaConst = () => {};',
      '/**\n * @a exports\n */\nexports.viaExports = () => {};',
      '/**\n * @a modexports\n */\nmodule.exports.viaMod = () => {};',
      '/**\n * @a exportfn\n */\nexport function viaExportFn() {}',
      '/**\n * @a asyncfn\n */\nasync function viaAsync() {}',
    ].join('\n\n');
    const map = buildAboveDocMap(src);
    expect(map.viaConst).toContain('const');
    expect(map.viaExports).toContain('exports');
    expect(map.viaMod).toContain('modexports');
    expect(map.viaExportFn).toContain('exportfn');
    expect(map.viaAsync).toContain('asyncfn');
  });

  it('keeps the first doc when a name repeats', () => {
    const src = `/**\n * first\n */\nfunction dup() {}\n/**\n * second\n */\nfunction dup() {}`;
    expect(buildAboveDocMap(src).dup).toContain('first');
  });

  it('ignores comments not attached to a declaration', () => {
    expect(buildAboveDocMap('/**\n * dangling\n */\nconst x = 1 + 2;').x).toContain('dangling');
    expect(Object.keys(buildAboveDocMap('/** floating */\n;'))).toEqual([]);
  });
});

describe('docInside', () => {
  it('extracts the first JSDoc block from a function source', () => {
    const fnSource = 'function f(){ /**\n * @register_hook e\n */ }';
    expect(docInside(fnSource)).toContain('@register_hook e');
  });

  it('returns null when there is no block', () => {
    expect(docInside('function f(){ return 1; }')).toBeNull();
  });
});

describe('resolveDoc', () => {
  it('prefers an inside-body doc over the above map', () => {
    const fn = new Function('/**\n * @register_tool inside\n */\nreturn 1;');
    const doc = resolveDoc(fn as Function, { anonymous: '@register_tool above' });
    expect(doc).toContain('inside');
  });

  it('falls back to the above map keyed by fn.name', () => {
    function named() { return 1; }
    expect(resolveDoc(named, { named: '@register_tool via-above' })).toBe('@register_tool via-above');
  });

  it('returns null when neither source has a doc', () => {
    function bare() { return 1; }
    expect(resolveDoc(bare, {})).toBeNull();
  });
});

describe('docLines', () => {
  it('strips the leading star and trims each line', () => {
    expect(docLines('\n * @a x\n * @b y\n')).toEqual(['', '@a x', '@b y', '']);
  });
});

describe('tagValues / hasTag', () => {
  it('collects every value for a repeated tag', () => {
    expect(tagValues('@after env\n@after db', 'after')).toEqual(['env', 'db']);
    expect(tagValues('no tags here', 'after')).toEqual([]);
  });

  it('detects a bare flag tag', () => {
    expect(hasTag('@auth\n@streaming', 'auth')).toBe(true);
    expect(hasTag('@authorized', 'auth')).toBe(false); // word boundary
    expect(hasTag('nothing', 'auth')).toBe(false);
  });
});

describe('parseConditions', () => {
  it('merges @only and @when, collects @never', () => {
    expect(parseConditions('@only a\n@when b\n@never c')).toEqual({ only: ['a', 'b'], never: ['c'] });
  });

  it('omits empty condition arrays', () => {
    expect(parseConditions('@description just text')).toEqual({});
  });
});

describe('parseReach', () => {
  it('defaults to auto when the tag is absent (backwards compatible)', () => {
    expect(parseReach('@description no reach here')).toBe('auto');
  });

  it('reads each valid value, case-insensitively', () => {
    expect(parseReach('@reach always')).toBe('always');
    expect(parseReach('@reach manual')).toBe('manual');
    expect(parseReach('@reach auto')).toBe('auto');
    expect(parseReach('@reach ALWAYS')).toBe('always');
  });

  it('falls back to auto on an unrecognised value', () => {
    expect(parseReach('@reach sometimes')).toBe('auto');
    expect(parseReach('@reach')).toBe('auto');
  });
});
