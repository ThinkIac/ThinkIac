import fs from 'fs';
import path from 'path';
import Module from 'module';

let compiler: any;

/** LógosType v1 is ordinary CoffeeScript 2, exported through CommonJS. */
export function compileType(source: string, filename: string): { js: string; docs: Record<string, string> } {
  // Lazy loading preserves a minimal JS-only boot. The compiler is shipped as a
  // language dependency, independent of HTTP and all other capability modules.
  const coffee = compiler ??= require('coffeescript');
  let js = coffee.compile(source, { bare: true, filename, inlineMap: true });
  const automatic = new Set<string>();
  const docs: Record<string, string> = Object.create(null);
  // Read actual lexer comments, never ### text embedded in a string. Associate
  // the original comment with the following assignment before compilation can
  // hoist variables or generate anonymous JavaScript functions.
  for (const token of coffee.tokens(source, { filename })) {
    for (const comment of token.comments ?? []) {
      if (!comment.here || comment.locationData.first_column !== 0) continue;
      const rest = source.slice(comment.locationData.range[1]);
      const assignment = rest.match(/^\s*(?:(?:module\.)?exports\.([\w$]+)|([\w$]+))\s*=/);
      if (!assignment) continue;
      const name = assignment[1] || assignment[2];
      docs[name] = comment.content.split('\n')
        .map((line: string) => line.trim().replace(/^[#*]\s?/, '')).join('\n');
      if (/^@register(?:[ \t]|_)/m.test(docs[name])) {
        if (assignment[2]) automatic.add(name);
      }
    }
  }
  // Append after CoffeeScript's generated body, before its original source map.
  // Guard explicit exports rather than silently replacing a different handler.
  const exportsCode = [...automatic].map(name => `
if (typeof ${name} !== "function") throw new TypeError(${JSON.stringify("[logos] @register requires a function: " + filename + ":" + name)});
if (Object.prototype.hasOwnProperty.call(module.exports, ${JSON.stringify(name)}) && module.exports[${JSON.stringify(name)}] !== ${name}) throw new Error(${JSON.stringify('[logos] conflicting export ' + name + ' in ' + filename)});
module.exports[${JSON.stringify(name)}] = ${name};`).join('\n');
  js = js.replace(/(?=^\/\/# sourceMappingURL=)/m, exportsCode + '\n');
  return { js, docs };
}

/** A local loader: no process-wide require.extensions hook or generated files. */
export function loadType(filename: string, js?: string, validate?: (filename: string) => void): any {
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
      if (target.endsWith('.type')) return loadType(target, undefined, validate);
    }
    return nativeRequire(id);
  };
  require.cache[filename] = loaded;
  try {
    (loaded as any)._compile(compiled, filename);
    loaded.loaded = true;
    return loaded.exports;
  } catch (error) {
    delete require.cache[filename];
    throw error;
  }
}
