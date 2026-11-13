import { describe, expect, it } from 'vitest';
import {
  ServiceAmbiguityError,
  ServiceCycleError,
  ServiceGraph,
  ServiceUnavailableError,
  satisfiesServiceVersion,
} from '../src/kernel/services';
import { Container } from '../src/kernel/container';
import { makeWorkspace } from './helpers';

describe('service version matching', () => {
  it('supports exact, major, caret and tilde requirements', () => {
    expect(satisfiesServiceVersion('1.4.2', '1.x')).toBe(true);
    expect(satisfiesServiceVersion('2.0.0', '1.x')).toBe(false);
    expect(satisfiesServiceVersion('1.4.2', '^1.2.0')).toBe(true);
    expect(satisfiesServiceVersion('2.0.0', '^1.2.0')).toBe(false);
    expect(satisfiesServiceVersion('1.4.2', '~1.4.0')).toBe(true);
    expect(satisfiesServiceVersion('1.5.0', '~1.4.0')).toBe(false);
  });
});

describe('ServiceGraph', () => {
  it('resolves one compatible provider and injects its bound value', () => {
    const graph = new ServiceGraph();
    graph.configureOwner('ntfy', { provides: { 'notifications.push': '1.3.0' } });
    graph.configureOwner('agenda', {
      requires: { 'notifications.push': { range: '1.x', optional: false } },
    });
    const service = { send: () => 'sent' };
    graph.bind('ntfy', 'notifications.push', service);

    expect(graph.resolve('agenda', 'notifications.push')).toMatchObject({
      status: 'resolved', provider: 'ntfy', version: '1.3.0', value: service,
    });
    expect(graph.inject('agenda', 'notifications.push')).toBe(service);
  });

  it('requires explicit selection when compatible providers are ambiguous', () => {
    const graph = new ServiceGraph();
    graph.configureOwner('ntfy', { provides: { 'notifications.push': '1.1.0' } });
    graph.configureOwner('hermes', { provides: { 'notifications.push': '1.2.0' } });
    graph.configureOwner('agenda', { requires: { 'notifications.push': '1.x' } });
    graph.bind('ntfy', 'notifications.push', { provider: 'ntfy' });
    graph.bind('hermes', 'notifications.push', { provider: 'hermes' });

    expect(() => graph.inject('agenda', 'notifications.push')).toThrow(ServiceAmbiguityError);
    graph.select('notifications.push', 'hermes');
    expect(graph.inject<any>('agenda', 'notifications.push').provider).toBe('hermes');
  });

  it('honors a consumer-specific provider selection and optional dependencies', () => {
    const graph = new ServiceGraph();
    graph.configureOwner('ntfy', { provides: { 'notifications.push': '1.0.0' } });
    graph.configureOwner('hermes', { provides: { 'notifications.push': '1.0.0' } });
    graph.configureOwner('agenda', {
      requires: {
        'notifications.push': { range: '1.x', optional: false, provider: 'ntfy' },
        'scriba.llm': { range: '1.x', optional: true },
      },
    });
    graph.bind('ntfy', 'notifications.push', 'ntfy-value');
    graph.bind('hermes', 'notifications.push', 'hermes-value');

    expect(graph.inject('agenda', 'notifications.push')).toBe('ntfy-value');
    expect(graph.inject('agenda', 'scriba.llm')).toBeUndefined();
    expect(() => graph.inject('unknown', 'notifications.push')).toThrow(ServiceUnavailableError);
  });

  it('detects dependency cycles with the complete owner path', () => {
    const graph = new ServiceGraph();
    graph.configureOwner('alpha', { provides: { 'service.alpha': '1.0.0' }, requires: { 'service.beta': '1.x' } });
    graph.configureOwner('beta', { provides: { 'service.beta': '1.0.0' }, requires: { 'service.alpha': '1.x' } });

    expect(() => graph.assertAcyclic()).toThrow(ServiceCycleError);
    try {
      graph.assertAcyclic();
    } catch (error) {
      expect((error as ServiceCycleError).cycle).toEqual(['alpha', 'beta', 'alpha']);
    }
  });

  it('returns immutable, implementation-free inventory snapshots', () => {
    const graph = new ServiceGraph();
    graph.configureOwner('ntfy', { provides: { 'notifications.push': '1.0.0' } });
    graph.bind('ntfy', 'notifications.push', { secret: 'not-in-snapshot' });
    const snapshot = graph.snapshot();

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot.providers[0]).toEqual({ service: 'notifications.push', version: '1.0.0', owner: 'ntfy', bound: true });
    expect(JSON.stringify(snapshot)).not.toContain('not-in-snapshot');
  });

  it('is shared by Container and its attributed PackageContext facade', () => {
    const ws = makeWorkspace('logos-services-context-');
    try {
      const container = new Container({
        workspace: ws.root,
        services: { selections: { 'notifications.push': 'ntfy' } },
      });
      container.services.configureOwner('ntfy', { provides: { 'notifications.push': '1.0.0' } });
      container.services.configureOwner('agenda', { requires: { 'notifications.push': '1.x' } });
      const release = container.packageContext('ntfy').services.provide('notifications.push', 'live');

      expect(container.packageContext('agenda').services.use('notifications.push')).toBe('live');
      release();
      expect(() => container.packageContext('agenda').services.use('notifications.push')).toThrow(ServiceUnavailableError);
    } finally {
      ws.cleanup();
    }
  });
});
