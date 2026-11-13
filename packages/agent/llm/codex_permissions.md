# Codex: sandbox e aprovação

O provider usa `codex app-server` para receber e responder pedidos de aprovação
nativos. O contrato de resposta do Agent, progresso, modelo, conta e MCP são
preservados. Consumidores diretos de `buildArgs` sem `transport: 'app-server'`
ainda recebem argumentos de `exec`; a execução pelo Agent usa App Server.

`cliOpts` da chamada sobrepõe `pool.cli`. Os valores explícitos de `sandbox` e
`approval_policy` prevalecem. Sem sandbox explícito, `auto` resolve para
`workspace-write`. Uma política salva de sessão `semi/read_only` resolve para
`read-only`; o preset inativo de uma sessão `auto` não restringe o sandbox.
`workspace-write` e `danger-full-access` explícitos nunca são convertidos.

Aprovação: `auto`, `manual`, `semi`, `interactive` → `on-request`;
`allow`/`off` → `never`. Uma `approval_policy` explícita pode ser `on-request`,
`never` ou os aliases legados `untrusted` e `on-failure`, normalizados para
`on-request`, pois o Codex instalado não aceita mais esses dois valores.
Em `on-request`, o modelo decide quando solicitar aprovação nativa; a
classificação semântica das tools do Runtime continua sendo feita no MCP.
Valores inválidos geram erro em vez de uma conversão silenciosa.

Os argumentos do processo incluem `-c sandbox_mode=...`,
`-c approval_policy=...`, `-c approvals_reviewer="user"`, raízes adicionais e,
quando configurado para workspace-write, `network_access`. Não registre o argv
inteiro: a configuração MCP também contém credenciais. O workspace selecionado
é o `cwd` real do processo. `add_dirs` continua autorizando raízes adicionais.

Pedidos nativos de comando, alteração de arquivo ou permissões são registrados
em `pending_permissions`, publicados como `permission_request` e resolvidos pelo
mesmo fluxo de Aprovar/Negar do Runtime. Sem sessão, em cancelamento, falha de
publicação ou timeout da aprovação, a resposta é negativa. A espera pela pessoa
não consome o timeout de execução do subprocesso. O Runtime recebe contexto da
ação; aprovações não criam regras permanentes no Codex.

Edição nativa funciona nos limites do sandbox; MCP permanece disponível para
as operações próprias do Runtime, autenticado e com sessão emitida pelo servidor.
O erro de listagem MCP mantém as tools de sessão e não referencia mais uma
variável inexistente.

## Verificação

Testes rápidos: `node --test llm/codex_workspace.test.js
llm/codex_approval.test.js llm/codex_app_server.test.js
llm/mcp_server.integration.test.js` (uma única linha).

Teste real, opt-in, com Codex autenticado:
`AGENT_CODEX_LIVE_TEST=1 node --test llm/codex_live.test.js`.
Cria diretórios temporários no diretório atual e os remove ao final. Verifica
criação e edição pelo provider, limites dos três sandboxes, diretórios extras e
um pedido nativo atendido pelo registro Runtime. Apenas a aprovação da escrita
de prova é resolvida automaticamente pelo fixture de teste.

Referência do protocolo: https://developers.openai.com/codex/app-server
