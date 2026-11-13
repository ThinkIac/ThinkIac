import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runCliExtension } from '../src/cli/extensions';

const roots: string[] = [];
afterEach(() => { roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })); process.exitCode = 0; });
function fixture(cli: unknown) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'logos-cli-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ logos: { cli } }));
  return root;
}
describe('explicit CLI extensions', () => {
  it('resolves relative to the declaring manifest and passes raw arguments', async () => {
    const root = fixture({ tasks: './extension.cjs' });
    fs.mkdirSync(path.join(root, 'child'));
    fs.writeFileSync(path.join(root, 'extension.cjs'), "exports.main = async (argv, ctx) => { require('fs').writeFileSync(ctx.root + '/result.json', JSON.stringify(argv)); return 7; };");
    expect(await runCliExtension(['tasks', 'run', 'build', '--dry-run'], path.join(root, 'child'))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(root, 'result.json'), 'utf8'))).toEqual(['run', 'build', '--dry-run']);
    expect(process.exitCode).toBe(7);
  });
  it('does not select an implicit executor', async () => {
    const root = fixture({});
    expect(await runCliExtension(['missing'], root)).toBe(false);
    expect(await runCliExtension(['toString'], root)).toBe(false);
  });
  it('fails explicitly for invalid entries', async () => {
    await expect(runCliExtension(['tasks'], fixture({ tasks: true }))).rejects.toThrow('Invalid CLI entry');
  });
});
