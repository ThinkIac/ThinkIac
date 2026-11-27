import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Container } from '../src/kernel/container';
import { currentAuthority, runAsPackage } from '../src/kernel/authority-context';
import { makeWorkspace } from './helpers';

function setup(prompt: any) {
  const ws = makeWorkspace('logos-event-governance-');
  ws.pkg('source', { 'package.json': JSON.stringify({ name: 'source', version: '1.0.0' }) });
  ws.pkg('target', { 'package.json': JSON.stringify({ name: 'target', version: '1.0.0' }) });
  const container = new Container({ workspace: ws.root, eventGovernance: { enabled: true, prompt } });
  return { ws, container };
}

describe('event delivery governance', () => {
  it('blocks a cross-package delivery when the user denies it', async () => {
    const { ws, container } = setup(() => 'deny');
    try {
      let calls = 0;
      runAsPackage(container.authority, 'target', () => container.bus.on('new:event', () => calls++, { owner: 'target' }));
      await runAsPackage(container.authority, 'source', () => container.bus.emit('new:event', { secret: true }));
      expect(calls).toBe(0);
    } finally { ws.cleanup(); }
  });

  it('package approval covers only the same event, recipient and operation', async () => {
    let prompts = 0;
    const { ws, container } = setup(() => { prompts++; return 'package'; });
    try {
      let calls = 0;
      runAsPackage(container.authority, 'target', () => container.bus.on('*', () => calls++, { owner: 'target' }));
      await runAsPackage(container.authority, 'source', () => container.bus.emit('new:event', {}));
      await runAsPackage(container.authority, 'source', () => container.bus.emit('new:event', {}));
      await runAsPackage(container.authority, 'source', () => container.bus.emit('other:event', {}));
      await runAsPackage(container.authority, 'source', () => container.bus.pipeline('new:event', {}));
      const request = container.eventGovernance.createRequest({
        event: 'new:event', source: 'source', sourceIntegrity: container.eventGovernance.integrityFor('source'),
        target: 'other-target', operation: 'emit', payload: {}, flowId: null,
      });
      expect(await container.eventGovernance.authorize(request)).toBe(true);
      expect({ calls, prompts }).toEqual({ calls: 4, prompts: 4 });
      expect(container.eventGovernance.verify(container.eventGovernance.list()[0] as any)).toBe(true);
    } finally { ws.cleanup(); }
  });

  it('flow approval accepts the same origin only in that flow', async () => {
    let prompts = 0;
    const { ws, container } = setup(() => { prompts++; return 'flow'; });
    try {
      let calls = 0;
      runAsPackage(container.authority, 'target', () => container.bus.on('*', () => calls++, { owner: 'target' }));
      await runAsPackage(container.authority, 'source', () => container.bus.emit('a', {}, { flowId: 'f1' }));
      await runAsPackage(container.authority, 'source', () => container.bus.emit('a', {}, { flowId: 'f1' }));
      await runAsPackage(container.authority, 'source', () => container.bus.emit('a', {}, { flowId: 'f2' }));
      expect({ calls, prompts }).toEqual({ calls: 3, prompts: 2 });
      expect(container.eventGovernance.endFlow('f1')).toBe(1);
    } finally { ws.cleanup(); }
  });

  it('same-package and system deliveries never prompt', async () => {
    let prompts = 0;
    const { ws, container } = setup(() => { prompts++; return 'deny'; });
    try {
      let calls = 0;
      runAsPackage(container.authority, 'source', () => container.bus.on('self', () => calls++, { owner: 'source' }));
      await runAsPackage(container.authority, 'source', () => container.bus.emit('self'));
      expect({ calls, prompts }).toEqual({ calls: 1, prompts: 0 });
    } finally { ws.cleanup(); }
  });

  it('asks again after the source identity changes and after revocation', async () => {
    let prompts = 0;
    const { ws, container } = setup(() => { prompts++; return 'package'; });
    try {
      runAsPackage(container.authority, 'target', () => container.bus.on('*', () => {}, { owner: 'target' }));
      await runAsPackage(container.authority, 'source', () => container.bus.emit('a', {}));
      expect(container.eventGovernance.revoke(container.eventGovernance.list()[0].receiptId)).toBe(true);
      await runAsPackage(container.authority, 'source', () => container.bus.emit('a', {}));
      fs.writeFileSync(path.join(ws.root, 'source', 'package.json'), JSON.stringify({ name: 'source', version: '2.0.0' }));
      await runAsPackage(container.authority, 'source', () => container.bus.emit('a', {}));
      expect(prompts).toBe(3);
    } finally { ws.cleanup(); }
  });
});

it('requires approval for the original caller on a nested asynchronous delivery', async () => {
  const decisions: string[] = [];
  const { ws, container } = setup((request: { source: string; target: string }) => {
    const edge = request.source + '->' + request.target;
    decisions.push(edge);
    return edge === 'source->downstream' ? 'deny' : 'package';
  });
  try {
    const isText = (value: unknown): value is string => typeof value === 'string';
    const contract = { input: isText, output: isText };
    container.bus.provide('downstream::read:secret', contract, () => 'secret', { owner: 'downstream' });
    container.bus.provide('target::read:proxy', contract, async text => {
      await Promise.resolve();
      return await container.bus.request('downstream::read:secret', text, {
        flowId: 'claimed-flow',
      }) as string;
    }, { owner: 'target' });
    await expect(runAsPackage(container.authority, 'source', () =>
      container.bus.request('target::read:proxy', 'claimed-system-origin')))
      .rejects.toMatchObject({ code: 'EVENT_REQUEST_DENIED' });
    expect(decisions).toEqual(['source->target', 'target->downstream', 'source->downstream']);
    await expect(runAsPackage(container.authority, 'target', () =>
      container.bus.request('downstream::read:secret', 'direct'))).resolves.toBe('secret');
  } finally { ws.cleanup(); }
});

it('binds delegated approvals to the immutable host delivery chain', async () => {
  const requests: import('../src/kernel/event-governance').EventDeliveryRequest[] = [];
  let approveDelegation = false;
  const { ws, container } = setup((request: typeof requests[number]) => {
    requests.push(request);
    return request.delegation && !approveDelegation ? 'deny' : 'package';
  });
  const isText = (value: unknown): value is string => typeof value === 'string';
  const contract = { input: isText, output: isText };
  const event = 'downstream::response:read';
  const proxy = 'target::response:forward';
  let delivered = 0;
  try {
    container.bus.provide(event, contract, value => { delivered++; return value; }, { owner: 'downstream' });
    container.bus.provide(proxy, contract, async value => {
      await Promise.resolve();
      const [frame] = currentAuthority().delegation;
      expect(frame.caller).toEqual({ kind: 'package', id: 'source' });
      expect(frame.provider).toEqual({ kind: 'package', id: 'target' });
      expect(Object.isFrozen(frame)).toBe(true);
      expect(Object.isFrozen(currentAuthority().delegation)).toBe(true);
      return await container.bus.request(event, value, {
        flowId: 'untrusted-flow',
      }) as string;
    }, { owner: 'target' });
    const call = (source: string, resource: string) => runAsPackage(container.authority, source,
      () => container.bus.request(resource, JSON.stringify({ caller: 'system', delegation: [] })));
    await call('target', event);
    await call('source', event);
    await expect(call('source', proxy)).rejects.toMatchObject({ code: 'EVENT_REQUEST_DENIED' });
    expect(delivered).toBe(2);
    approveDelegation = true;
    await call('source', proxy);
    const promptCount = requests.length;
    await call('source', proxy);
    expect(requests).toHaveLength(promptCount);
    expect(requests.filter(request => request.delegation).map(request => [
      request.source, request.flowId, request.delegation?.[0].event,
    ])).toEqual([['target', null, proxy], ['target', null, proxy], ['source', null, proxy]]);
    expect(container.eventGovernance.list().filter(receipt => receipt.receiptVersion === 3)).toHaveLength(2);
    expect(delivered).toBe(4);
  } finally { ws.cleanup(); }
});

it('checks upstream strict request authority when delivery governance is disabled', async () => {
  const ws = makeWorkspace('logos-delegated-strict-');
  const proxy = 'target::response:forward';
  const event = 'downstream::response:read';
  try {
    ws.pkg('source', { 'package.json': JSON.stringify({
      name: 'source',
      $: [proxy],
      runtime: { contractVersion: 1, mode: 'strict' },
    }) });
    const container = new Container({ workspace: ws.root });
    const isText = (value: unknown): value is string => typeof value === 'string';
    const contract = { input: isText, output: isText };
    const downstream = () => { throw new Error('Unauthorized provider entry'); };
    container.bus.provide(event, contract, downstream, { owner: 'downstream' });
    container.bus.provide(proxy, contract, async value => await container.bus.request(event, value) as string,
      { owner: 'target' });
    await expect(runAsPackage(container.authority, 'source', () => container.bus.request(proxy, 'check')))
      .rejects.toMatchObject({ code: 'AUTHORITY_DENIED', decision: { caller: 'source', resource: event } });
  } finally { ws.cleanup(); }
});

const isolationProvider = process.env.LOGOS_TEST_ISOLATION_PROVIDER;
it.skipIf(!isolationProvider)('checks the original caller on events sent back by an isolated provider', async () => {
  const requests: import('../src/kernel/event-governance').EventDeliveryRequest[] = [];
  const { ws, container } = setup((request: typeof requests[number]) => {
    requests.push(request);
    return request.source === 'source' && request.target === 'downstream' ? 'deny' : 'package';
  });
  const { provideIsolation } = require(isolationProvider!);
  const isolation = provideIsolation({ authority: { runAsPackage } });
  const event = 'downstream::notice:received';
  const proxy = 'target::response:forward';
  ws.pkg('target', {
    'index.js': `
      const { emit } = require('logos');
      exports.forward = async function (text) {
        /** @register_tool forward */
        await Promise.resolve();
        await emit('${event}', { text, caller: 'system', delegation: [] });
        return text;
      };
    `,
  });
  const pkg = { folder: 'target', dir: path.join(ws.root, 'target'), isolated: true };
  try {
    const runner = await isolation.api.isolatedRunnerFor(container, pkg);
    const handler = runner.surfaces.tools[0].id;
    const isText = (value: unknown): value is string => typeof value === 'string';
    container.bus.provide(proxy, { input: isText, output: isText },
      text => runner.invoke(handler, [text]), { owner: 'target' });
    const delivered: string[] = [];
    container.bus.on(event, payload => delivered.push(payload.text), { owner: 'downstream' });

    await runAsPackage(container.authority, 'source', () => container.bus.request(proxy, 'delegated'));
    expect(delivered).toEqual([]);
    expect(requests.filter(request => request.event === event).map(request => [
      request.source, request.target, request.delegation?.[0].caller.id,
    ])).toEqual([
      ['target', 'downstream', 'source'],
      ['source', 'downstream', 'source'],
    ]);

    await runAsPackage(container.authority, 'target', () => runner.invoke(handler, ['direct']));
    expect(delivered).toEqual(['direct']);
  } finally {
    await isolation.api.stopIsolatedRunner(container, 'target', 'test complete');
    ws.cleanup();
  }
});
