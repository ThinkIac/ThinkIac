import path from 'node:path';
import type { Stats } from 'node:fs';
export const DEFAULT_TMP_GRACE_MS = 60 * 60 * 1000;
export function classify(relativePath: string, stat: Stats, now: number, tmpGraceMs = DEFAULT_TMP_GRACE_MS) {
  const name = path.basename(relativePath);
  if (stat.isSymbolicLink()) return { classification: 'protected' as const, policy: null, reason: 'symlink is never followed or collected', eligible: false };
  if (stat.isFile() && name.endsWith('.tmp')) {
    const eligible = now - stat.mtimeMs >= tmpGraceMs;
    return { classification: 'disposable' as const, policy: 'expired-temporary', reason: eligible ? `temporary older than ${tmpGraceMs}ms` : `temporary is inside ${tmpGraceMs}ms grace period`, eligible };
  }
  if (stat.isDirectory()) return { classification: 'protected' as const, policy: null, reason: 'directories are retained', eligible: false };
  return { classification: 'unknown' as const, policy: null, reason: 'no collection policy registered', eligible: false };
}
