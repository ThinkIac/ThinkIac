import fs from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'crypto';

// Source coverage only: mutable data, secrets, dependencies and generated output
// are deliberately excluded. Removing a covered file changes the manifest hash.
const EXCLUDED = new Set(['node_modules', '.git', '.logos', 'data', 'uploads', 'secrets', 'dist', 'generated', 'backups', 'snapshots', 'sessions']);
const SOURCE = /\.(?:[cm]?[jt]s|json|svelte|svx|prisma|inflect|md|css|html)$/i;
export function candidateManifest(root: string): Array<{ path: string; hash: string }> {
  const entries: Array<{ path: string; hash: string }> = [];
  function visit(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (entry.name.startsWith('.') || EXCLUDED.has(entry.name)) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`candidate source symlink unsupported: ${path.relative(root, absolute)}`);
      if (entry.isDirectory()) visit(absolute);
      else if (SOURCE.test(entry.name)) entries.push({ path: path.relative(root, absolute).split(path.sep).join('/'), hash: createHash('sha256').update(fs.readFileSync(absolute)).digest('hex') });
    }
  }
  visit(root);
  return entries;
}
export function candidateHash(root: string): string {
  return createHash('sha256').update(JSON.stringify(candidateManifest(root))).digest('hex');
}
export function createCandidate(root: string) {
  return { schemaVersion: 2, candidateId: randomUUID(), candidateHash: candidateHash(root), producedAt: Date.now() };
}

// Correlation is accepted only for exact file content supplied by a completed
// write. This records contributors, never exclusive ownership of a package.
export function candidateContributors(root: string, evidence: any[]) {
  const manifest = new Map(candidateManifest(root).map(entry => [path.resolve(root, entry.path), entry.hash]));
  const matched = evidence.filter(item => item?.sessionId && item?.runId && typeof item.path === 'string'
    && typeof item.hash === 'string' && manifest.get(path.resolve(item.path)) === item.hash);
  const authors = [...new Map(matched.map(item => {
    const author = { sessionId: item.sessionId, runId: item.runId, taskId: item.taskId || item.runId };
    return [JSON.stringify(author), author];
  })).values()];
  return { authors, operationIds: [...new Set(matched.map(item => item.operationId).filter(Boolean))] };
}
