import assert from 'node:assert/strict';
import test from 'node:test';
import { retryTurnInput } from '../../shell/views/lib/retry-turn.js';

test('retry recupera o pedido do botão clicado e preserva anexos', () => {
    const attachments = [{ url: '/uploads/example.png', name: 'example.png' }];
    const history = [
        { role: 'user', content: 'Leia a imagem', attachments },
        { role: 'assistant', timedOut: true },
        { role: 'user', content: 'Outro pedido' },
        { role: 'assistant', content: 'Resposta' },
    ];
    assert.deepEqual(retryTurnInput(history, 1), { text: 'Leia a imagem', attachments, retry: true });
    assert.equal(retryTurnInput(history, 3), null);
    assert.equal(retryTurnInput(history, -1), null);
});

test('retry aceita pedido apenas com anexo e ignora fila', () => {
    const attachments = [{ url: '/uploads/example.png' }];
    assert.deepEqual(retryTurnInput([
        { role: 'user', content: '', attachments },
        { role: 'user', content: 'fila', queued: true },
        { role: 'assistant', timedOut: true },
    ], 2), { text: '', attachments, retry: true });
});
