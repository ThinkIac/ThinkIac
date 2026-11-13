import test from 'node:test';
import assert from 'node:assert/strict';
import { installGracefulShutdown } from '../lib/runtime-lifecycle.js';

test('dispatches shutdown only after a real termination signal, and only once', async () => {
  const handlers = new Map();
  const signals = [];
  const exits = [];
  const processLike = {
    once(signal, handler) { handlers.set(signal, handler); },
    exit(code) { exits.push(code); },
  };

  installGracefulShutdown({
    processLike,
    dispatch: async (event) => signals.push(event),
    logger: { error() {} },
  });

  assert.deepEqual(signals, []);
  await handlers.get('SIGTERM')();
  await handlers.get('SIGINT')();

  assert.deepEqual(signals, ['shutdown']);
  assert.deepEqual(exits, [0]);
});
