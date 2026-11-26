# Composição por perfil

O repositório base distribui o Lógos e o inicializador. Implementações de módulos,
aplicações e bibliotecas da composição são obtidas dos repositórios declarados no
perfil. Não existe classificação diferente para baixar módulo ou aplicação.

## Iniciar

Requisitos: Node >=22.12, npm, Git e ferramentas de compilação dos addons nativos
usados pelo perfil. No Linux: compilador C/C++, Python e bibliotecas exigidas pelos
pacotes. O perfil padrão contém capacidades Node; ele não é um perfil embarcado.

```sh
npm ci --legacy-peer-deps
npm start
```

`npm ci` instala e compila a base. `npm start` instala o perfil `default`, se
necessário, e inicia o Supervisor com o serviço `Agent`, como na composição
anterior. `npm run start:runtime` executa diretamente em primeiro plano;
`npm run start:foreground` executa o Supervisor em primeiro plano.

```sh
npm run profile:install
npm run start:runtime -- --profile ./profiles/default.json
THINKIAC_PROFILE=./meu-perfil.json npm start
THINKIAC_HOME=/dados/thinkiac npm start
```

Nenhum processo do runtime é iniciado por `profile:install`. O primeiro download
exige rede. Depois de uma instalação concluída, o mesmo perfil, lock e build da
base reutilizam a instalação sem Git ou npm. Mudar esses artefatos prepara outra
geração; não modifica o código da geração anterior.

## Formato

```json
{
  "version": 1,
  "name": "meu-perfil",
  "dependencies": {
    "@thinkiac/module-hooks": "ThinkIac/hooks#main",
    "meu-pacote": "MinhaOrg/meu-pacote#1.0.0"
  },
  "paths": {
    "@thinkiac/module-hooks": "vendor/packages/modules/hooks",
    "meu-pacote": "packages/abc/b/meu-pacote"
  },
  "npmDependencies": { "dotenv": "^16.6.1" },
  "config": { "externalModules": ["hooks"] }
}
```

As chaves de `dependencies` são os nomes reais de `package.json`. Os valores
aceitam `owner/repository#branch`, `#tag`, `#commit` e o prefixo `github:`.
`#1.0.0` significa uma tag Git com esse nome, não um asset de Release nem uma
faixa semver. Para uma tag `v1.0.0`, escreva `#v1.0.0`.

`paths` é opcional; o padrão é `packages/<nome>`. A distribuição atual declara
caminhos históricos para preservar consumidores que ainda usam imports relativos.
O caminho não determina o papel do pacote. `shell-runtime`, por exemplo, é
baixado separadamente em `packages/shell/runtime`; a cópia embutida no repositório
do Shell é substituída pela referência explícita antes do build.

`npmDependencies` mantém as dependências npm de host ainda compartilhadas pela
composição atual. Elas são instaladas na geração, não na base. Os manifests dos
pacotes continuam declarando suas próprias dependências. Quando a dependência
está selecionada no perfil, o instalador a conecta ao workspace local, inclusive
para referências antigas `file:../...`. Referências locais sem provedor selecionado
falham com diagnóstico; não buscam arquivos do antigo `/code/think`.

`config` configura o bootstrap do host e tem precedência sobre seus defaults e
extensões. O workspace permanece `./packages`. `externalModules` seleciona os
provedores de compatibilidade da composição; as declarações dos pacotes do
workspace continuam sendo descobertas pelo catálogo do Lógos. Para um perfil
programático sem capacidades, use `externalModules: []`.

## Lock e atualização

`default.lock.json` fixa o commit de cada fonte. Mover `main` remotamente não muda
uma instalação existente. O lock inicial referencia os commits publicados das
migrações; GitHub usa a branch da publicação enquanto seu PR separado não foi
integrado. O kernel do repositório base é a fonte do Lógos desta distribuição e
não depende do PR do repositório `ThinkIac/logos`.

```sh
# Resolver novamente as branches/tags, preparar e gravar novos commits no lock:
npm run profile:update

# Atualizar outro perfil:
npm run profile:update -- --profile ./meu-perfil.json
```

Para um perfil novo sem lock, a primeira instalação é feita com `--update`.
Versione o perfil e seu lock juntos. Nenhum token é armazenado nesses arquivos.
Cada geração também guarda `profile.lock.json` e o `package-lock.json` produzido
pelo npm. O lock do perfil fixa fontes Git; dependências npm transitivas são
resolvidas durante a preparação de cada geração. Portanto, só o lock de perfil
não garante reprodução byte a byte de todas as dependências npm.

Fluxo:

```text
perfil + lock + build da base
          |
          v
validar referências, nomes e caminhos
          |
          v
baixar commits em uma nova geração
          |
          v
conectar dependências do workspace + npm install + builds
          |
          v
ligar diretórios persistentes + publicar current.json
          |
          v
iniciar Supervisor ou runtime na geração selecionada
```

Uma falha de download ou build não substitui `current.json`. O instalador remove
a geração incompleta e mantém a anterior. A promoção confirma instalação e
build; não é um aceite de saúde do runtime. Falhas no boot precisam de diagnóstico
e não provocam rollback automático do banco ou de migrações.

## Estado, credenciais e recuperação

```text
.thinkiac/
  default/
    current.json
    generations/<id>/       # fontes, builds e node_modules
    state/
      db/                  # LOGOS_DATA_DIR do módulo db
      .logos/
      uploads/
      packages/<nome>/     # .private, .database, data, profiles, shared-cache
```

O código e o estado são separados. Diretórios de estado ausentes nas fontes são
ligados à área persistente; conteúdo versionado com o mesmo nome é preservado.
Um pacote que escreve em outros caminhos precisa declarar sua própria política
de persistência. Não apague gerações enquanto processos ainda as utilizarem.

`LOGOS_DATA_DIR` pode apontar para outro local. `THINKIAC_HOME` controla downloads
e estado; no Docker seu default é `/data/thinkiac`. A configuração local de
ambiente continua sendo a `.env` da base ou `DOTENV_CONFIG_PATH` informado pelo
host. O instalador não copia credenciais do runtime em execução.

Git usa os credential helpers/configuração do host para acesso HTTPS. Configure
autenticação no ambiente de destino para repositórios privados. Não coloque
credenciais nos valores de `dependencies`. Nesta implementação, o instalador não
consulta o cofre Settings → GitHub do runtime, que ainda não está iniciado.

A instalação nova é separada dos dados existentes de `/code/think`. Não há
importação automática de bancos, sessões, uploads ou configurações pessoais.
Faça backup e planeje a transferência desses dados antes de substituir uma
instalação em produção. Este PR não reinicia nem altera o runtime ativo.

Para voltar a uma composição anterior, restaure seu perfil e lock e execute a
instalação. Os dados persistentes são compartilhados; uma versão antiga pode não
ser compatível com migrações de banco já aplicadas. Não há rollback de dados.

`install.lock` impede instalações concorrentes. Se o processo for interrompido,
confirme que ele encerrou antes de remover esse arquivo e tentar novamente.

## Testes

```sh
npm test
npm run build
node launcher/kernel-smoke.cjs
```

Os testes do inicializador cobrem referências, lock, caminhos, identidades,
dependências locais, cache, substituição de pacote aninhado, estado persistente,
concorrência e falhas de download/build. O smoke test demonstra que a base inicia
e encerra o kernel sem módulos. As suítes funcionais de cada capacidade pertencem
aos repositórios publicados; estes testes não substituem a validação da composição
completa, de UI, de Windows ou de um deploy real.
