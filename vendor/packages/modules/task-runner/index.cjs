'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const exists = file => fs.existsSync(file);
const slash = value => value.split(path.sep).join('/');

function findRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  while (true) {
    const file = path.join(dir, 'package.json');
    if (exists(file) && read(file).workspaces) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('No workspace package.json found');
    dir = parent;
  }
}

function discover(root) {
  const manifest = read(path.join(root, 'package.json'));
  const patterns = Array.isArray(manifest.workspaces) ? manifest.workspaces : manifest.workspaces?.packages;
  if (!Array.isArray(patterns)) throw new Error('workspaces must be an array or { packages: [] }');
  const dirs = new Set();
  for (const pattern of patterns) {
    if (typeof pattern !== 'string' || /[!{}?\\]/.test(pattern) || pattern.includes('**') || path.isAbsolute(pattern) || pattern.split('/').includes('..')) {
      throw new Error(`Unsupported workspace pattern: ${pattern}`);
    }
    let current = [root];
    for (const segment of pattern.split('/')) {
      const matcher = new RegExp('^' + segment.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');
      current = current.flatMap(dir => exists(dir) ? fs.readdirSync(dir, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.') && matcher.test(entry.name))
        .map(entry => path.join(dir, entry.name)) : []);
    }
    for (const dir of current) if (exists(path.join(dir, 'package.json'))) dirs.add(dir);
  }
  const packages = new Map();
  for (const dir of [...dirs].sort()) {
    const pkg = read(path.join(dir, 'package.json'));
    if (!pkg.name) throw new Error(`Package without name: ${dir}`);
    if (packages.has(pkg.name)) throw new Error(`Duplicate workspace name: ${pkg.name}`);
    packages.set(pkg.name, { name: pkg.name, dir, manifest: pkg });
  }
  return packages;
}

function configuration(root) {
  const file = path.join(root, 'logos.tasks.json');
  if (!exists(file)) throw new Error('Missing logos.tasks.json');
  const config = read(file);
  for (const key of Object.keys(config)) if (!['version', 'registry', 'tasks'].includes(key)) throw new Error(`Unknown configuration field: ${key}`);
  if (config.version !== 1 || !config.tasks || typeof config.tasks !== 'object') throw new Error('Expected version: 1 and tasks in logos.tasks.json');
  for (const [name, task] of Object.entries(config.tasks)) {
    if (!task || typeof task !== 'object' || Array.isArray(task)) throw new Error(`Invalid task: ${name}`);
    for (const key of Object.keys(task)) if (!['dependsOn', 'outputs', 'cache', 'persistent'].includes(key)) throw new Error(`Unknown task field: ${name}.${key}`);
    if (task.dependsOn !== undefined && !Array.isArray(task.dependsOn)) throw new Error(`Invalid dependsOn: ${name}`);
    for (const key of ['cache', 'persistent']) if (task[key] !== undefined && typeof task[key] !== 'boolean') throw new Error(`Invalid ${key}: ${name}`);
    outputRoots(task);
  }
  return config;
}

function outputRoots(task) {
  if (task.outputs !== undefined && !Array.isArray(task.outputs)) throw new Error('outputs must be an array');
  return (task.outputs || []).map(pattern => {
    // Narrow, explicit contract: owned directories only; never guess at Turbo glob semantics.
    if (typeof pattern !== 'string' || !/^[\w.-]+(?:\/[\w.-]+)*\/\*\*$/.test(pattern)) throw new Error(`Output must be a directory/**: ${pattern}`);
    const dir = pattern.slice(0, -3);
    if (dir.split('/').some(s => ['.', '..', 'node_modules', '.git', '.logos-task-cache'].includes(s))) throw new Error(`Unsafe output: ${pattern}`);
    return dir;
  });
}

function plan(root, taskNames, { filters = [] } = {}) {
  root = fs.realpathSync(root);
  const config = configuration(root);
  const packages = discover(root);
  const selected = filters.length ? [...packages.values()].filter(pkg => filters.includes(pkg.name) || filters.includes(slash(path.relative(root, pkg.dir)))) : [...packages.values()];
  for (const filter of filters) if (!selected.some(pkg => pkg.name === filter || slash(path.relative(root, pkg.dir)) === filter)) throw new Error(`Unknown workspace filter: ${filter}`);
  const nodes = new Map();
  const visiting = [];
  function add(pkg, taskName, required = false) {
    const id = `${pkg.name}#${taskName}`;
    if (visiting.includes(id)) throw new Error(`Task cycle: ${[...visiting, id].join(' -> ')}`);
    if (nodes.has(id)) return id;
    const rule = config.tasks[id] || config.tasks[taskName];
    if (!rule) throw new Error(`Undefined task: ${id}`);
    const script = pkg.manifest.scripts?.[taskName];
    if (required && !script) throw new Error(`Missing required script: ${id}`);
    visiting.push(id);
    const node = { id, package: pkg.name, dir: pkg.dir, task: taskName, script, rule, dependencies: [] };
    for (const raw of rule.dependsOn || []) {
      const dep = typeof raw === 'string' ? { task: raw } : raw;
      if (!dep || typeof dep.task !== 'string' || (dep.optional !== undefined && typeof dep.optional !== 'boolean') || Object.keys(dep).some(k => !['task', 'optional'].includes(k))) throw new Error(`Invalid dependency in ${id}`);
      let targets;
      let name;
      if (dep.task.startsWith('^')) {
        name = dep.task.slice(1);
        const dependencies = { ...pkg.manifest.dependencies, ...pkg.manifest.devDependencies, ...pkg.manifest.optionalDependencies };
        targets = Object.keys(dependencies).filter(key => packages.has(key)).map(key => packages.get(key));
      } else if (dep.task.includes('#')) {
        const split = dep.task.lastIndexOf('#');
        name = dep.task.slice(split + 1);
        const target = packages.get(dep.task.slice(0, split));
        if (!target && !dep.optional) throw new Error(`Missing workspace: ${dep.task}`);
        targets = target ? [target] : [];
      } else { name = dep.task; targets = [pkg]; }
      for (const target of targets) {
        if (dep.optional && !target.manifest.scripts?.[name]) continue;
        const childId = add(target, name, !dep.task.startsWith('^') && !dep.optional);
        if (nodes.get(childId).script && nodes.get(childId).rule.persistent) throw new Error(`Persistent task cannot be a dependency: ${childId}`);
        node.dependencies.push(childId);
      }
    }
    visiting.pop();
    nodes.set(id, node);
    return id;
  }
  if (!taskNames.length) throw new Error('Provide at least one task');
  for (const name of taskNames) {
    if (!config.tasks[name]) throw new Error(`Undefined task: ${name}`);
    for (const pkg of selected) if (pkg.manifest.scripts?.[name]) add(pkg, name);
  }
  if (![...nodes.values()].some(node => node.script)) throw new Error('No matching task scripts');
  return { root, config, packages, nodes };
}

function digestTree(root, ignored = new Set()) {
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  let files = 0;
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (['node_modules', '.git', '.turbo', '.logos-task-cache'].includes(entry.name)) continue;
      const file = path.join(dir, entry.name);
      if (ignored.has(file)) continue;
      const stat = fs.lstatSync(file);
      if (++files > 100000 || (bytes += stat.size) > 64 * 1024 * 1024) throw new Error('Fingerprint exceeds local cache scan budget (100000 entries / 64 MiB)');
      hash.update(JSON.stringify([slash(path.relative(root, file)), stat.mode]));
      if (entry.isSymbolicLink()) throw new Error(`Cache cannot fingerprint symlink: ${file}`);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) hash.update(crypto.createHash('sha256').update(fs.readFileSync(file)).digest());
      else throw new Error(`Cache cannot fingerprint special file: ${file}`);
    }
  }
  walk(root);
  return hash.digest('hex');
}

function registry(value = DEFAULT_REGISTRY) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Registry must be an HTTP(S) URL without embedded credentials');
  return url.href.replace(/\/$/, '');
}

function startProcess(command, args, { cwd, env, log, id }) {
  const child = spawn(command, args, { cwd, env, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) createInterface({ input: stream }).on('line', line => log(`[${id}] ${line}`));
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => code === 0 ? resolve() : reject(new Error(`${id} failed (${signal || code})`)));
  });
  return { child, done };
}

function killTree(child, signal) {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) { if (error.code !== 'ESRCH') throw error; }
}

async function run(graph, { concurrency = 4, signal, log = console.log, cache = true } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('concurrency must be a positive integer');
  const nodes = [...graph.nodes.values()];
  const persistent = nodes.filter(n => n.script && n.rule.persistent).length;
  if (persistent > concurrency || (persistent && nodes.some(n => n.script && !n.rule.persistent) && persistent >= concurrency)) throw new Error('Increase concurrency to leave room for persistent tasks and prerequisites');
  const env = { ...process.env };
  const active = new Map();
  const completed = new Set();
  const results = [];
  const cancelledChildren = new Set();
  let failure;
  let killTimer;
  function stop(error) {
    if (failure) return;
    failure = error;
    for (const proc of active.values()) { cancelledChildren.add(proc.child); killTree(proc.child, 'SIGTERM'); }
    killTimer = setTimeout(() => { for (const child of cancelledChildren) killTree(child, 'SIGKILL'); }, 1500);
  }
  const abort = () => stop(new Error('Task execution cancelled'));
  signal?.addEventListener('abort', abort, { once: true });
  const ignored = new Set();
  for (const pkg of graph.packages.values()) for (const rule of Object.values(graph.config.tasks)) for (const output of outputRoots(rule)) ignored.add(path.join(pkg.dir, output));
  const cacheDir = path.join(graph.root, '.logos-task-cache');
  function cacheState(node) {
    if (!cache || node.rule.cache !== true || node.rule.persistent || !node.rule.outputs?.length) return null;
    try {
      const inputs = digestTree(graph.root, ignored);
      const dependencyOutputs = [];
      const visited = new Set();
      function fingerprintDependencies(id) {
        if (visited.has(id)) return;
        visited.add(id);
        const dep = graph.nodes.get(id);
        for (const output of outputRoots(dep.rule)) {
          const dir = path.join(dep.dir, output);
          dependencyOutputs.push([id, output, exists(dir) ? digestTree(dir) : null]);
        }
        dep.dependencies.forEach(fingerprintDependencies);
      }
      node.dependencies.forEach(fingerprintDependencies);
      const key = crypto.createHash('sha256').update(JSON.stringify([inputs, dependencyOutputs, node.id, node.script, graph.config, env, process.version, process.platform, process.arch])).digest('hex');
      const outputs = outputRoots(node.rule).map(dir => path.join(node.dir, dir));
      const outputHash = () => outputs.map(dir => exists(dir) && fs.lstatSync(dir).isDirectory() && !fs.lstatSync(dir).isSymbolicLink() ? digestTree(dir) : null);
      return { file: path.join(cacheDir, key + '.json'), outputHash };
    } catch (error) { log(`[${node.id}] cache disabled: ${error.message}`); return null; }
  }
  async function execute(node) {
    if (!node.script) return 'virtual';
    const state = cacheState(node);
    if (state && exists(state.file)) {
      try {
        const hashes = state.outputHash();
        if (hashes.some(Boolean) && JSON.stringify(read(state.file)) === JSON.stringify(hashes)) { log(`[${node.id}] cached`); return 'cached'; }
      } catch { /* An unreadable receipt/output is a miss. */ }
    }
    log(`[${node.id}] running`);
    const proc = startProcess(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', node.task], { cwd: node.dir, env, log, id: node.id });
    active.set(node.id, proc);
    try {
      await proc.done;
      if (state && !failure) {
        try {
          const hashes = state.outputHash();
          if (hashes.some(Boolean)) {
            fs.mkdirSync(cacheDir, { recursive: true });
            const temp = `${state.file}.${crypto.randomUUID()}.tmp`;
            fs.writeFileSync(temp, JSON.stringify(hashes));
            fs.renameSync(temp, state.file);
          }
        } catch (error) { log(`[${node.id}] cache write skipped: ${error.message}`); }
      }
      return 'executed';
    } catch (error) {
      killTree(proc.child, 'SIGKILL');
      throw error;
    } finally { active.delete(node.id); }
  }
  const pending = new Map();
  try {
    if (signal?.aborted) abort();
    while (completed.size < nodes.length && !failure) {
      for (const node of nodes) {
        if (pending.size >= concurrency || failure) break;
        if (completed.has(node.id) || pending.has(node.id) || !node.dependencies.every(id => completed.has(id))) continue;
        const promise = execute(node).then(status => { completed.add(node.id); results.push({ id: node.id, status }); }, stop).finally(() => pending.delete(node.id));
        pending.set(node.id, promise);
      }
      if (!pending.size) { if (!failure) stop(new Error('Task graph made no progress')); break; }
      await Promise.race(pending.values());
    }
    await Promise.all(pending.values());
    if (failure) throw failure;
    return results;
  } finally {
    signal?.removeEventListener('abort', abort);
    clearTimeout(killTimer);
    for (const child of cancelledChildren) killTree(child, 'SIGKILL');
  }
}

module.exports = { DEFAULT_REGISTRY, findRoot, discover, configuration, plan, run, registry, startProcess, killTree };
