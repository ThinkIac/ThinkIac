// tests/cache.test.ts — the mtime-fingerprinted scan cache.

import { describe, it, expect } from 'vitest';
import { ScanCache } from '../src/kernel/cache';

describe('ScanCache', () => {
  it('returns undefined for an unknown key', () => {
    const cache = new ScanCache();
    expect(cache.get('missing', 'fp')).toBeUndefined();
  });

  it('returns the stored value when the fingerprint matches', () => {
    const cache = new ScanCache();
    cache.set('k', 'fp1', [1, 2, 3]);
    expect(cache.get('k', 'fp1')).toEqual([1, 2, 3]);
  });

  it('invalidates (and evicts) when the fingerprint changes', () => {
    const cache = new ScanCache();
    cache.set('k', 'fp1', ['x']);
    expect(cache.get('k', 'fp2')).toBeUndefined();
    // stale entry is dropped, so even the original fingerprint is gone now
    expect(cache.get('k', 'fp1')).toBeUndefined();
  });

  it('set overwrites an existing entry with a new fingerprint/value', () => {
    const cache = new ScanCache();
    cache.set('k', 'fp1', 'a');
    cache.set('k', 'fp2', 'b');
    expect(cache.get('k', 'fp2')).toBe('b');
  });

  it('invalidatePrefix drops every key under a folder path only', () => {
    const cache = new ScanCache();
    cache.set('/ws/pkgA::tools', 'fp', 1);
    cache.set('/ws/pkgA::hooks', 'fp', 2);
    cache.set('/ws/pkgB::tools', 'fp', 3);
    cache.invalidatePrefix('/ws/pkgA');
    expect(cache.get('/ws/pkgA::tools', 'fp')).toBeUndefined();
    expect(cache.get('/ws/pkgA::hooks', 'fp')).toBeUndefined();
    expect(cache.get('/ws/pkgB::tools', 'fp')).toBe(3);
  });

  it('clear empties the whole cache', () => {
    const cache = new ScanCache();
    cache.set('a', 'fp', 1);
    cache.set('b', 'fp', 2);
    cache.clear();
    expect(cache.get('a', 'fp')).toBeUndefined();
    expect(cache.get('b', 'fp')).toBeUndefined();
  });
});
