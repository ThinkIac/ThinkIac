import { expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { candidateHash, candidateManifest, candidateContributors } from '../src/stabilizer/candidate';

it('identifies source edits and deletions while excluding mutable data', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-'));
  try {
    fs.writeFileSync(path.join(root, 'index.js'), 'export const value = 1');
    const original = candidateHash(root);
    fs.mkdirSync(path.join(root, 'data'));
    fs.writeFileSync(path.join(root, 'data', 'state.json'), '{}');
    expect(candidateHash(root)).toBe(original);
    fs.writeFileSync(path.join(root, 'index.js'), 'export const value = 2');
    expect(candidateHash(root)).not.toBe(original);
    fs.unlinkSync(path.join(root, 'index.js'));
    expect(candidateHash(root)).not.toBe(original);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

it('attributes only matching content and preserves multiple contributors', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-authors-'));
  try {
    fs.writeFileSync(path.join(root, 'index.js'), 'export const value = 1');
    const hash = candidateManifest(root)[0].hash;
    const base = { path: path.join(root, 'index.js'), hash };
    const result = candidateContributors(root, [
      { ...base, sessionId: 's1', runId: 'r1', operationId: 'op1' },
      { ...base, sessionId: 's2', runId: 'r2', operationId: 'op2' },
      { ...base, sessionId: 's3', runId: 'r3', hash: 'outdated' },
      { ...base, sessionId: 's4' },
    ]);
    expect(result.authors).toHaveLength(2);
    expect(result.operationIds).toEqual(['op1', 'op2']);
    fs.writeFileSync(base.path, 'export const value = 2');
    expect(candidateContributors(root, [{ ...base, sessionId: 's1', runId: 'r1' }]).authors).toEqual([]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
