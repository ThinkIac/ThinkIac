import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import vm from 'vm';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const TIMEOUT = 8000;

if (!isMainThread) {
  const { code, input } = workerData;
  const _require = createRequire(import.meta.url);
  const logs = [];

  const BLOCKED = new Set([
    'child_process', 'fs', 'fs/promises', 'http', 'https', 'http2',
    'dgram', 'cluster', 'worker_threads', 'readline', 'repl', 'tls',
    'vm', 'os', 'process', 'v8', 'perf_hooks'
  ]);

  const sandbox = {
    input,
    output: undefined,
    console: {
      log:   (...a) => logs.push({ level: 'log',   msg: a.map(x => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ') }),
      error: (...a) => logs.push({ level: 'error', msg: a.map(x => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ') }),
      warn:  (...a) => logs.push({ level: 'warn',  msg: a.map(x => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ') }),
    },
    require: (mod) => {
      if (BLOCKED.has(mod)) throw new Error(`Módulo "${mod}" é restrito.`);
      if (mod.startsWith('.') || mod.includes('/') || mod.includes('\\')) {
        throw new Error(`Acesso a arquivos locais proibido: "${mod}"`);
      }
      return _require(mod);
    },
    fetch, Promise, JSON, Math, Date, URL,
    parseInt, parseFloat, isNaN, isFinite,
    Number, String, Boolean, Array, Object, Error,
    Map, Set, Symbol,
    encodeURIComponent, decodeURIComponent,
  };

  const ctx = vm.createContext(sandbox);

  (async () => {
    try {
      const script = new vm.Script(
        `(async (input) => { ${code} })(input).then(r => { if(r !== undefined) output = r })`,
        { filename: 'ai-plugin.js' }
      );
      
      await script.runInContext(ctx, { timeout: TIMEOUT });
      
      parentPort.postMessage({ success: true, output: ctx.output, logs });
    } catch (e) {
      parentPort.postMessage({ success: false, error: e.message, logs });
    }
  })();
}

export async function runInSandbox(code, input = {}) {
  const start = Date.now();

  return new Promise((resolve) => {
    const worker = new Worker(fileURLToPath(import.meta.url), {
      workerData: { code, input }
    });

    const forceKill = setTimeout(() => {
      worker.terminate();
      resolve({
        success: false,
        output: null,
        error: "Script excedeu o tempo limite (Timeout)",
        logs: [],
        duration_ms: Date.now() - start
      });
    }, TIMEOUT + 500);

    worker.on('message', (result) => {
      clearTimeout(forceKill);
      worker.terminate();
      resolve({
        ...result,
        duration_ms: Date.now() - start
      });
    });

    worker.on('error', (err) => {
      clearTimeout(forceKill);
      resolve({
        success: false,
        error: err.message,
        logs: [],
        duration_ms: Date.now() - start
      });
    });

    worker.on('exit', (code) => {
      clearTimeout(forceKill);
      if (code !== 0) {
        resolve({
          success: false,
          error: `Worker finalizado com código ${code}`,
          logs: [],
          duration_ms: Date.now() - start
        });
      }
    });
  });
}