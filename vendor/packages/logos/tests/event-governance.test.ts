import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Container } from '../src/kernel/container';
import { runAsPackage } from '../src/kernel/authority-context';
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

  it('package approval covers future events from the same package and is integrity-bound', async () => {
    let prompts = 0;
    const { ws, container } = setup(() => { prompts++; return 'package'; });
    try {
      let calls = 0;
      runAsPackage(container.authority, 'target', () => container.bus.on('*', () => calls++, { owner: 'target' }));
      for (const event of ['new:event', 'other:event']) await runAsPackage(container.authority, 'source', () => container.bus.emit(event, {}));
      expect({ calls, prompts }).toEqual({ calls: 2, prompts: 1 });
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
      await runAsPackage(container.authority, 'source', () => container.bus.emit('b', {}, { flowId: 'f1' }));
      await runAsPackage(container.authority, 'source', () => container.bus.emit('c', {}, { flowId: 'f2' }));
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
      await runAsPackage(container.authority, 'source', () => container.bus.emit('b', {}));
      fs.writeFileSync(path.join(ws.root, 'source', 'package.json'), JSON.stringify({ name: 'source', version: '2.0.0' }));
      await runAsPackage(container.authority, 'source', () => container.bus.emit('c', {}));
      expect(prompts).toBe(3);
    } finally { ws.cleanup(); }
  });
});
