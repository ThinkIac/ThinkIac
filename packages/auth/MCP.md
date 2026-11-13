# MCP HTTP autenticado

O transporte HTTP do Lógos agora exige uma credencial MCP própria em todas as
rotas. O padrão é `127.0.0.1:3333`. Configuração do host em `index.js`:
`MCP_PORT`, `MCP_HOST` e `MCP_ALLOW_REMOTE=1` para autorizar bind externo.
Para acesso remoto, termine TLS em um proxy e restrinja o acesso à porta interna.

## Emitir e revogar

Uma sessão de navegador de administrador, sem delegação, pode usar:

- `POST /auth/mcp/credentials`: emite uma credencial e mostra o segredo uma vez.
- `GET /auth/mcp/credentials`: lista metadados, nunca hashes ou segredos.
- `DELETE /auth/mcp/credentials/:id`: revoga imediatamente.

Exemplo de corpo de emissão (o usuário atual é o padrão):

```json
{
  "scopes": ["mcp:connect", "mcp:tools:read", "mcp:tool:agenda.list_events"],
  "ttlMs": 86400000,
  "maxRequestsPerMinute": 120
}
```

O nome da tool no exemplo é ilustrativo: use o nome qualificado real
`<pacote>.<tool>` do catálogo/implementação instalada. O escopo `mcp:admin`
autoriza todas as tools acessíveis ao usuário; não é concedido por padrão.
`mcp:connect` e `mcp:tools:read` são permissões separadas e explícitas.
A validade máxima é 30 dias. Não há credencial padrão ou migração automática
para um token com permissões administrativas.

O Auth resolve o usuário canônico em cada requisição, verifica confirmação de
email, estado da conta e tenant. A autorização por pacote reutiliza os
entitlements e `pathBelongsToApp` do accessGate; administradores mantêm sua
exceção existente. Tokens npm, de billing, LLM e da ponte Aurora não autenticam
MCP. Os hashes ficam em `.private/auth-mcp/credentials.json`, com modo 0600,
fora dos diretórios públicos. Revogação e emissão usam escrita atômica no host;
essa store atende um runtime por instalação, não múltiplos escritores em hosts
diferentes. Inclua o diretório privado na política de backup do host.

## Migrar clientes

Defina `THINKIAC_MCP_TOKEN` no ambiente do cliente, com a credencial emitida.
Opcionalmente defina `AURORA_MCP_HTTP_URL`; o padrão é `http://127.0.0.1:3333`.
O proxy stdio `packages/agent/llm/mcp_server.js` e `think agent:tools:list` /
`think agent:tools:call` usam o cliente compartilhado `mcp_http_client.js`.
Claude Code e Codex continuam falando stdio com esse proxy. Os processos novos
precisam herdar o token; os processos já abertos precisam ser relançados.

O cliente HTTP direto segue esta sequência:

1. Enviar `Authorization: Bearer <token>` em todas as requisições.
2. `POST /mcp/session` com `{}` retorna `sessionId` opaco e `expiresAt`.
3. `GET /mcp/tools` retorna só tools permitidas por escopo e condição.
4. `POST /mcp/call` com `{ "name": "nome", "args": {} }` e header
   `mcp-session-id: <sessionId>` executa pelo executor governado existente.
5. Para retomar aprovação, repetir os mesmos argumentos com `decisionId` no
   corpo após a decisão humana. O transporte não aprova ações.

A sessão é vinculada à credencial, ao principal e ao tenant e dura no máximo uma
hora ou a validade restante do token. Reiniciar o servidor invalida as sessões.
O cliente compartilhado recria a sessão somente em `INVALID_SESSION`, que é
emitido antes da execução. Ele não repete chamadas após falhas genéricas.

`x-session-id`, `x-aurora-session-id`, `x-logos-session-id` e IDs no corpo não
provam identidade nem selecionam a sessão de governança. A sessão MCP tem seu
próprio ID; `AURORA_SESSION_ID` continua reservado ao canal de mensagens do
chat. Políticas de uma conversa não são transferidas por um header livre.

## Operação e validação

Status: 401 para identidade/sessão inválida; 403 para escopo/política; 409 para
aprovação pendente; 429 para taxa/capacidade; 503 para política indisponível.
O rate limit usa o IP do socket, sem confiar em `X-Forwarded-For`, e a credencial.
Há limites de memória para janelas e sessões. Atrás de proxy, o limite de IP é
compartilhado pelos clientes; dimensione-o ao configurar o transporte.

A auditoria diária em `.private/auth-mcp/audit-AAAA-MM-DD.jsonl` contém IDs,
operação, ferramenta conhecida, resultado HTTP e correlação. Não contém
argumentos, headers, tokens, corpos ou mensagens de erro de ferramentas.
Configure retenção desses arquivos conforme a operação do host. Falha de escrita
na auditoria gera aviso no logger; autenticação/autorização falham fechadas.

A implementação altera o Lógos resolvido por `require.resolve('logos/package.json')`,
atualmente `../../packages/logos`, e não a cópia de referência `open-source/logos`.
Compile esse pacote antes de reiniciar o runtime. Nenhum reinício é feito pelos
testes. Faça a emissão/configuração dos tokens antes de relançar os clientes.

Compatibilidade validada: MCP em processo, descoberta dinâmica/hot reload,
`tool:call`, condições, middlewares, autoridade, veto e retomada por aprovação.
A quebra intencional é o fim do acesso HTTP anônimo e das sessões escolhidas pelo
cliente. Contratos consultados: Engineer routes/tools/events/integrations/database;
Lógos authority/modules/events; implementações `mcp.ts`, `tools.ts`, Auth e proxy
stdio existentes. Testes novos cobrem autenticação, escopos, expiração, revogação,
vínculo da sessão, taxa, auditoria e migração do cliente.
