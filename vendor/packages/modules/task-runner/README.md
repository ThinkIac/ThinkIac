# Módulo de tarefas do Lógos

Plano implementado, versão 0.1:

1. Manter a orquestração em um pacote externo, sem dependência do bootstrap do Runtime.
2. Descobrir workspaces, montar o grafo antes de executar e rejeitar ciclos.
3. Executar scripts npm com paralelismo limitado, logs identificados e cancelamento.
4. Reutilizar resultados locais apenas quando entradas e saídas conferirem.
5. Separar distribuição Lógos e bibliotecas npm: catálogo ThinkIac para `logosDependencies` e `@thinkiac/*`, npm público para as demais.
6. Tornar o módulo a entrada de build e desenvolvimento da raiz; validar com fixtures e plano real.

O módulo exporta `plan(root, tasks, options)` e `run(graph, options)`. Funciona sem
compilação e sem carregar serviços do Runtime. O launcher pode selecioná-lo por
composição explícita no package.json:

```json
{ "logos": { "cli": { "tasks": "@thinkiac/module-task-runner/cli.cjs" } } }
```

Neste repositório a entrada aponta ao arquivo do workspace, permitindo o primeiro
build sem instalar ou compilar o próprio executor. A extensão é CommonJS, exporta
`main(argv, { root })` e retorna um código de saída de 0 a 255.

```sh
npm run tasks -- run build --dry-run
npm run build
npm run tasks -- run build --filter logos --concurrency 4
npm run tasks -- run test --filter @thinkiac/module-task-runner
npm run tasks -- install
npm run tasks -- install --ci
# Com o CLI Lógos compilado:
logos tasks run build --filter logos
```

Configuração em `logos.tasks.json`:

```json
{
  "version": 1,
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"], "cache": true },
    "dev": { "persistent": true, "cache": false },
    "test": { "dependsOn": [{ "task": "build", "optional": true }], "cache": false }
  }
}
```

`^build` percorre dependências locais de produção, desenvolvimento e opcionais.
Pacotes intermediários sem script viram nós virtuais, preservando a ordem transitiva.
Dependências npm externas permanecem responsabilidade do instalador. `build` exige
um script no mesmo pacote; `nome-do-pacote#build` exige outro workspace. Uma aresta
`{ "task": "build", "optional": true }` permite ausência de script. Overrides
`"nome-do-pacote#build"` substituem integralmente a regra geral. Scripts ausentes
nos pacotes selecionados são ignorados; seleção totalmente vazia falha.

Filtros aceitam nomes ou caminhos exatos relativos à raiz e incluem os requisitos.
Workspaces aceitam segmentos literais ou com `*`; outros globs são rejeitados.
Tarefas persistentes não podem ser pré-requisitos. Reserve concorrência suficiente
para todos os processos persistentes e pelo menos uma tarefa finita, quando houver.
A primeira falha interrompe o grafo e encerra processos ativos. SIGINT e SIGTERM
propagam cancelamento; em POSIX, grupos de processos recebem TERM e depois KILL.
No Windows, apenas o processo direto recebe o sinal; árvores completas ainda não
têm suporte equivalente. Scripts rodam sem entrada interativa.

O cache é opt-in por tarefa, nunca habilitado para processos persistentes. Usa SHA-256
de arquivos de todo o workspace, configuração, comando, ambiente, versão/plataforma
Node e saídas dos pré-requisitos. Exclui node_modules, .git, .turbo, o próprio cache
e diretórios de saída declarados. Lockfiles são entradas. Symlinks ou arquivos
especiais nas entradas desabilitam cache naquela execução. Credenciais não são
gravadas nos recibos: o ambiente participa somente do hash.
A varredura também desabilita cache acima de 100 mil entradas ou 64 MiB por árvore,
evitando carregar arquivos grandes indiscriminadamente; a tarefa continua executando.

As saídas aceitam apenas `diretorio/**`. Um acerto exige que as saídas atuais
tenham os mesmos conteúdos; remoção ou edição provoca reexecução. Diretórios
opcionais ausentes são registrados; ao menos um deve existir. O cache não restaura
arquivos nem envia dados a servidores. A varredura ampla prioriza correção e pode
ser custosa em workspaces grandes. Use `--no-cache` para comandos com entradas
externas, relógio, rede ou dependências instaladas alteradas sem mudança no lockfile.
Execuções concorrentes do mesmo workspace não são coordenadas por esta versão.

O comando `install` delega ao npm sem forçar registry ou alterar o ambiente.
O npm resolve `.npmrc`, configuração do usuário, ambiente e flags normalmente.
`--registry <url>` permite um override explícito apenas para instalação; o campo
legado `registry` em `logos.tasks.json` continua aceito como override de instalação,
com prioridade menor que a flag. Nenhum deles altera o ambiente dos scripts de tarefas.
Autenticação continua na configuração npm do usuário; o módulo não copia tokens.

O `.npmrc` da raiz define:

```ini
registry=https://registry.npmjs.org/
@thinkiac:registry=https://npm.thinkiac.cloud/
```

`logosDependencies` continua usando o resolvedor do Runtime: procura no workspace
e baixa pacotes ausentes do catálogo ThinkIac, independentemente da configuração
npm. Esse resolvedor extrai os pacotes, mas ainda não instala suas dependências
Node. `tasks install` instala as dependências npm dos workspaces descobertos pelo npm;
não executa o bootstrap nem resolve `logosDependencies` por conta própria.
URLs diretas e URLs já fixadas no lockfile continuam sujeitas às regras do npm.
Não se reescrevem URLs do lockfile nem configurações globais.

Turbo foi removido dos manifests ativos e `turbo.json` foi retirado. Build e dev
continuam no módulo Lógos; start continua iniciando o Runtime diretamente.
Os manifests do protótipo `apps/thinkiac/prototypes/thinkiac_edge` ainda citam Turbo
e não fazem parte dos workspaces ativos. Uma instalação anterior também pode manter
`turbo` em `node_modules` como `extraneous`; isso não representa uma dependência
do executor atual nem do lockfile principal.
Cache remoto, restauração de artefatos, filtros avançados e watch de grafo ficam
fora da versão 0.1. A configuração própria rejeita campos desconhecidos.
Aceitação pelo Runtime e publicação no Verdaccio são etapas separadas dos testes locais.

Contratos consultados: `packages/logos/docs/agnostic-launcher.md` e `packages.md`.
Referências existentes: `src/cli/extensions.ts`, `src/kernel/logos-dependencies.ts`
e o executor deste módulo. A alteração preserva grafo, cache, logs, cancelamento,
falhas e a extensão CommonJS já consumida pelo launcher.

Validação local da implementação: testes Node do módulo, testes de extensão e
compatibilidade de comandos do Lógos, TypeScript sem emissão, CLI compilado com
dry-run e build real dos quatro pacotes da raiz. O workspace atual excede o limite
de varredura do cache e compila sem reutilização. A delegação de instalação foi
testada com um npm substituto, sem baixar dependências ou publicar no registry.

Validação da separação de registries e remoção de Turbo: 17 testes Node e 8
testes Vitest aprovados, npm real em workspace temporário para registries,
build real de infrakit, inbed, logos e billing, dry-run de dev e do CLI compilado.
Não foi executada instalação limpa (`npm ci`) do monorepo. A atualização de lockfile
foi limitada aos pacotes desta migração, preservando as demais resoluções.
