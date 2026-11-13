<script context="module">
  // Por que este componente existe
  // ------------------------------
  // As views de pacote rodam dentro de um iframe (ver views/lib/theme.js em
  // qualquer pacote). Iframe sem a flag `allow-modals` bloqueia
  // window.confirm()/alert()/prompt() SILENCIOSAMENTE: a chamada retorna
  // imediatamente — confirm() devolve false, prompt() devolve null — sem
  // exibir nada e sem erro no console. O sintoma é o pior possível: o botão
  // "não faz nada" ao clicar.
  //
  // Foi esse bug que deixou Publicar/Descartar/Remover do wordpress-builder
  // aparentemente travados.
  //
  // Uso, no script da view:
  //
  //   import Dialogs, { askConfirm, askPrompt, askAlert }
  //     from './components/Dialogs.svelte';
  //
  //   async function remover() {
  //     if (!await askConfirm('Remover a lista?')) return;
  //     ...
  //   }
  //
  // e no markup, uma vez por view (costuma ficar no fim):  <Dialogs />
  //
  // As funções são de módulo (não props), então qualquer função da view chama
  // direto, sem prop drilling — o componente só precisa estar montado.

  import { writable } from 'svelte/store';

  const REQUEST = 'thinkiac:dialog:request';
  const RESPONSE = 'thinkiac:dialog:response';
  const REMOTE_TIMEOUT_MS = 60_000;

  // Fila: uma confirmação disparada enquanto outra está aberta espera a vez,
  // em vez de sobrescrever o estado e deixar a primeira Promise pendurada
  // para sempre.
  const queue = writable([]);

  function push(request) {
    return new Promise((resolve) => {
      const id = request.id || `local:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      queue.update((q) => [...q, { ...request, id, resolve }]);
    });
  }

  function resolveRequest(id, value) {
    queue.update((q) => {
      const index = q.findIndex((item) => item.id === id);
      const request = q[index];
      request?.resolve(value);
      return index < 0 ? q : [...q.slice(0, index), ...q.slice(index + 1)];
    });
  }

  function resolveTop(value) {
    const top = queuedTop;
    if (top) resolveRequest(top.id, value);
  }

  // Mantém uma referência simples para o resolvedor, sem expor a store para
  // callers. Ela também permite remover da fila um pedido remoto que expirou.
  let queuedTop = null;
  queue.subscribe((items) => { queuedTop = items[0] || null; });

  function fallbackFor(kind) {
    return kind === 'prompt' ? null : kind === 'confirm' ? false : undefined;
  }

  // O módulo pode ser avaliado pelo renderer SSR: todo acesso ao browser fica
  // dentro desta função, chamada somente por uma interação no cliente.
  function askRemote(request) {
    if (typeof window === 'undefined' || window.parent === window) return null;
    const id = `dialog:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve) => {
      const finish = (value) => {
        clearTimeout(timeout);
        window.removeEventListener('message', receive);
        resolve(value);
      };
      const receive = (event) => {
        if (event.source !== window.parent || event.data?.type !== RESPONSE || event.data?.id !== id) return;
        finish(event.data.value);
      };
      const timeout = setTimeout(() => finish(fallbackFor(request.kind)), REMOTE_TIMEOUT_MS);
      window.addEventListener('message', receive);
      window.parent.postMessage({ type: REQUEST, id, request }, '*');
    });
  }

  function ask(request) {
    // Helpers podem ser importadas em código compartilhado pelo SSR. Não há
    // host nem DOM naquele ambiente: devolva o mesmo resultado de cancelamento
    // do navegador em vez de criar uma Promise que jamais poderá ser resolvida.
    if (typeof window === 'undefined') return Promise.resolve(fallbackFor(request.kind));
    const remote = askRemote(request);
    return remote || push(request);
  }

  /** Confirmação sim/não. Resolve para boolean. */
  export function askConfirm(message, options = {}) {
    return ask({
      kind: 'confirm',
      message,
      title: options.title || null,
      confirmLabel: options.confirmLabel || 'Confirmar',
      cancelLabel: options.cancelLabel || 'Cancelar',
      danger: !!options.danger,
    });
  }

  /** Entrada de texto. Resolve para a string, ou null se cancelado. */
  export function askPrompt(message, defaultValue = '', options = {}) {
    return ask({
      kind: 'prompt',
      message,
      value: defaultValue ?? '',
      title: options.title || null,
      placeholder: options.placeholder || '',
      confirmLabel: options.confirmLabel || 'OK',
      cancelLabel: options.cancelLabel || 'Cancelar',
      // `selectOnly` deixa o texto só para leitura/cópia — usado no lugar de
      // prompt() quando o objetivo era "mostre isto para eu copiar".
      selectOnly: !!options.selectOnly,
    });
  }

  /** Aviso de um botão só. Resolve quando fechado. */
  export function askAlert(message, options = {}) {
    return ask({
      kind: 'alert',
      message,
      title: options.title || null,
      confirmLabel: options.confirmLabel || 'OK',
    });
  }
</script>

<script>
  import { onMount, tick } from 'svelte';

  export let host = false;

  $: current = $queue[0] || null;

  let inputEl = null;
  let draft = '';
  let lastShown = null;

  // Ao abrir um prompt novo, semeia o rascunho e foca. A comparação por
  // referência evita reescrever o que o usuário está digitando a cada
  // re-render do store.
  $: if (current !== lastShown) {
    lastShown = current;
    draft = current?.kind === 'prompt' ? (current.value ?? '') : '';
    if (current?.kind === 'prompt') {
      tick().then(() => {
        inputEl?.focus();
        if (current?.selectOnly) inputEl?.select();
      });
    }
  }

  function cancel() {
    // prompt cancelado devolve null (igual ao nativo); confirm devolve false.
    resolveTop(current?.kind === 'prompt' ? null : false);
  }

  function accept() {
    if (!current) return;
    if (current.kind === 'prompt') resolveTop(draft);
    else resolveTop(true);
  }

  function onKeydown(event) {
    if (!current) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    } else if (event.key === 'Enter' && current.kind !== 'prompt') {
      event.preventDefault();
      accept();
    }
  }

  onMount(() => {
    if (!host) return;
    const pending = new Map();
    const isChildFrame = (source) => [...document.querySelectorAll('iframe')]
      .some((frame) => frame.contentWindow === source);
    const respond = (source, origin, id, value) => {
      try { source.focus?.(); } catch {}
      try { source.postMessage({ type: RESPONSE, id, value }, origin || '*'); } catch {}
    };
    const receive = (event) => {
      const { data } = event;
      if (data?.type !== REQUEST || !data.id || !data.request || !isChildFrame(event.source)) return;
      const request = data.request;
      if (!['confirm', 'prompt', 'alert'].includes(request.kind)) return;
      const queueId = `remote:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      const timeout = setTimeout(
        () => resolveRequest(queueId, fallbackFor(request.kind)),
        REMOTE_TIMEOUT_MS,
      );
      pending.set(queueId, () => resolveRequest(queueId, fallbackFor(request.kind)));
      push({ ...request, id: queueId }).then((value) => {
        clearTimeout(timeout);
        pending.delete(queueId);
        respond(event.source, event.origin, data.id, value);
      });
    };
    // Ao desmontar um host (ou uma janela filha), nenhum caller fica pendurado.
    window.addEventListener('message', receive);
    return () => {
      window.removeEventListener('message', receive);
      for (const cancel of pending.values()) cancel();
    };
  });
</script>

<svelte:window on:keydown={onKeydown} />

{#if current}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <div
    class="dlg-backdrop"
    role="presentation"
    on:click={cancel}
  >
    <div
      class="dlg-card"
      role="dialog"
      aria-modal="true"
      aria-label={current.title || current.message}
      on:click|stopPropagation
    >
      {#if current.title}
        <h3 class="dlg-title">{current.title}</h3>
      {/if}
      <p class="dlg-message">{current.message}</p>

      {#if current.kind === 'prompt'}
        <!-- svelte-ignore a11y-autofocus -->
        <input
          class="dlg-input"
          bind:this={inputEl}
          bind:value={draft}
          placeholder={current.placeholder}
          readonly={current.selectOnly}
          on:keydown|stopPropagation={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); accept(); }
            if (e.key === 'Escape') { e.preventDefault(); cancel(); }
          }}
        />
      {/if}

      <div class="dlg-actions">
        {#if current.kind !== 'alert'}
          <button class="dlg-btn dlg-ghost" on:click={cancel}>{current.cancelLabel}</button>
        {/if}
        <button
          class="dlg-btn dlg-primary"
          class:dlg-danger={current.danger}
          on:click={accept}
        >{current.confirmLabel}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Mesmas variáveis --tk-* das views embedadas, então o modal acompanha o
     tema do pacote sem configuração. */
  .dlg-backdrop {
    position: fixed; inset: 0; background: color-mix(in srgb, var(--tk-bg) 70%, transparent);
    display: flex; align-items: center; justify-content: center;
    z-index: 1100; padding: 20px;
  }
  .dlg-card {
    background: var(--tk-surface);
    color: var(--tk-text);
    border: 1px solid var(--tk-border-hi);
    border-radius: var(--tk-radius-lg);
    padding: 20px; max-width: 380px; width: 100%;
    box-shadow: 0 2px 8px rgba(0, 0, 0, .08);
  }
  .dlg-title { margin: 0 0 8px; font-size: 15px; font-weight: 600; }
  .dlg-message { margin: 0 0 16px; font-size: 14px; line-height: 1.5; white-space: pre-wrap; }
  .dlg-input {
    width: 100%; box-sizing: border-box; margin: 0 0 16px;
    padding: 8px 10px; font: inherit;
    color: var(--tk-text);
    background: var(--tk-bg);
    border: 1px solid var(--tk-border);
    border-radius: var(--tk-radius-md);
  }
  .dlg-actions { display: flex; justify-content: flex-end; gap: 8px; }
  .dlg-btn {
    padding: 7px 14px; font: inherit; cursor: pointer;
    border-radius: var(--tk-radius-md);
    border: 1px solid var(--tk-border);
    background: transparent; color: inherit;
  }
  .dlg-ghost:hover { background: var(--tk-surface-2); }
  .dlg-primary {
    background: var(--tk-accent);
    border-color: var(--tk-accent);
    color: var(--tk-on-accent);
    font-weight: 600;
  }
  .dlg-danger {
    background: var(--tk-text);
    border-color: var(--tk-text);
    color: var(--tk-bg);
  }
</style>
