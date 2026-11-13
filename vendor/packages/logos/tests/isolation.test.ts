// tests/isolation.test.ts — pacotes críticos e a guarda de reset global.
//
// A regra: recarregar UM pacote é isolado (staging.ts já faz isso). Reiniciar
// o PROCESSO não é — mata o estado vivo de todo mundo. Então um reset global
// só passa quando ninguém está pendurado num pacote crítico, ou quando o
// humano insiste com `force`.

import { describe, it, expect } from 'vitest';
import {
  packageIsolation, criticalPackages, rebootImpact, requestReboot, isCritical, stopPackage,
} from '../src/stabilizer/isolation';
const { WsHub } = require('../../modules/websocket');

/** Container mínimo com hub de WS real e um registry de mentira. */
function fakeContainer(packages: any[], sessions: string[] = []) {
  const hub = new WsHub();
  for (const id of sessions) hub.connections.set(id, new Set([{ readyState: 1 }]));

  const state = new Map<string, Map<string, any>>();
  const container: any = {
    state(ns: string) {
      if (!state.has(ns)) state.set(ns, new Map());
      return state.get(ns)!;
    },
    registry: {
      discover: () => packages,
      getPackage: (folder: string) => packages.find(p => p.folder === folder) ?? { folder },
      states: new Map<string, string>(),
      setState(folder: string, state: string) { this.states.set(folder, state); },
    },
    log: () => {},
    emitted: [] as any[],
    bus: {
      vetoResult: { allowed: true },
      veto: async () => container.bus.vetoResult,
      emit: async (event: string, payload: any) => { container.emitted.push({ event, payload }); },
    },
  };
  container.state('ws').set('hub', hub);
  return container;
}

const terminal = {
  folder: 'terminal',
  runtime: { isolation: { critical: true, reason: 'sessões ao vivo' } },
};
const comum = { folder: 'notas' };

describe('packageIsolation', () => {
  it('só é crítico com critical === true explícito', () => {
    expect(packageIsolation(terminal)).toEqual({ critical: true, reason: 'sessões ao vivo' });
    expect(packageIsolation(comum).critical).toBe(false);
    expect(packageIsolation({ runtime: { isolation: { critical: 'sim' } } }).critical).toBe(false);
    expect(packageIsolation(undefined).critical).toBe(false);
  });

  it('isCritical lê pelo folder', () => {
    const container = fakeContainer([terminal, comum]);
    expect(isCritical(container, 'terminal')).toBe(true);
    expect(isCritical(container, 'notas')).toBe(false);
  });
});

describe('rebootImpact', () => {
  it('lista os críticos e ignora as sessões internas do runtime', () => {
    const container = fakeContainer([terminal, comum], ['views-hmr', 'default', 'sessao-do-vitor']);
    const impact = rebootImpact(container);
    expect(impact.critical).toEqual([{ pkg: 'terminal', reason: 'sessões ao vivo' }]);
    expect(impact.liveSessions).toEqual(['sessao-do-vitor']);
  });

  it('workspace sem pacote crítico não tem impacto declarado', () => {
    expect(rebootImpact(fakeContainer([comum], ['sessao'])).critical).toEqual([]);
  });
});

describe('requestReboot', () => {
  it('barra quando há pacote crítico E sessão viva', async () => {
    const verdict = await requestReboot(fakeContainer([terminal], ['sessao-do-vitor']));
    expect(verdict.allowed).toBe(false);
    expect(verdict.blockedBy).toContain('terminal');
    expect(verdict.blockedBy).toContain('force');
  });

  it('libera quando o pacote crítico não tem ninguém pendurado', async () => {
    const verdict = await requestReboot(fakeContainer([terminal], ['views-hmr']));
    expect(verdict.allowed).toBe(true);
    expect(verdict.forced).toBe(false);
  });

  it('libera quando ninguém se declarou crítico', async () => {
    expect((await requestReboot(fakeContainer([comum], ['sessao']))).allowed).toBe(true);
  });

  it('force passa por cima, mas o impacto continua visível para quem avisa', async () => {
    const verdict = await requestReboot(fakeContainer([terminal], ['sessao']), { force: true });
    expect(verdict.allowed).toBe(true);
    expect(verdict.forced).toBe(true);
    expect(verdict.impact.liveSessions).toEqual(['sessao']);
  });

  it('um pacote pode vetar por conta própria', async () => {
    const container = fakeContainer([comum], []);
    container.bus.vetoResult = { allowed: false, by: 'deploy-guard' };
    const verdict = await requestReboot(container);
    expect(verdict.allowed).toBe(false);
    expect(verdict.blockedBy).toBe('deploy-guard');
  });

  it('force também vence o veto de pacote', async () => {
    const container = fakeContainer([comum], []);
    container.bus.vetoResult = { allowed: false, by: 'deploy-guard' };
    expect((await requestReboot(container, { force: true })).allowed).toBe(true);
  });
});

// Parar UM pacote é o que substitui o reset global: o processo (e todo o resto)
// fica de pé; só as rotas e os streams daquele pacote saem do ar.
describe('stopPackage', () => {
  function comRouter(container: any, folder: string) {
    const router = { stack: [{ route: '/x' }] };
    container.state('routers').set(folder, router);
    return router;
  }

  it('esvazia as rotas, solta os streams e marca o pacote como parado', async () => {
    const container = fakeContainer([comum]);
    const router = comRouter(container, 'notas');
    const hub = container.state('ws').get('hub');
    hub.onMessage('notas', () => {}, { owner: 'notas' });

    const result = await stopPackage(container, 'notas');

    expect(result).toMatchObject({ ok: true, pkg: 'notas', handlersDropped: 1 });
    expect(router.stack).toEqual([]);
    expect(hub.handlerCount('notas')).toBe(0);
    expect(container.registry.states.get('notas')).toBe('stopped');
    expect(container.emitted.map((e: any) => e.event)).toContain('package:stopped');
  });

  it('recusa parar um pacote crítico sem force', async () => {
    const container = fakeContainer([terminal]);
    const router = comRouter(container, 'terminal');

    const result = await stopPackage(container, 'terminal');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('force');
    expect(router.stack).toHaveLength(1);       // nada foi tocado
    expect(container.registry.states.get('terminal')).toBeUndefined();
  });

  it('com force, o pacote crítico também para', async () => {
    const container = fakeContainer([terminal]);
    const router = comRouter(container, 'terminal');

    expect((await stopPackage(container, 'terminal', { force: true })).ok).toBe(true);
    expect(router.stack).toEqual([]);
  });

  it('parar um pacote não encosta nos outros', async () => {
    const container = fakeContainer([comum, { folder: 'agenda' }]);
    const notas = comRouter(container, 'notas');
    const agenda = comRouter(container, 'agenda');
    const hub = container.state('ws').get('hub');
    hub.onMessage('agenda', () => {}, { owner: 'agenda' });

    await stopPackage(container, 'notas');

    expect(notas.stack).toEqual([]);
    expect(agenda.stack).toHaveLength(1);
    expect(hub.handlerCount('agenda')).toBe(1);
  });
});
