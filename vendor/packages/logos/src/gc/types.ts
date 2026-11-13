export type GcClassification = 'disposable' | 'protected' | 'unknown';
export interface GcEntry {
  path: string; relativePath: string; kind: 'file' | 'directory' | 'symlink' | 'other';
  classification: GcClassification; policy: string | null; reason: string; size: number;
  blocks: number; mtimeMs: number; eligible: boolean;
  identity: { dev: number; ino: number; size: number; mtimeMs: number };
}
export interface GcInventory {
  root: string; scannedAt: string;
  totals: { entries: number; bytes: number; diskBytes: number; eligibleEntries: number; eligibleBytes: number; protectedBytes: number; unknownBytes: number };
  entries: GcEntry[]; errors: Array<{ path: string; error: string }>; truncated: boolean;
}
export interface GcRunResult {
  dryRun: boolean; startedAt: string; completedAt: string; considered: number; planned: number; plannedBytes: number; removed: number; bytesFreed: number;
  skipped: Array<{ path: string; reason: string }>; errors: Array<{ path: string; error: string }>;
}
