// src/app.ts — the LogosApp class.
//
// Some integrations construct the runtime as an object instead of calling
// bootstrap() directly. LogosApp wraps bootstrap() and keeps a small
// setup()/listen() lifecycle for that style.

'use strict';

import { bootstrap } from './index';
import type { BootstrapConfig, LogosInstance } from './types';

export class LogosApp {
  config: BootstrapConfig;
  instance: LogosInstance | null = null;

  constructor(config: BootstrapConfig = {}) {
    this.config = config;
  }

  /** Boots the runtime. Returns the express app. */
  async setup(): Promise<any> {
    this.instance = await bootstrap(this.config);
    return this.instance.app;
  }

  /** Boots if needed and returns the running instance. */
  async listen(port?: number): Promise<LogosInstance> {
    if (!this.instance) {
      this.instance = await bootstrap({ ...this.config, port: port ?? this.config.port });
    }
    return this.instance;
  }

  get app() { return this.instance?.app ?? null; }
  get server() { return this.instance?.server ?? null; }

  async close() { await this.instance?.close(); }
}

export default LogosApp;
