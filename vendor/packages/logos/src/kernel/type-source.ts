export { resolvedParameterDocs } from './metadata-contracts';
import { modelCatalog, packageRoot } from './model-catalog';
import { modelBinding } from './model-bindings';
import fs from 'fs';
import path from 'path';
import Module from 'module';

let compiler: any;

/** The language compiler owns syntax, documentation and automatic exports. */
export function compileType(source: string, filename: string): { js: string; docs: Record<string, string> } {
  const language = compiler ??= require(process.env.LOGOS_TYPE_COMPILER || 'logostype');
  return language.compileResource(source, { filename });
}

/** A local loader: no process-wide require.extensions hook or generated files. */
export function loadType(filename: string, js?: string, validate?: (filename: string) => void, binding = modelBinding): any {
  filename = fs.realpathSync(filename);
  validate?.(filename);
  if (require.cache[filename]) return require.cache[filename]!.exports;
  const compiled = js ?? compileType(fs.readFileSync(filename, 'utf8'), filename).js;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = (Module as any)._nodeModulePaths(path.dirname(filename));
  const nativeRequire = loaded.require.bind(loaded);
  loaded.require = (id: string) => {
    if (id.startsWith('.') || path.isAbsolute(id)) {
      const target = path.resolve(path.dirname(filename), id);
      if (target.endsWith('.type')) return loadType(target, undefined, validate, binding);
    }
    return nativeRequire(id);
  };
  require.cache[filename] = loaded;
  try {
    const root = packageRoot(filename);
    const names = Object.keys(modelCatalog(root).models).filter(name => !['module', 'exports', 'require', '__filename', '__dirname', 'arguments', 'eval'].includes(name));
    // Parameters supply ambient names without globals or textual identifier replacement.
    // CoffeeScript locals and function parameters keep their normal lexical precedence.
    (loaded as any).__logosModels = names.map(name => binding(root, name));
    const close = '\n}).apply(this, module.__logosModels);\n';
    const mappedBody = /^(\/\/# sourceMappingURL=.*)$/m.test(compiled)
      ? compiled.replace(/^(\/\/# sourceMappingURL=.*)$/m, close + '$1') : compiled + close;
    const body = names.length ? `(function(${names.join(',')}){` + mappedBody : compiled;
    (loaded as any)._compile(body, filename);
    delete (loaded as any).__logosModels;
    loaded.loaded = true;
    return loaded.exports;
  } catch (error) {
    delete require.cache[filename];
    throw error;
  }
}
