# Registry npm do ThinkIac

O registry oficial é `https://npm.thinkiac.cloud`. A identidade é centralizada no Auth ThinkIac: não há senha duplicada no Verdaccio e os tokens podem ser revogados pelo usuário.

## Modelo de nomes e permissão

- Uma conta com usuário `ana` reserva o escopo `@ana`.
- Ela pode publicar `@ana/meu-pacote`.
- Um token npm concede leitura, publicação e remoção apenas nesse escopo.
- Administradores do ThinkIac têm o grupo operacional `npm:admin`.
- Pacotes publicados pelo `think pkgmgr:publish` são privados por padrão. O CLI registra a visibilidade no Auth antes do upload; somente o proprietário lê pacotes privados. `--visibility public` é uma abertura explícita.

## Criar e revogar token

Com uma sessão do ThinkIac ativa:

```sh
curl -X POST https://thinkiac.cloud/auth/npm/tokens
curl https://thinkiac.cloud/auth/npm/tokens
curl -X POST https://thinkiac.cloud/auth/npm/tokens/<id>/revoke
```

O primeiro endpoint mostra o segredo uma única vez. Guarde-o em um cofre; nunca em `package.json`, repositório ou log de CI.

## Login e publicação pelo CLI

```sh
think pkgmgr:login
think pkgmgr:publish
```

No primeiro uso, o CLI abre o Auth ThinkIac no navegador. Depois da aprovação do dispositivo, salva no perfil local somente um token npm revogável e retoma a publicação automaticamente. O projeto local não recebe token, escopo nem alteração de `package.json`.

Para automação, use um token dedicado e revogável por ambiente com npm normal:

```ini
//npm.thinkiac.cloud/:_authToken=tiac.seu-token
@ana:registry=https://npm.thinkiac.cloud
```

## Operação do Whitebook

O plugin `verdaccio-thinkiac` é carregado de `/home/white/.config/verdaccio/plugins`. Ele chama `POST https://thinkiac.cloud/auth/npm/authenticate` e `POST https://thinkiac.cloud/auth/npm/access`, autenticado por uma credencial de serviço que fica somente em `/etc/thinkiac/verdaccio.env` no Whitebook e em `packages/auth/.env` no runtime.

O procedimento de recuperação é `/usr/local/sbin/thinkiac-services-recover`; ele valida o Verdaccio depois de iniciar os serviços. O backup anterior da configuração fica em `/home/white/thinkiac-services/backups/`.

## Página do registry

`npm.thinkiac.cloud` usa o tema oficial `verdaccio-theme-thinkiac`, inspirado no
main-site. Ele mostra catálogo, detalhes e comandos de instalação sem alterar os
endpoints npm (`/-/`, `/<pacote>`, tarballs) nem expor tokens. A instalação,
recuperação e rollback estão documentados em
`packages/verdaccio-theme-thinkiac/README.md`.
