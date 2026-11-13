// kernel/cache.ts — scan cache with mtime-based invalidation.
//
// v1's cache was deleted on every call in development, which meant every
// request re-scanned and re-required every file in a package. v2 keys each
// entry to a fingerprint of the scanned files' mtimes: the cache is valid
// until any relevant file actually changes — in dev and prod alike.

'use strict';

interface Entry {
  fingerprint: string;
  value: any;
}

export class ScanCache {
  private store = new Map<string, Entry>();

  get(key: string, fingerprint: string): any | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.fingerprint !== fingerprint) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, fingerprint: string, value: any): void {
    this.store.set(key, { fingerprint, value });
  }

  /** Drops every entry whose key starts with `prefix` (a folder path). */
  invalidatePrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  clear(): void {
    this.store.clear();
  }
}
