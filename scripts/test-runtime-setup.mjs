import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootstrap } from 'logos';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Exercise route and identity boundaries with the capability modules used by
// the Runtime, rather than implicitly relying on a running application.
await bootstrap({
  workspace: root,
  port: false,
  views: { enabled: false },
  hotReload: { enabled: false },
});
