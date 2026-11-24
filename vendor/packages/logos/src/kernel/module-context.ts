import type { Container, LogosModule } from './container';
import type { BusHandler, SubscribeOptions } from './bus';

/** Per-entrypoint ports: shallow-frozen config and instance-local state.
 * This limits coupling, not authority of trusted in-process JavaScript. */
export interface ModuleContext {
  readonly version: 1;
  readonly identity: string;
  readonly workspace: string;
  readonly config: Readonly<Record<string, any>>;
  readonly state: Map<string, any>;
  log(message: string): void;
  on(event: string, handler: BusHandler, options?: SubscribeOptions): () => void;
  emit(event: string, payload?: any): Promise<void>;
  register(module: ModuleDeclaration): void;
}
/** Native install receives scoped ports rather than the low-level Container. */
export type ModuleDeclaration = Omit<LogosModule, 'install'> & {
  install(context: ModuleContext): void | Promise<void>;
};

/** Native entrypoints register through the same early event as workspace modules. */
export function nativeModuleContext(container: Container, identity: string, subscriptions: Set<() => void>) {
  const owner = `module:entrypoint:${identity}`;
  let registering = false;
  const context: ModuleContext = Object.freeze({
    version: 1 as const, identity, workspace: container.workspace,
    config: Object.freeze({ ...(container.config.moduleConfig?.[identity] || {}) }),
    state: container.state(`entrypoint:${identity}`),
    log: (message: string) => container.log(`[${identity}] ${message}`),
    on(event: string, handler: BusHandler, options?: SubscribeOptions) {
      const off = container.bus.on(event, handler, { ...options, owner });
      subscriptions.add(off);
      return () => { subscriptions.delete(off); off(); };
    },
    emit: (event: string, payload?: any) => container.bus.emit(event, payload),
    register(module: ModuleDeclaration) {
      if (!registering) throw new Error('[logos] native modules may register only during logos:modules:register');
      container.use({ ...module, install: () => module.install(context) }, `entrypoint:${identity}`);
    },
  });
  return {
    context,
    async collect(register: (moduleContext: typeof context) => any) {
      registering = true;
      try { await register(context); } finally { registering = false; }
    },
  };
}
