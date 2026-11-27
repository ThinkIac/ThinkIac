import { expect, it } from 'vitest';
import { runAsPackage } from '../src/kernel/authority-context';
import { Container } from '../src/kernel/container';
import { emitPackageDeclarations, preparePackageResources } from '../src/kernel/declaration-events';
import { makeWorkspace } from './helpers';

it('runs typed prompt extensions in order and replaces them transactionally', async () => {
  const ws = makeWorkspace();
  let denyTransform = false;
  const c = new Container({ workspace: ws.root, eventGovernance: {
    enabled: true,
    prompt: (delivery: { operation: string }) =>
      denyTransform && delivery.operation === 'extension-transform' ? 'deny' : 'once',
  } });
  const target = 'agent::response:compose';
  const agent = ws.pkg('agent', {
    'package.json': '{"name":"agent"}',
    'prompt.type': [
      'response compose = (message: string, suffix: string = "!"): string? ->',
      '  @extensions before',
      '  @extensions transform',
      '  @extensions after',
      '  message + suffix',
    ].join('\n'),
  });
  const extension = (transform: string) => ws.pkg('plugin', {
    'package.json': '{"name":"plugin"}',
    'hooks.type': [
      'extensionHook inspect = before agent::response:compose ({message}, ctx) ->',
      '  throw new Error("invalid host context") unless message is "hello" and ctx.event is "agent::response:compose" and ctx.flowId is "trace"',
      '  "ignored before"',
      'extensionHook customize = transform agent::response:compose ({result}) -> ' + transform,
      'extensionHook finish = after agent::response:compose ({result}) ->',
      '  throw new Error("invalid result") unless result in ["HELLO!", "hello!", null]',
      '  "ignored after"',
    ].join('\n'),
  });
  const pkg = { folder: 'plugin', dir: extension('result.toUpperCase()') };
  try {
    await emitPackageDeclarations(c, { folder: 'agent', dir: agent });
    await emitPackageDeclarations(c, pkg);
    const request = (payload: unknown) => c.bus.request(target, payload, { flowId: 'trace' });
    await expect(request({ message: 'hello' })).resolves.toBe('HELLO!');
    denyTransform = true;
    await expect(runAsPackage(c.authority, 'plugin', () => request({ message: 'hello' }))).resolves.toBe('hello!');
    denyTransform = false;
    await expect(request({ message: 'hello', flowId: 'forged' })).rejects.toMatchObject({ code: 'EVENT_REQUEST_INVALID_INPUT' });

    extension('null');
    const candidate = await preparePackageResources(c, pkg);
    await candidate.commit();
    await expect(request({ message: 'hello' })).resolves.toBeNull();
    await candidate.rollback();
    await expect(request({ message: 'hello' })).resolves.toBe('HELLO!');

    extension('throw new Error("hook failed")');
    await emitPackageDeclarations(c, pkg);
    await expect(request({ message: 'hello' })).rejects.toThrow('hook failed');

    extension('12');
    await emitPackageDeclarations(c, pkg);
    await expect(request({ message: 'hello' })).rejects.toMatchObject({ code: 'EVENT_REQUEST_INVALID_OUTPUT' });
    await emitPackageDeclarations(c, { ...pkg, dir: ws.pkg('plugin', { 'hooks.type': '' }) });
    await expect(request({ message: 'hello' })).resolves.toBe('hello!');
  } finally {
    await c.closeModules();
    ws.cleanup();
  }
});
