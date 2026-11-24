import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

export function externalModuleRoots(): string[] {
  return [path.resolve(__dirname, '../../../modules'), path.resolve(__dirname, '../../../../modules')];
}

export function externalModulePath(name: string): string {
  // Installed capabilities work without the vendor/sibling layout.
  const [base, ...rest] = name.split('/');
  for (const location of [process.cwd(), __dirname]) {
    const resolve = createRequire(path.join(location, 'package.json'));
    try {
      const entry = resolve.resolve(`@thinkiac/module-${base}`);
      return path.join(path.dirname(entry), ...rest);
    } catch (error: any) {
      if (!['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) throw error;
    }
  }
  for (const root of externalModuleRoots()) {
    const candidate = path.join(root, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`[logos] external capability module not found: ${name}`);
}
