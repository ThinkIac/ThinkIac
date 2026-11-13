// kernel/debug-log.ts — boot/reload error collector, exposed at /__debug/errors.
// Kept API-compatible with v1 (appendLog/getErrors/clearErrors).

'use strict';

import fs from 'fs';
import path from 'path';

const LOG_FILE = path.join(process.cwd(), '.runtime-errors.json');
const _errors: any[] = [];

export function appendLog(pkgFolder: string, phase: string, err: any): void {
  const entry = {
    ts: new Date().toISOString(),
    package: pkgFolder,
    phase,
    message: err?.message ?? String(err),
    stack: err?.stack ?? null,
  };
  _errors.push(entry);

  try {
    let existing: any[] = [];
    if (fs.existsSync(LOG_FILE)) existing = JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
    existing.push(entry);
    if (existing.length > 200) existing = existing.slice(-200);
    fs.writeFileSync(LOG_FILE, JSON.stringify(existing, null, 2), 'utf-8');
  } catch { /* disk is best-effort */ }

  console.error(`[logos][${phase}] package "${pkgFolder}" failed: ${entry.message}`);
  if (entry.stack) entry.stack.split('\n').slice(1, 5).forEach((l: string) => console.error('  ' + l.trim()));
}

export function getErrors(): any[] {
  try {
    if (fs.existsSync(LOG_FILE)) {
      const disk = JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
      const seen = new Set(_errors.map(e => e.ts + e.package));
      const merged = [..._errors, ...disk.filter((e: any) => !seen.has(e.ts + e.package))];
      return merged.sort((a, b) => a.ts.localeCompare(b.ts)).slice(-100);
    }
  } catch { /* fall through */ }
  return _errors.slice(-100);
}

export function clearErrors(): void {
  _errors.length = 0;
  try { fs.unlinkSync(LOG_FILE); } catch { /* ok */ }
}
