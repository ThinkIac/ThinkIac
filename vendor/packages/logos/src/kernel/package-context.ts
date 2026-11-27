import type { ExtensionPhase, RequestContext, RequestContract, RequestOptions } from './bus';
import type { Container } from './container';
import { runAsPackage, runAsSystem } from './authority-context';
import { externalApi } from './external-modules';
import { callPackageEvent, requestPackageResponse } from './package-event-calls';

export class PackageContext {
  readonly package: string;

  readonly events: {
    call: (event: string, payload?: any, ctx?: any) => Promise<any>;
    publish: (event: string, payload?: any, ctx?: any) => Promise<void>;
    subscribe: (event: string, handler: any, options?: any) => () => void;
    transform: (event: string, handler: any, options?: any) => () => void;
    veto: (event: string, handler: any, options?: any) => () => void;
    request: (event: string, payload?: any, ctx?: any) => Promise<any>;
    hook: (event: string, phase: ExtensionPhase, handler: (payload: unknown, context: RequestContext) => unknown,
      priority?: number) => () => void;
    requestResponse: (event: string, payload: unknown, options?: RequestOptions) => Promise<unknown>;
    provideResponse: <Input, Output>(
      event: string,
      contract: RequestContract<Input, Output>,
      handler: (payload: Input, context: RequestContext) => Output | Promise<Output>,
    ) => () => void;
  };

  readonly tools: {
    invoke: (qualifiedName: string, args?: any, ctx?: any) => Promise<any>;
  };

  readonly db: {
    self: () => any;
    use: (tenant: string) => any;
  };

  readonly services: {
    use: <T = unknown>(service: string) => T | undefined;
    provide: <T>(service: string, value: T) => () => void;
  };

  private readonly ioHost: any;
  private readonly ioInstances = new Map<string, any>();
  private io(name: string) {
    if (!this.ioInstances.has(name)) {
      const Provider = require('@thinkiac/module-mediated-io')[name];
      this.ioInstances.set(name, new Provider(this.ioHost, this.package));
    }
    return this.ioInstances.get(name);
  }
  get files(): any { return this.io('PackageFiles'); }
  get secrets(): any { return this.io('PackageSecrets'); }
  get network(): any { return this.io('PackageNetwork'); }
  get process(): any { return this.io('PackageProcess'); }

  constructor(private container: Container, packageName: string) {
    this.package = packageName;
    const owned = (operation: 'subscribe' | 'transform' | 'veto', event: string, handler: any, options: any = {}) =>
      runAsPackage(this.container.authority, this.package, () =>
        this.container.bus.on(event, handler, { ...options, owner: this.package, operation }));

    const provideResponse: PackageContext['events']['provideResponse'] = (event, contract, handler) => {
      const name = (this.container.registry.getActiveContract(this.package)?.contract.package.name
        ?? this.package);
      if (!event.startsWith(`${name}::`)) throw new TypeError(`Provider must use the ${name}:: namespace`);
      return runAsPackage(this.container.authority, this.package, () =>
        this.container.bus.provide(event, contract, handler, {
          scope: this.container.getPackageScope(this.package),
          owner: this.package,
        }));
    };
    this.events = Object.freeze({
      provideResponse,
      hook: (event: string, phase: ExtensionPhase, handler: (payload: unknown, context: RequestContext) => unknown,
        priority?: number) => runAsPackage(this.container.authority, this.package, () =>
        this.container.bus.hook(event, phase, handler, {
          owner: this.package, scope: this.container.getPackageScope(this.package), priority,
        })),
      requestResponse: (event: string, payload: unknown, options?: RequestOptions) =>
        runAsPackage(this.container.authority, this.package, () => requestPackageResponse(this.container, event, payload, options)),
      call: (event: string, payload?: any, ctx?: any) =>
        runAsPackage(this.container.authority, this.package, () =>
          callPackageEvent(this.container, event, payload, ctx)),
      publish: (event: string, payload?: any, ctx?: any) =>
        runAsPackage(this.container.authority, this.package, () => this.container.bus.emit(event, payload, ctx)),
      subscribe: (event: string, handler: any, options?: any) => owned('subscribe', event, handler, options),
      transform: (event: string, handler: any, options?: any) => owned('transform', event, handler, options),
      veto: (event: string, handler: any, options?: any) => owned('veto', event, handler, options),
      request: (event: string, payload?: any, ctx?: any) =>
        runAsPackage(this.container.authority, this.package, () => this.container.bus.pipeline(event, payload, ctx, 'request')),
    });

    this.tools = Object.freeze({
      invoke: (qualifiedName: string, args: any = {}, ctx?: any) => {
        const separator = qualifiedName.indexOf('.');
        if (separator < 1 || separator === qualifiedName.length - 1) {
          throw new TypeError('Tool identity must be qualified as package.tool');
        }
        const targetPackage = qualifiedName.slice(0, separator);
        const tool = qualifiedName.slice(separator + 1);
        runAsPackage(this.container.authority, this.package, () =>
          this.container.authority.enforce({
            principal: { kind: 'package', id: this.package },
            surface: 'tools', operation: 'invoke', resource: qualifiedName,
          }));
        return runAsSystem(this.container.authority, () =>
          this.container.bus.pipeline('tool:call', { package: targetPackage, tool, args }, ctx));
      },
    });

    this.db = Object.freeze({
      self: () => runAsPackage(this.container.authority, this.package, () => externalApi<any>(this.container, 'db').getProxy(this.package)),
      use: (tenant: string) => runAsPackage(this.container.authority, this.package, () => externalApi<any>(this.container, 'db').getProxy(tenant)),
    });

    this.services = Object.freeze({
      use: <T = unknown>(service: string) => this.container.services.inject<T>(this.package, service),
      provide: <T>(service: string, value: T) => this.container.services.bind(this.package, service, value),
    });
    this.ioHost = {
      enforce: (owner: string, surface: any, operation: any, resource: string, metadata?: Record<string, any>) => this.container.authority.enforce({ principal: { kind: 'package', id: owner }, surface, operation, resource, metadata }),
      grantsFor: (owner: string) => this.container.authority.grantsFor(owner),
      packageRoot: (owner: string) => this.container.registry.getPackage(owner).dir,
      resolveSecret: async (name: string, owner: string) => { const configured = this.container.config?.authority?.secrets; if (typeof configured === 'function') return configured(name, owner); if (configured && Object.prototype.hasOwnProperty.call(configured, name)) return configured[name]; throw new Error(`Secret handle is unavailable: ${name}`); },
      fetch: this.container.config?.authority?.fetch,
      activeScope: (owner: string) => this.container.getPackageScope(owner),
      trackProcess: (scope: any, child: any, label: string) => scope.defer(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); }, { kind: 'child-process', label, pid: child.pid }),
    };
  }
}
