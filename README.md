# ThinkIac

## Um ambiente operacional para agentes

ThinkIac é infraestrutura como código para agentes, aplicações e automações. Nasceu da ideia de que um agente precisa de um ambiente onde possa trabalhar: conversar, usar ferramentas, acessar arquivos e terminal, consultar modelos e participar da evolução do próprio sistema.

O objetivo é tornar esse ambiente componível. Cada pessoa ou equipe pode reunir as capacidades de que precisa, criar outras e conectar serviços sem concentrar toda a inteligência e todas as integrações em um único aplicativo. A interface web é uma porta de entrada para esse trabalho; o runtime, os contratos e os pacotes formam a infraestrutura que o sustenta.

> Queremos agentes capazes de trabalhar em um computador real, com capacidades explícitas e responsabilidade sobre suas ações.

Essa visão também exige limites. Acesso a ferramentas, arquivos e credenciais depende da configuração e das permissões da instância. Mudanças em execução precisam de validação, e mecanismos de recarga e recuperação dependem dos módulos e contratos utilizados. Autonomia não elimina a necessidade de observação, revisão e controle humano.

<img width="720" alt="Interface web do ThinkIac" src="https://github.com/user-attachments/assets/215e73db-7f0a-46fd-a081-0500156a83be" />

## Uma arquitetura que pode crescer

O **Lógos** é o launcher e protocolo de composição. Seu núcleo descobre pacotes, resolve declarações e dependências e coordena autoridade e ciclo de vida. Capacidades como HTTP, ferramentas, persistência e interface são fornecidas por módulos escolhidos pelo host. Um pacote pode usar essas capacidades para oferecer serviços, rotas, ferramentas, telas e integrações; eventos permitem que partes do sistema cooperem.

Os agentes usam os provedores de IA configurados na instância. Especialistas podem ser ativados sob demanda ou por condições declaradas, conforme a tarefa: capacidades combináveis em torno de contratos, aproximando a ideia de uma arquitetura de especialistas da operação concreta do ambiente. Na interface, pacotes podem adicionar menus, widgets no chat e páginas de configuração.

O sistema pode evoluir durante a execução. Onde os consumidores implementam o protocolo transacional, candidatos são preparados antes da publicação e uma falha pode preservar a geração ativa. Isso não reverte automaticamente efeitos arbitrários de código ou garante troca sem interrupção para todos os pacotes. Veja o [Lógos](vendor/packages/logos/README.md), seu [protocolo de módulos](vendor/packages/logos/docs/modules.md) e os [contratos de integração](vendor/packages/logos/docs/package-integrations.md).

## LogosType: declarar capacidades

[LogosType](https://github.com/ThinkIac/LogosType) é uma linguagem de recursos declarativos baseada em CoffeeScript 2. Seus arquivos `.type` aproximam código, assinaturas e metadados: um provedor declara o contrato de um recurso e outros pacotes podem declarar recursos que o utilizam. `module` e `type` são aliases para declarar provedores; nomes como `tool` e `task` dependem de provedores disponíveis no host.

O compilador `logostype` pode funcionar independentemente do Lógos. Ele produz JavaScript e declarações; o host descobre os provedores, valida contratos e disponibiliza as capacidades. No ThinkIac, modelos `.scriba` e `.schema` podem fornecer tipos e descrições para as assinaturas. Usar um modelo como tipo não abre um banco: o acesso a dados depende do módulo de persistência e da autoridade do pacote.

```coffee
tool getUser = (ID: User.ID): User? ->
  @description "Busca um usuário"
  User[ID]
```

O exemplo pressupõe um provedor `tool`, o modelo `User` e uma capacidade de persistência configurados pelo host. A integração e suas limitações estão na [documentação de LogosType no Lógos](vendor/packages/logos/docs/logos-type.md); a linguagem, o compilador e suas instruções próprias estão no [repositório ThinkIac/LogosType](https://github.com/ThinkIac/LogosType). O perfil padrão fixa a revisão do compilador no [lockfile](profiles/default.lock.json).

## Instalação por perfis

ThinkIac é uma distribuição do Lógos composta por perfis. A base contém o kernel,
o inicializador e referências Git. Módulos e aplicações são baixados ao executar
o perfil selecionado.

```sh
npm ci --legacy-peer-deps
npm start
```

O perfil padrão reproduz a composição publicada de `/code/think`: 25 pacotes de
capacidade, 24 aplicações, o runtime aninhado do Shell e as bibliotecas Scriba e
Inflect. Seu código não está incorporado neste repositório.

```json
{
  "dependencies": {
    "@thinkiac/module-hooks": "ThinkIac/hooks#main",
    "@thinkiac/module-http": "ThinkIac/http#main",
    "terminal": "ThinkIac/terminal#main"
  }
}
```

Esse é um trecho de perfil. Também são aceitas tags como `ThinkIac/hooks#1.0.0`
quando a tag existir. O lockfile registra os commits exatos; mudanças remotas em
`main` só entram com atualização explícita.

```sh
npm run profile:install                 # baixar e preparar, sem iniciar
npm run start:runtime                   # iniciar diretamente
npm run start:foreground                # Supervisor em primeiro plano
npm run profile:update                  # resolver novamente e atualizar o lock
npm start -- --profile ./meu-perfil.json
```

A instalação concluída é reutilizada nas próximas inicializações. Dados ficam
fora das gerações de código, em `.thinkiac/<perfil>/state`, ou no diretório
definido por `THINKIAC_HOME`. Não há importação automática de dados pessoais de
uma instalação anterior.

Requisitos: Node >=22.12, npm, Git, acesso aos repositórios selecionados e
ferramentas de compilação das dependências nativas do perfil. O primeiro boot
precisa de rede. Perfis com repositórios privados usam a autenticação Git do host.

- [Perfis, fluxo, exemplos, estado e limitações](docs/profiles.md)
- [Perfil padrão](profiles/default.json) e [lock](profiles/default.lock.json)
- [Lógos](vendor/packages/logos/README.md)
- [LógosType](https://github.com/ThinkIac/LogosType)
- [Segurança](SECURITY.md) e [contribuição](CONTRIBUTING.md)

## Validação da base

```sh
npm test
npm run build
node launcher/kernel-smoke.cjs
```

Os testes de cada módulo e aplicação ficam nos respectivos repositórios.
Instalar uma geração com sucesso não equivale a aceitar um deploy em produção.

## Instância local com npx

Com Node 22.12 ou superior, npm e Git, execute na pasta da instância:

```bash
npx github:ThinkIac/ThinkIac
```

No primeiro uso, o assistente solicita nome, perfil, portas HTTP e MCP e,
quando o perfil inclui Auth, e-mail administrativo. Escolha `default` para
usar a composição fornecida ou informe um JSON local acompanhado do
respectivo `.lock.json`. O Auth provisiona o administrador no primeiro boot
com a senha aleatória mostrada no terminal interativo.

O launcher usa `.thinkiac/` na pasta atual para guardar a configuração, o perfil,
o lockfile, as gerações instaladas e os dados persistentes. A credencial de
bootstrap fica em `.thinkiac/.env`, com modo `0600` em sistemas POSIX.
Mantenha `.thinkiac/` fora do controle de versão.

Em novas execuções, o mesmo comando reutiliza a configuração e inicia o runtime
em primeiro plano. Crie instâncias em pastas distintas com portas distintas.

Para preparar uma instância em automação:

```bash
npx --yes github:ThinkIac/ThinkIac --name demo --port 5040 --mcp-port 3333 --install-only
```

Remova `--install-only` para iniciar após configurar. Em execuções posteriores,
omita as opções de configuração e mantenha `--install-only` apenas se desejar
instalar sem iniciar. Consulte [Perfis](docs/profiles.md) para o formato e as
referências Git aceitas.
