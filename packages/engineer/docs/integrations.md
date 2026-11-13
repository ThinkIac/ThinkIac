# Integrações de UI e Aurora

Leia este índice antes de implementar algo que apareça no chat, no sidebar, no
composer, abaixo de mensagens ou que precise falar com o shell Aurora. O contrato
é a documentação; uma implementação existente é a referência executável. Não
edite `MessageList` ou outros componentes do shell para registrar um pacote antes
de verificar a extensão declarativa correspondente.

| Intenção | Leia primeiro | Contrato | Referência executável |
|---|---|---|---|
| Widget inline em bloco Markdown | `packages/aurora/docs/package-widgets-and-ui-bus.md` | `manifest.widget` | `packages/governance-widget/package.json` e `packages/aurora/views/lib/widget_bootstrap.js` |
| Item/painel no sidebar | `packages/aurora/views/lib/menu_bootstrap.js` | `manifest.menu` | `packages/claude/package.json` e `packages/ntfy/package.json` |
| Ação sob uma mensagem | `packages/aurora/docs/package-widgets-and-ui-bus.md` | `manifest.messageActions`, endpoint `POST` e `GET /<pacote>/status` | `packages/aurora/views/lib/message_actions.js` (única implementação executável do contrato; nenhum pacote declara `messageActions` hoje) |
| Evento entre iframe e shell | `packages/aurora/docs/package-widgets-and-ui-bus.md` | `parent.postMessage({ source: 'aurora', type, detail }, '*')` | `packages/aurora/views/lib/bus.js` |
| Evento entre frontend e backend | `packages/aurora/docs/package-widgets-and-ui-bus.md` e docs do Lógos descobertos no `AGENT.md` | `logos:<namespace>:<ação>` + hook | `packages/aurora/views/chatSocket.js` e `packages/aurora/core/chat_bus.js` |
| Extensão opcional entre pacotes | `packages/aurora/docs/package-widgets-and-ui-bus.md` | `manifest.slots`, nome `<host>.<ponto>` | `packages/gmail-bridge/package.json` e `packages/email-manager/views/Home.svelte` |
| View normal de pacote | `views.md` e `AGENTS.md` | Svelte 4, tema `--tk-*` | uma view do mesmo pacote ou `packages/terminal/views/Index.svelte` fora do shell |

## Checklist: widget inline no chat

1. Declare `manifest.widget` no `package.json`; selecione `view` quando a view
   não for a principal do pacote. Não registre manualmente em `MessageList`.
2. Crie a view indicada e leia `source` de `location.hash`, conforme o documento
   Aurora. Trate payload ausente ou inválido sem quebrar o iframe.
3. Depois de montar e após mudanças de layout, envie `widget:height`. Respeite o
   limite visual do host — o shell limita a altura a 2000 px.
4. Para falar com o shell, envie `postMessage` com `source: 'aurora'`; o `type`
   é o evento e `detail` é o payload. Use `logos:` para eventos que também devem
   chegar ao backend.
5. Teste `/apps/list`, o bloco Markdown, o resize do iframe e os dois sentidos
   do bus quando aplicável.

## Checklist: contribuição ao sidebar ou às mensagens

1. Declare `manifest.menu` ou `manifest.messageActions` no pacote; não adicione
   condicionais no shell Aurora.
2. Para menu, use a URL de view publicada pelo runtime — o bootstrap já resolve
   a view configurada por `manifest.menu.view`.
3. Para ações de mensagem, implemente o endpoint e o status exigidos pelo
   contrato; emita `message-actions:refresh` pelo bus ao mudar a disponibilidade.
4. Confirme a descoberta pelo `/apps/list` e teste o slot no estado em que a
   contribuição deve aparecer.

## Separação de responsabilidades

- **Lógos** define infraestrutura: rotas, tools, eventos, hooks, banco e APIs.
  Resolva e leia a documentação ativa com os comandos do `AGENT.md`.
- **Aurora** define encaixes visuais: widgets, sidebar, ações de mensagem e UI
  bus. Leia o contrato indicado nesta página e respeite o manifesto do pacote.
