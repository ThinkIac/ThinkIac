'use strict';

// Runtime-process capability.  Bridge ownership and cleanup live here rather
// than in the Logos kernel; the host provides only bus, state and scopes.
const path = require('node:path');
const { ProcessBridge } = require('@thinkiac/module-process-bridge');

class ProcBridge extends ProcessBridge {
  constructor(host, opts) {
    let self;
    super({
      name: opts.name, cwd: opts.dir, runtime: opts.runtime, main: opts.main,
      onRegister: patterns => patterns.forEach(pattern => self.subscribe(pattern)),
      onEmit: (event, payload) => host.emit(event, payload),
      onLog: (message, kind) => kind === 'stderr' ? process.stderr.write(`[proc:${opts.name}] ${message}`) : host.log(`[proc] "${opts.name}" ${message}`),
      onError: error => host.log(`[proc] ${opts.name}: ${error.message}`),
      onExit: ({ code, signal }) => {
        host.emit('proc:crashed', { module: opts.name, code });
        const supervisor = host.process.supervisor();
        if (!supervisor) return false;
        void supervisor.scheduleProc(opts.folder || opts.name, async () => {
          if (self.stopped) return { ok: false, error: 'Bridge stopped' };
          self.start(); return { health: 'unknown' };
        }, { code, signal });
        return true;
      },
    });
    self = this; this.host = host; this.folder = opts.folder || opts.name;
    this.scope = opts.scope; this.unsubscribes = [];
    for (const pattern of opts.events || [`${opts.name}:*`]) this.subscribe(pattern);
  }
  subscribe(pattern) {
    const off = this.host.on(pattern, payload => this.call(pattern, payload), { owner: `proc:${this.name}`, priority: 100, scope: this.scope });
    this.unsubscribes.push(off);
  }
  stop() { this.host.process.supervisor()?.cancel(this.folder); for (const off of this.unsubscribes) off(); super.stop(); }
}

function createRuntimeModule(host) {
  const start = pkg => {
    const rt = pkg.runtime || {}; if (!rt.runtime || rt.runtime === 'node') return null;
    const scope = host.process.getScope(pkg.folder) || host.process.createScope(pkg.folder, String(Date.now()));
    const bridge = new ProcBridge(host, { folder: pkg.folder, name: rt.name || pkg.folder, dir: pkg.dir, runtime: rt.runtime, main: path.join(pkg.dir, rt.main || 'main.py'), events: rt.events || [`${rt.name || pkg.folder}:*`], scope });
    bridge.start(); scope.defer(() => bridge.stop(), { kind: 'process', label: rt.name || pkg.folder });
    host.state('proc').set(pkg.folder, bridge); return bridge;
  };
  const stop = async folder => { const bridge = host.state('proc').get(folder); if (bridge) { bridge.stop(); host.state('proc').delete(folder); } await host.process.disposeScope(folder, 'process_module_stopped'); };
  return { name: 'proc', phase: 'wire', api: { start, stop }, install() {} };
}
module.exports = { createRuntimeModule };
