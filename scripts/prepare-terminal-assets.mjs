import { cp, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const scriptsRoot = dirname(fileURLToPath(import.meta.url));
const publicRoot = join(scriptsRoot, '..', 'public', 'vendor', 'xterm');

function packageRoot(packageName) {
  return dirname(require.resolve(`${packageName}/package.json`));
}

const files = [
  ['@xterm/xterm', 'lib/xterm.js', 'xterm.js'],
  ['@xterm/xterm', 'css/xterm.css', 'xterm.css'],
  ['@xterm/addon-fit', 'lib/addon-fit.js', 'addon-fit.js'],
];

await rm(publicRoot, { recursive: true, force: true });
await mkdir(publicRoot, { recursive: true });
for (const [packageName, source, destination] of files) {
  await cp(join(packageRoot(packageName), source), join(publicRoot, destination));
}
