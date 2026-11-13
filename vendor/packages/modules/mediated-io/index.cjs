'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

class ResourceBoundaryError extends Error {
  constructor(message) { super(message); this.name = 'ResourceBoundaryError'; this.code = 'RESOURCE_BOUNDARY_DENIED'; }
}
class ProcessBoundaryError extends Error {
  constructor(message) { super(message); this.name = 'ProcessBoundaryError'; this.code = 'PROCESS_BOUNDARY_DENIED'; }
}
function relativeResource(input) {
  if (typeof input !== 'string' || !input || path.isAbsolute(input) || input.includes('\0')) throw new ResourceBoundaryError('Path must be a non-empty package-relative path');
  const normalized = input.replace(/\\/g, '/');
  if (normalized.split('/').includes('..')) throw new ResourceBoundaryError('Path traversal is not allowed');
  const clean = path.posix.normalize(normalized).replace(/^\.\//, '');
  if (!clean || clean.startsWith('../')) throw new ResourceBoundaryError('Path escapes the package');
  return clean;
}
function inside(root, candidate) { const relative = path.relative(root, candidate); return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)); }
function nearestExisting(input) {
  let current = input;
  while (!fs.existsSync(current)) { const parent = path.dirname(current); if (parent === current) throw new ResourceBoundaryError('No existing parent for path'); current = parent; }
  return fs.realpathSync(current);
}
class PackageFiles {
  constructor(host, owner) { this.host = host; this.owner = owner; }
  resolve(input, operation) {
    const resource = relativeResource(input); this.host.enforce(this.owner, 'filesystem', operation, resource);
    const packageRoot = fs.realpathSync(this.host.packageRoot(this.owner)); const lexical = path.resolve(packageRoot, resource);
    if (!inside(packageRoot, lexical)) throw new ResourceBoundaryError('Path escapes the package');
    const grant = this.host.grantsFor(this.owner).files.find(item => (resource === item.root || resource.startsWith(`${item.root}/`)) && (operation === 'read' ? item.access !== 'write' : item.access !== 'read'));
    if (!grant) throw new ResourceBoundaryError('No matching filesystem root');
    const realRoot = nearestExisting(path.resolve(packageRoot, grant.root));
    if (!inside(packageRoot, realRoot)) throw new ResourceBoundaryError('Granted root resolves outside the package');
    const realTarget = operation === 'read' || fs.existsSync(lexical) ? fs.realpathSync(lexical) : nearestExisting(path.dirname(lexical));
    if (!inside(realRoot, realTarget)) throw new ResourceBoundaryError('Resolved path escapes the granted root');
    return lexical;
  }
  async readFile(input, options) { return fs.promises.readFile(this.resolve(input, 'read'), options); }
  async readdir(input, options) { return fs.promises.readdir(this.resolve(input, 'read'), options); }
  async writeFile(input, data, options) { return fs.promises.writeFile(this.resolve(input, 'write'), data, options); }
  async mkdir(input, options) { return fs.promises.mkdir(this.resolve(input, 'write'), options); }
}
class SecretHandle {
  #resolve;
  constructor(name, resolve) { this.name = name; this.#resolve = resolve; Object.freeze(this); }
  async withValue(consumer) { if (typeof consumer !== 'function') throw new TypeError('Secret consumer must be a function'); return consumer(await this.#resolve()); }
  toString() { return '[REDACTED]'; }
  toJSON() { return '[REDACTED]'; }
}
class PackageSecrets {
  constructor(host, owner) { this.host = host; this.owner = owner; }
  get(name) { this.host.enforce(this.owner, 'secrets', 'read', name); return new SecretHandle(name, () => this.host.resolveSecret(name, this.owner)); }
}
class PackageNetwork {
  constructor(host, owner) { this.host = host; this.owner = owner; }
  async fetch(input, init = {}) {
    let url = new URL(input.toString()); if (url.username || url.password) throw new ResourceBoundaryError('Credentials in network URLs are not allowed');
    const method = String(init.method || 'GET').toUpperCase(); const fetcher = this.host.fetch || globalThis.fetch;
    if (typeof fetcher !== 'function') throw new Error('No fetch implementation is available');
    for (let redirects = 0; redirects <= 10; redirects += 1) {
      this.host.enforce(this.owner, 'network', 'request', url.origin, { method, redirect: redirects > 0 });
      const response = await fetcher(url, { ...init, method, redirect: 'manual' });
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers.get('location'); if (!location) return response;
      url = new URL(location, url); if (url.username || url.password) throw new ResourceBoundaryError('Credentials in redirect URLs are not allowed');
    }
    throw new ResourceBoundaryError('Network redirect limit exceeded');
  }
}
function argsMatch(pattern, args) { return pattern.length === args.length && pattern.every((value, index) => value === '*' || value === args[index]); }
function cwdMatch(roots, cwd) { return roots.some(root => cwd === root || cwd.startsWith(`${root}/`)); }
class PackageProcess {
  constructor(host, owner) { this.host = host; this.owner = owner; }
  spawn(executable, args = [], options = {}) {
    this.host.enforce(this.owner, 'process', 'spawn', executable);
    if (options.shell) throw new ProcessBoundaryError('Shell execution is not allowed');
    if (args.some(arg => typeof arg !== 'string' || arg.includes('\0'))) throw new ProcessBoundaryError('Process arguments must be safe strings');
    const cwd = relativeResource(options.cwd || '.'); const env = options.env || {};
    const grant = this.host.grantsFor(this.owner).process.find(item => item.executable === executable && argsMatch(item.args, args) && cwdMatch(item.cwd, cwd) && Object.keys(env).every(key => item.env.includes(key)));
    if (!grant) throw new ProcessBoundaryError('Executable, arguments, cwd or environment are outside the declared process grant');
    const packageRoot = fs.realpathSync(this.host.packageRoot(this.owner)); const lexicalCwd = path.resolve(packageRoot, cwd); const cwdRoot = grant.cwd.find(root => cwd === root || cwd.startsWith(`${root}/`));
    if (!cwdRoot) throw new ProcessBoundaryError('Process cwd is outside the declared roots');
    const realCwdRoot = nearestExisting(path.resolve(packageRoot, cwdRoot)); const realCwd = fs.realpathSync(lexicalCwd);
    if (!inside(packageRoot, realCwdRoot) || !inside(realCwdRoot, realCwd)) throw new ProcessBoundaryError('Resolved process cwd escapes the package grant');
    const child = spawn(executable, args, { ...options, cwd: lexicalCwd, env: { ...env }, shell: false }); const scope = this.host.activeScope(this.owner);
    if (!scope) { child.kill(); throw new ProcessBoundaryError('Package process requires an active EffectScope'); }
    this.host.trackProcess(scope, child, path.basename(executable)); return child;
  }
}
module.exports = { PackageFiles, PackageNetwork, PackageProcess, PackageSecrets, ProcessBoundaryError, ResourceBoundaryError, SecretHandle };
