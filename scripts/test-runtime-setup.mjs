import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { bootstrap } from 'logos';

const workspace = mkdtempSync(join(tmpdir(), 'thinkiac-boundary-tests-'));
process.on('exit', () => rmSync(workspace, { recursive: true, force: true }));

// Exercise route and identity boundaries with the capability modules used by
// the Runtime. Use an empty workspace: recursive discovery must not execute
// application packages, examples or vendor trees as a test preload.
await bootstrap({
  workspace,
  port: false,
  views: { enabled: false },
  hotReload: { enabled: false },
});
