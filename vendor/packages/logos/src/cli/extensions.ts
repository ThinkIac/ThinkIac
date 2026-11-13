import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

/** Explicit workspace CLI composition; no runtime bootstrap or built-in executor. */
export async function runCliExtension(argv: string[], start = process.cwd()): Promise<boolean> {
  if (!argv[0]) return false;
  let root = path.resolve(start);
  while (true) {
    const file = path.join(root, 'package.json');
    if (fs.existsSync(file)) {
      const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
      const extensions = manifest.logos?.cli;
      if (extensions && Object.prototype.hasOwnProperty.call(extensions, argv[0])) {
        const entry = extensions[argv[0]];
        if (typeof entry !== 'string' || !entry) throw new Error(`Invalid CLI entry: ${argv[0]}`);
        const extension = createRequire(file)(entry);
        if (typeof extension.main !== 'function') throw new Error(`CLI entry must export main: ${entry}`);
        const code = await extension.main(argv.slice(1), { root });
        if (code !== undefined && (!Number.isInteger(code) || code < 0 || code > 255)) throw new Error('CLI extension returned invalid exit code');
        process.exitCode = code ?? 0;
        return true;
      }
    }
    const parent = path.dirname(root);
    if (parent === root) return false;
    root = parent;
  }
}
