import type { Container } from './container';
import { runAsPackage, runAsSystem } from './authority-context';
import { externalApi } from './external-modules';
import { callPackageEvent } from './package-event-calls';

const { PackageFiles, PackageNetwork, PackageProcess, PackageSecrets } = require('@thinkiac/module-mediated-io');

export class PackageContext {
  readonly package: string;

  readonly events: {
    call: (event: string, payload?: any, ctx?: any) => Promise<any>;
    publish: (event: string, payload?: any, ctx?: any) => Promise<void>;
    subscribe: (event: string, handler: any, options?: any) => () => void;
    transform: (event: string, handler: any, options?: any) => () => void;
    veto: (event: string, handler: any, options?: any) => () => void;
    request: (event: string, payload?: any, ctx?: any) => Promise<any>;
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

  readonly files: any;
  readonly secrets: any;
  readonly network: any;
  readonly process: any;

  constructor(private container: Container, packageName: string) {
    this.package = packageName;
    const owned = (operation: 'subscribe' | 'transform' | 'veto', event: string, handler: any, options: any = {}) =>
      runAsPackage(this.container.authority, this.package, () =>
        this.container.bus.on(event, handler, { ...options, owner: this.package, operation }));

    this.events = Object.freeze({
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
    const ioHost = {
      enforce: (owner: string, surface: any, operation: any, resource: string, metadata?: Record<string, any>) => this.container.authority.enforce({ principal: { kind: 'package', id: owner }, surface, operation, resource, metadata }),
      grantsFor: (owner: string) => this.container.authority.grantsFor(owner),
      packageRoot: (owner: string) => this.container.registry.getPackage(owner).dir,
      resolveSecret: async (name: string, owner: string) => { const configured = this.container.config?.authority?.secrets; if (typeof configured === 'function') return configured(name, owner); if (configured && Object.prototype.hasOwnProperty.call(configured, name)) return configured[name]; throw new Error(`Secret handle is unavailable: ${name}`); },
      fetch: this.container.config?.authority?.fetch,
      activeScope: (owner: string) => this.container.getPackageScope(owner),
      trackProcess: (scope: any, child: any, label: string) => scope.defer(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); }, { kind: 'child-process', label, pid: child.pid }),
    };
    this.files = new PackageFiles(ioHost, this.package); this.secrets = new PackageSecrets(ioHost, this.package); this.network = new PackageNetwork(ioHost, this.package); this.process = new PackageProcess(ioHost, this.package);
  }
}
