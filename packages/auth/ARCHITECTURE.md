# Auth: evolução incremental

O Auth continua sendo a autoridade de usuários, sessões, credenciais e permissões.
O schema, os endpoints, os comandos locais e os hooks existentes são contratos de
compatibilidade. Esta etapa separa responsabilidades sem trocar armazenamento,
framework, política de autorização ou protocolo de autenticação.

## Eventos antes de integrações específicas

Pacotes podem consultar identidade e autorização pelo bus do Lógos, sem conhecer
as rotas administrativas ou acessar diretamente as tabelas do Auth:

```js
const principal = await dispatchEvent('auth:resolve-principal', { req });
const decision = await dispatchEvent('auth:check-permission', {
    req,
    permission: 'example.resource.read',
    resourceId: 'resource-id',
});
if (!decision?.allowed) return { status: decision?.status || 403 };
```

`events.js` registra esses hooks. Ambos resolvem uma sessão válida usando o mesmo
IdentityProvider do HTTP. Um `context.req`, quando presente, prevalece sobre
`payload.req`. Um objeto `user` ou `principal` informado no payload não autentica
ninguém. A consulta de identidade retorna apenas o principal, sem o registro de
sessão ou senha. A consulta de permissão usa o resolver canônico de grupos,
grants, recursos e negações. Sessões delegadas não podem usar a consulta genérica
para ampliar suas capabilities de rota; essa consulta retorna 403. Esses eventos são internos ao Runtime; não são novas
rotas públicas nem autorizam operações locais de administração.

Os hooks genéricos de identidade, credenciais e boot permanecem. Hooks de
provisionamento e recuperação de ativação foram removidos. Não há eventos de mutação de usuários:
os comandos locais continuam protegidos pela fronteira de acesso ao host.

## Componentes

| Arquivo | Responsabilidade |
| --- | --- |
| `events.js` | Adaptadores de consulta no bus do Lógos |
| `services/identity.js` | Resolução de sessão, principal e projeção do usuário |
| `services/credentials.js` | Verificação de proxy tokens, escopos, limites e gasto |
| `services/local-users.js` | Bootstrap administrativo e gestão local de usuários |
| `services/login-throttle.js` | Limite por origem e interpretação de proxy confiável |
| `services/permissions.js` | Grupos, memberships, grants e auditoria administrativa |
| `services/registry-devices.js` | Workspace npm, tokens e pareamento de dispositivos |
| `services/browser-sessions.js` | Criação e encerramento da sessão e atributos do cookie |
| `services/google-auth.js` | OAuth Google, PKCE, callback, limpeza e emissão de deep link |
| `services/login-tickets.js` | Troca de ticket de login por sessão e redirect seguro |
| `services/access-gate.js` | Política explícita do portão HTTP, views e delegação |
| `services/account-policy.js` | Contas descontinuadas e entitlements de apps |
| `services/password-login.js` | Login por senha, limites por conta e logout |
| `services/delegated-sessions.js` | Emissão e troca de tickets delegados |
| `services/user-administration.js` | Operações administrativas de usuários |
| `services/administration-ui.js` | Surface System e despacho de ações aguardando o resultado |
| `services/mcp-administration.js` | Credenciais MCP e autorização administrativa |
| `services/lifecycle.js` | Boot, verificação de credenciais e consulta de identidade |
| `services/app-entry.js`, `services/onboarding.js` | Entrada de apps e preferências de onboarding |
| `services/google-provider.js` | Composição OAuth com políticas explícitas |
| `adapters/` | Registros HTTP, hooks e comandos, separados por área |
| `runtime/config.js` | Carregamento local da configuração, inclusive em importação direta |
| `index.js` | Fronteira pública de composição e exports de compatibilidade |

Os serviços não importam o entrypoint. O scanner do Lógos percorre subdiretórios,
portanto os serviços não possuem anotações de registro. As rotas e hooks legados
mantêm adaptadores em `adapters/`; cada operação é registrada uma única vez.
Caches de limite continuam em memória por processo, com as mesmas janelas.

## Remoção dos fluxos de produto

A continuação da issue #28 remove explicitamente do Auth o cadastro público,
convites, confirmação/reenvio de e-mail, bônus de ativação, provisionamento,
SSO e warm-up de tenants, gestão de recursos/pacotes e reaper de contas develop.
As rotas, hooks e exports retirados estão enumerados em
`test/retired-contract.json`; não são substituídos por wrappers funcionais.
O login por Google autentica apenas contas existentes, mesmo que as settings
legadas permitam cadastro. O vínculo por e-mail segue a opção
`AUTH_ENV_GOOGLE_AUTOLINK`; contas bloqueadas não são vinculadas.
Entradas de apps usam o destino compartilhado, sem despertar ou alterar tenants.

Login por senha, OAuth/PKCE e tickets para contas existentes, sessões, permissões,
MCP, npm/devices, onboarding e criação administrativa/local de usuários continuam.
A página pública de login oferece apenas autenticação. System/Settings oferece
Users e Roles; cadastro e convites foram retirados dos dois renderizadores.
`initial-setup` retorna cadastro/convites desativados; `initial-admin` continua
recusando criação pública. O bootstrap administrativo é local.

Não há migração destrutiva: schema, usuários, sessões, registros de tenants,
credenciais e confirmações antigas permanecem armazenados. Eles não disparam
infraestrutura, créditos nem exclusão automática no boot. Integrações externas
que chamavam os contratos retirados precisam ser ajustadas antes da implantação;
a lista explícita permite revisar esse impacto. A política própria de outros
pacotes sobre e-mail verificado não é alterada por esta remoção.

O futuro pacote opcional de confirmação por eventos com Auth e Inbox, com seção
em Settings para ativar/configurar a caixa de e-mail, é acompanhado na
[issue #33](https://github.com/ThinkIac/ThinkIac/issues/33).
Nenhuma implantação ou substituição do Auth carregado pelo Runtime é feita aqui.

## Validação

O commit `6d1aba1b` adiciona 36 testes de OAuth, callback, tickets e cookies antes
da segunda extração. `google-auth.js` recebe callbacks de política do entrypoint,
sem importá-lo. Os eventos de crédito foram retirados nesta continuação; tokens, cookies,
códigos OAuth e tickets não ganham novos eventos de divulgação.
As tabelas, TTLs, ordem de operações e tratamento de falhas foram preservados.
Login and delegated ticket exchanges now require `TableProxy.delete(id)` to
return exactly `true` before issuing a session. Scriba derives this result from
SQLite DELETE affected rows: only the consumer that removes the row can proceed,
even across connections/processes. Errors, hook vetoes and lost races deny access.
The initial read is not the claim; the successful DELETE is the atomic claim.
This relies on these ticket tables using hard deletion (no deletedAt field).
Ticket removal and session insertion are intentionally separate: a later session
failure burns the ticket and requires a new login. OAuth state consumption is
unchanged. `ticket-consumption.test.js` exercises the real Scriba TableProxy with
two SQLite connections and a barrier forcing both reads before deletion.

O commit `52526656` registra os testes de caracterização antes da extração.
`boundaries.test.js` exercita 40 casos de identidade, comandos locais, segredos,
credenciais, escopos, revogação, orçamento de requisições e aprovação de devices.
`events.test.js` protege os contratos novos e rejeita identidade forjada.
`registration-contract.test.js` usa o scanner real do Lógos para verificar rotas,
visibilidade pública, hooks, comandos e exports contra o contrato anterior,
registrado em `test/entry-contract.json`. Esse JSON contém somente metadados de
API, sem dados ou snapshot de banco de usuários.

Todas as suítes Auth, incluindo as que antes não estavam no manifesto, constam de
`scripts/test-suites.json`. Para executar apenas essa seleção:

```sh
node --input-type=module -e 'import {loadSuites,runSuites} from "./scripts/test-all.mjs"; const results=await runSuites(loadSuites().filter(s=>s.name.startsWith("auth:"))); process.exitCode=results.every(r=>r.status==="PASS")?0:1'
```

Os testes de funcionalidades retiradas foram substituídos por verificações de
remoção dos contratos, recusa de novos usuários Google, ausência de efeitos de
infraestrutura no boot/entrada de apps e indisponibilidade das ações de cadastro.
Os demais contratos continuam comparados ao baseline anterior.

O clone utiliza Vitest 1.6.1 preexistente, embora o lockfile declare uma versão
mais recente. Não houve reinstalação de dependências nem validação em produção.

Validação da separação final: 84 testes Node e 159 testes Vitest de Auth, além de
seis testes do runner e dois de UI Schema. As três views alteradas compilam para SSR e DOM.

## Revisão da separação final

Serviços não importam o entrypoint ou os adaptadores. As anotações do scanner
ficam em adapters/ e events.js, com uma única inscrição de cada contrato.
O portão mantém a ordem de decisão anterior: conta descontinuada, autenticação
da ponte, exposição pública, sessão, delegação, administrador e permissões.
Não se transforma o resultado de um evento de notificação em autorização.

A extração preserva corpos de operações, TTLs, cookies e caminhos de arquivos.
Duas correções pontuais têm testes de regressão: o gate importa o autorizador
canônico usado pelo CNPJ; System aguarda a mutação e devolve sua falha antes de
montar estado ou anunciar sucesso. Ticket consumption was subsequently hardened
as described above, independently of the modular extraction.
