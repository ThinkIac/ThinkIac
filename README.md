# ThinkIac

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
