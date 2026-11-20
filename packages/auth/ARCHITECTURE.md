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

Os hooks anteriores de credenciais, provisionamento, boot e runtime:ready continuam
com os mesmos nomes e retornos. Não há eventos de mutação de usuários nesta etapa:
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
| `index.js` | Composição e adaptadores públicos compatíveis; fluxos ainda não extraídos |

Os serviços não importam o entrypoint. O scanner do Lógos percorre subdiretórios,
portanto os serviços não possuem anotações de registro. As rotas e hooks legados
mantêm adaptadores no entrypoint; cada operação é registrada uma única vez.
Caches de limite continuam em memória por processo, com as mesmas janelas.

A extração é deliberadamente incremental. Login, OAuth, confirmação por email,
provisionamento, catálogo de pacotes de tenants, onboarding e administração MCP
permanecem no entrypoint nesta etapa. Eles já têm auxiliares existentes e podem
ser extraídos em mudanças seguintes com a mesma proteção de compatibilidade.
Não houve implantação nem substituição do pacote carregado pelo Runtime.

## Validação

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

Os testes que inspecionam código administrativo leem entrypoint e serviço de
permissões. Expectativas antigas foram atualizadas após reproduzir suas falhas
com o entrypoint original: idioma da mensagem de grupo inválido e dependência do
catálogo do pacote externo cnpj-scraper. O teste de catálogo real agora verifica
o grupo administrativo do próprio Auth, além de Redirect e Providers. Também foram
ajustados três casos de cadastro já falhos no entrypoint original: configuração
de convites contraditória e nomes de campos antigos na resposta das settings.

Resultado local: 97 testes Node e 106 testes Vitest de Auth; seis testes do runner.
O clone utiliza Vitest 1.6.1 preexistente, embora o lockfile declare uma versão
mais recente. Não houve reinstalação de dependências nem validação em produção.
