'use strict';

const fs = require('node:fs');
const path = require('node:path');

function toEnvSegment(value) {
  return String(value).replace(/[^A-Za-z0-9]/g, '_').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
}

function parseEnvFile(content) {
  const result = {};
  const lines = String(content).split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i++].trimEnd();
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1);
    if (!key || /\s/.test(key)) continue;
    if (value.startsWith('"')) {
      let acc = value.slice(1);
      while (!acc.endsWith('"') && i < lines.length) acc += '\n' + lines[i++];
      value = (acc.endsWith('"') ? acc.slice(0, -1) : acc)
        .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
        .replace(/\\\\/g, '\\').replace(/\\"/g, '"');
    } else if (value.startsWith("'")) {
      let acc = value.slice(1);
      while (!acc.endsWith("'") && i < lines.length) acc += '\n' + lines[i++];
      value = acc.endsWith("'") ? acc.slice(0, -1) : acc;
    } else {
      value = value.split(/\s+#/)[0].trim();
    }
    result[key] = value;
  }
  return result;
}

function loadPackageEnv(pkg, { base = process.env.PACKAGES_PATH || path.join(process.cwd(), 'packages'), env = process.env, log = console.log } = {}) {
  if (!pkg || !pkg.folder) throw new TypeError('pkg.folder is required');
  const file = path.join(pkg.dir || path.join(base, pkg.folder), '.env');
  if (!fs.existsSync(file)) return {};
  let vars;
  try { vars = parseEnvFile(fs.readFileSync(file, 'utf8')); }
  catch (error) { log(`[env] could not read ${file}: ${error.message}`); return {}; }
  const prefix = toEnvSegment(pkg.folder);
  const injected = {};
  for (const [key, value] of Object.entries(vars)) {
    const skippedOriginal = key in env;
    if (!skippedOriginal) env[key] = value;
    const globalKey = `${prefix}_ENV_${toEnvSegment(key)}`;
    env[globalKey] = value;
    injected[key] = { value, globalKey, skippedOriginal };
  }
  if (Object.keys(injected).length) log(`[env] "${pkg.folder}": loaded ${Object.keys(injected).length} var(s) from .env`);
  return injected;
}

function createEnvModule(options) {
  return {
    name: 'env', phase: 'boot',
    install(container) {
      const load = payload => loadPackageEnv(payload.pkg, options);
      container.bus.on('package:wiring', load, { priority: 10 });
      container.bus.on('reload:env', load, { priority: 10 });
    },
  };
}

const envModule = createEnvModule();
function createRuntimeModule(host) {
  return {
    name: 'env', phase: 'boot',
    install() {
      const container = { bus: { on: host.on }, };
      createEnvModule({ base: host.workspace(), log: host.log }).install(container);
    },
  };
}
module.exports = { toEnvSegment, parseEnvFile, loadPackageEnv, createEnvModule, envModule, createRuntimeModule };
