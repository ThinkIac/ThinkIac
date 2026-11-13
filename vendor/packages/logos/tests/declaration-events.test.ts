import { expect, it } from 'vitest';
import { Container } from '../src/kernel/container';
import { emitPackageDeclarations } from '../src/kernel/declaration-events';
import { makeWorkspace } from './helpers';

it('delivers metadata and the associated callable to a type listener', async () => {
  const workspace = makeWorkspace();
  try {
    const dir = workspace.pkg('example', {
      'handler.js': 'exports.action = function action(value) { /**\n * @register fulano abc\n * @option value\n */ return value * 2; };',
    });
    const container = new Container({ workspace: workspace.root });
    let received: any;
    container.bus.on('register:fulano', payload => { received = payload; });
    await emitPackageDeclarations(container, { folder: dir });
    expect(received.declaration).toMatchObject({ type: 'fulano', name: 'abc', tags: { option: ['value'] } });
    expect(JSON.parse(JSON.stringify(received.declaration))).toEqual(received.declaration);
    expect(await received.handler(21)).toBe(42);
  } finally { workspace.cleanup(); }
});
